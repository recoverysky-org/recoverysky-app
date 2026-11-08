/**
 * useInPersonSearchMode — the I/O half of the In-Person segment's GPS-or-ZIP
 * choice (spec docs/superpowers/specs/2026-11-07-in-person-zip-search-design.md).
 * It owns the picked mode (MMKV `inperson.searchMode`), the typed postal code,
 * the lookup of that code against the API, and the resolved search centre
 * (MMKV `inperson.zip`). Every decision is a pure call into
 * `inPersonSearchLogic.ts`; this file only wires them to storage, the API and
 * React state. It has no unit test because it imports `@/` (vitest cannot
 * resolve the alias, see CLAUDE.md "Test Runner Split").
 *
 * PRIVACY: the postal code and its point stay in this hook's state and in MMKV.
 * Nothing here logs them, and tracking carries only the mode and a status word,
 * never the code or the point.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { useProfileStore } from "@/models"
import { api } from "@/services/api"
import { trackEvent } from "@/services/tracking"
import {
  decideStartingSearchMode,
  decideZipLookup,
  normalizePostalInput,
  parseStoredZip,
  serializeStoredZip,
  type InPersonSearchMode,
  type ZipAnswer,
} from "@/utils/inPersonSearchLogic"
import { loadString, saveString } from "@/utils/storage"

const MODE_KEY = "inperson.searchMode"
const ZIP_KEY = "inperson.zip"

export type ZipStatus =
  | "empty"
  | "invalid"
  | "looking"
  | "found"
  | "notFound"
  | "unavailable"
  | "failed"

export interface ZipCenter {
  lat: number
  lon: number
}

/** "K1A0B1" is shown as "K1A 0B1"; a bare FSA ("K1A") and US codes show as stored. */
function displayCode(country: string, code: string): string {
  return country === "CA" && code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

interface Restored {
  input: string
  center: ZipCenter | null
  code: string | null
  status: ZipStatus
}

function restoreZip(): Restored {
  const stored = parseStoredZip(loadString(ZIP_KEY))
  if (!stored) return { input: "", center: null, code: null, status: "empty" }
  return {
    input: displayCode(stored.country, stored.code),
    center: { lat: stored.lat, lon: stored.lon },
    code: stored.code,
    status: "found",
  }
}

export function useInPersonSearchMode(active: boolean) {
  const profileStore = useProfileStore()

  // Read once at mount; lazy so MMKV is hit a single time.
  const [restored] = useState(restoreZip)

  const [mode, setModeState] = useState<InPersonSearchMode | null>(null)
  const [zipInput, setZipInputState] = useState(restored.input)
  const [zipStatus, setZipStatus] = useState<ZipStatus>(restored.status)
  const [zipCenter, setZipCenter] = useState<ZipCenter | null>(restored.center)
  const [zipCode, setZipCode] = useState<string | null>(restored.code)

  // Session memo of found / not-found answers, keyed by canonical code.
  const memoRef = useRef<Map<string, ZipAnswer>>(new Map())
  // Latched once the API answers 404 for the route (older server): no more tries.
  const unavailableRef = useRef(false)
  // The canonical code whose request is on the wire, so the same code is not sent twice.
  const inFlightRef = useRef<string | null>(null)
  // The canonical code of the most recent lookup started or applied; a response
  // for any other code is stale and dropped (it may still be memoised).
  const newestRef = useRef<string | null>(null)
  // Guards against setting state after unmount (a lookup can outlive the screen).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // mode stays null until the segment is first active, so a tab that is never
  // opened never decides (or saves) anything. Saved at once so the pick is
  // stable even if the person never touches the toggle.
  // The profile store is read at the moment of the first activation, not
  // subscribed to: later changes to locationEnabled must not flip the mode.
  useEffect(() => {
    if (!active || mode !== null) return
    const starting = decideStartingSearchMode({
      stored: loadString(MODE_KEY),
      locationEnabled: profileStore.locationEnabled,
    })
    saveString(MODE_KEY, starting)
    setModeState(starting)
  }, [active, mode, profileStore])

  const setMode = useCallback((next: InPersonSearchMode) => {
    saveString(MODE_KEY, next)
    setModeState(next)
    trackEvent("inperson_search_mode_changed", { mode: next })
  }, [])

  /** Apply an answer for `code` to state, unless a newer lookup superseded it. */
  const applyAnswer = useCallback((code: string, answer: ZipAnswer, trackIt: boolean) => {
    if (!mountedRef.current || newestRef.current !== code) return
    let status: ZipStatus
    if (answer.found) {
      saveString(
        ZIP_KEY,
        serializeStoredZip({ code, country: answer.country, lat: answer.lat, lon: answer.lon }),
      )
      setZipCenter({ lat: answer.lat, lon: answer.lon })
      setZipCode(code)
      status = "found"
    } else {
      // Not found keeps the previous centre: a typo must not blank a good search.
      status = "notFound"
    }
    setZipStatus(status)
    if (trackIt) trackEvent("inperson_zip_lookup", { result: status })
  }, [])

  const runLookup = useCallback(
    (text: string) => {
      const normalized = normalizePostalInput(text)
      const decision = decideZipLookup({
        normalized,
        memo: memoRef.current,
        unavailable: unavailableRef.current,
        inFlightCode: inFlightRef.current,
      })
      switch (decision.action) {
        case "invalid":
          // Only reachable from submit / retry; typing never gets here with a bad shape.
          setZipStatus("invalid")
          return
        case "unavailable":
          newestRef.current = normalized?.code ?? null
          setZipStatus("unavailable")
          return
        case "memo":
          // A memo hit is applied like a fresh answer but is not tracked (no network).
          newestRef.current = normalized?.code ?? null
          if (normalized) applyAnswer(normalized.code, decision.answer, false)
          return
        case "in-flight":
          // Same code already on the wire: let that response land for it.
          newestRef.current = normalized?.code ?? null
          return
        case "fetch": {
          const code = decision.code
          newestRef.current = code
          inFlightRef.current = code
          setZipStatus("looking")
          void api.lookupPostalCode(code).then((result) => {
            if (inFlightRef.current === code) inFlightRef.current = null
            if (!mountedRef.current) return
            if (result.kind === "ok") {
              // Memoise even if superseded: the answer is still true for that code.
              memoRef.current.set(code, result.answer)
              applyAnswer(code, result.answer, true)
              return
            }
            if (newestRef.current !== code) return
            if (result.kind === "unavailable") {
              unavailableRef.current = true
              setZipStatus("unavailable")
              trackEvent("inperson_zip_lookup", { result: "unavailable" })
            } else {
              // No automatic retry: the person taps retry.
              setZipStatus("failed")
              trackEvent("inperson_zip_lookup", { result: "failed" })
            }
          })
          return
        }
      }
    },
    [applyAnswer],
  )

  const setZipInput = useCallback(
    (text: string) => {
      setZipInputState(text)
      if (normalizePostalInput(text)) {
        runLookup(text)
        return
      }
      // Partial or blank text: no lookup and no invalid-message while typing.
      // The centre stays; newest is cleared so a late response for the earlier
      // code cannot flip the status under text that no longer matches it.
      newestRef.current = null
      setZipStatus("empty")
    },
    [runLookup],
  )

  const submitZip = useCallback(() => runLookup(zipInput), [runLookup, zipInput])
  const retryZip = useCallback(() => runLookup(zipInput), [runLookup, zipInput])

  return {
    mode,
    setMode,
    zipInput,
    setZipInput,
    submitZip,
    retryZip,
    zipStatus,
    zipCenter,
    zipCode,
  }
}
