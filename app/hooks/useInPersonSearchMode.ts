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
import type { PostalLookupResult } from "@/services/api/postalLookupLogic"
import { trackEvent } from "@/services/tracking"
import {
  decideStartingSearchMode,
  decideZipLookup,
  normalizePostalInput,
  parseStoredZip,
  serializeStoredZip,
  type InPersonSearchMode,
  type NormalizedPostal,
  type PostalCountry,
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
  country: PostalCountry | null
  status: ZipStatus
}

function restoreZip(): Restored {
  const stored = parseStoredZip(loadString(ZIP_KEY))
  if (!stored) return { input: "", center: null, code: null, country: null, status: "empty" }
  return {
    input: displayCode(stored.country, stored.code),
    center: { lat: stored.lat, lon: stored.lon },
    code: stored.code,
    country: stored.country,
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
  // Seeded with the restored answer: submit/retry on the unchanged restored
  // code must not refetch (spec: editing the box is the only thing that looks
  // a code up again).
  const [memo] = useState(() => {
    const m = new Map<string, ZipAnswer>()
    if (restored.center && restored.code) {
      m.set(restored.code, {
        found: true,
        lat: restored.center.lat,
        lon: restored.center.lon,
        country: restored.country ?? "US",
      })
    }
    return m
  })
  const memoRef = useRef(memo)
  // Latched once the API answers 404 for the route (older server): no more tries.
  const unavailableRef = useRef(false)
  // The canonical code whose request is on the wire, so the same code is not sent twice.
  const inFlightRef = useRef<string | null>(null)
  // The canonical code of the most recent lookup started or applied; a response
  // for any other code is stale and dropped (it may still be memoised).
  const newestRef = useRef<string | null>(null)
  // At most one lookup is in flight; a newer valid code replaces the pending
  // one (spec rule). It runs, through decideZipLookup again, when the wire settles.
  const queuedRef = useRef<string | null>(null)
  const dispatchRef = useRef<(n: NormalizedPostal | null) => void>(() => undefined)
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

  /** The wire settled (any outcome): free the slot, then run the queued code, if any. */
  const settle = useCallback(
    (code: string, result: PostalLookupResult) => {
      if (inFlightRef.current === code) inFlightRef.current = null
      if (!mountedRef.current) return
      if (result.kind === "ok") {
        // Memoise even if superseded: the answer is still true for that code.
        memoRef.current.set(code, result.answer)
        applyAnswer(code, result.answer, true)
      } else if (result.kind === "unavailable") {
        // A 404 describes the route, not the code, so the latch holds even for
        // a superseded code; only the status and tracking depend on newest.
        unavailableRef.current = true
        if (newestRef.current === code) {
          setZipStatus("unavailable")
          trackEvent("inperson_zip_lookup", { result: "unavailable" })
        }
      } else if (newestRef.current === code) {
        // No automatic retry: the person taps retry.
        setZipStatus("failed")
        trackEvent("inperson_zip_lookup", { result: "failed" })
      }
      const queued = queuedRef.current
      queuedRef.current = null
      if (queued) dispatchRef.current(normalizePostalInput(queued))
    },
    [applyAnswer],
  )

  const dispatch = useCallback(
    (normalized: NormalizedPostal | null) => {
      const decision = decideZipLookup({
        normalized,
        memo: memoRef.current,
        unavailable: unavailableRef.current,
        inFlightCode: inFlightRef.current,
      })
      if (decision.action === "invalid") {
        // Only reachable from submit / retry; typing never gets here with a bad shape.
        setZipStatus("invalid")
        return
      }
      if (!normalized) return
      const code = normalized.code
      // Anything but a queued fetch supersedes the pending code.
      queuedRef.current = null
      newestRef.current = code
      switch (decision.action) {
        case "unavailable":
          setZipStatus("unavailable")
          return
        case "memo":
          // A memo hit is applied like a fresh answer but is not tracked (no network).
          applyAnswer(code, decision.answer, false)
          return
        case "in-flight":
          // Same code already on the wire: let that response land for it.
          setZipStatus("looking")
          return
        case "fetch": {
          setZipStatus("looking")
          if (inFlightRef.current !== null) {
            // Another code is on the wire: wait for it, replacing any earlier queued code.
            queuedRef.current = code
            return
          }
          inFlightRef.current = code
          void api.lookupPostalCode(code).then(
            (result) => settle(code, result),
            () => settle(code, { kind: "failed", problem: "error" }),
          )
          return
        }
      }
    },
    [applyAnswer, settle],
  )
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  const runLookup = useCallback((text: string) => dispatch(normalizePostalInput(text)), [dispatch])

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
      queuedRef.current = null
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
