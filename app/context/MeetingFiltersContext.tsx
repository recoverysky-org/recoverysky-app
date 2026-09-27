/**
 * MeetingFiltersContext: the Meetings tab's shared Fellowship + Language.
 *
 * ADDED 2026-09-26. Owned by MeetingsScreen and read by all three segments.
 * Both values are a *browse* selection: remembered in MMKV, never written back
 * to `profileStore.fellowship`. (Search used to write it, which silently
 * changed the user's Settings.)
 *
 * Fellowship storage holds only an explicit pick. `null` means "follow
 * Settings", and the shown value is derived every render by resolveFellowship.
 * That is what survives the cold-start race: `profileStore.fellowship` reads
 * "AA" until ProfileHydrator loads the real value, and deriving it lets the
 * hydrated value through, where seeding state would have frozen "AA".
 *
 * Follows Settings through liveEvents `preferences_changed` (reason
 * "fellowship"), emitted only by ProfileStore.setFellowship(), i.e. a real
 * user change in Settings or Onboarding. It must NOT become a MobX reaction on
 * profileStore.fellowship: hydration assigns that field directly on every cold
 * start, so a reaction would wipe the remembered pick at every launch.
 *
 * CHANGED 2026-09-26: the in-provider listener above only exists once the
 * Meetings tab has mounted at least once — MainNavigator statically imports
 * MeetingsScreen (which statically imports this module), so the *module*
 * loads eagerly at app start, but React Navigation still defers *mounting*
 * each tab's screen component until it's first visited. Cold start → Home →
 * Settings → change fellowship never mounts MeetingsScreen, so the provider
 * (and its useEffect) doesn't exist yet, and the MMKV pick from a stale
 * session survives to clobber the new Settings value on first Meetings visit.
 * The fix is a second, module-scope subscription below that clears the MMKV
 * key regardless of whether the provider is mounted. It's intentionally
 * module-scope, not a reaction, for the same hydration-race reason as the
 * in-provider listener.
 *
 * Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 */
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { observer } from "mobx-react-lite"

import { liveEvents } from "@/db"
import { useProfileStore } from "@/models"
import type { MeetingsSegment } from "@/navigators/navigationTypes"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import {
  parsePersistedLanguage,
  resolveFellowship,
  type LanguageCarrier,
} from "@/utils/meetingFiltersLogic"
import { loadString, remove, saveString } from "@/utils/storage"

const FELLOWSHIP_KEY = "meetings.fellowship"
const LANGUAGE_KEY = "meetings.language"

// Module-scope (not inside the provider component) so it exists from app
// start, before MeetingsScreen/MeetingFiltersProvider has ever mounted — see
// the file header comment ("CHANGED 2026-09-26"). Deliberately NOT a MobX
// reaction on profileStore.fellowship, for the same reason as the
// in-provider listener: hydration assigns that field directly on every cold
// start and a reaction would wipe the remembered pick at every launch.
liveEvents.subscribe((event) => {
  if (event.type === "preferences_changed" && event.reason === "fellowship") {
    remove(FELLOWSHIP_KEY)
  }
})

export interface MeetingFiltersValue {
  /** Always a member of ACTIVE_FELLOWSHIPS. */
  fellowship: string
  /** `null` = all languages. */
  language: string | null
  setFellowship: (value: string) => void
  setLanguage: (value: string | null) => void
  /**
   * Each segment reports its loaded list (after fellowship, before the
   * language filter) so the bar can offer that segment's languages without
   * fetching anything itself.
   */
  reportMeetings: (segment: MeetingsSegment, meetings: readonly LanguageCarrier[]) => void
  meetingsBySegment: Partial<Record<MeetingsSegment, readonly LanguageCarrier[]>>
}

const MeetingFiltersContext = createContext<MeetingFiltersValue | null>(null)

export const MeetingFiltersProvider: FC<PropsWithChildren> = observer(
  function MeetingFiltersProvider({ children }) {
    const profileStore = useProfileStore()
    const [persistedFellowship, setPersistedFellowship] = useState<string | null>(() =>
      loadString(FELLOWSHIP_KEY),
    )
    const [language, setLanguageState] = useState<string | null>(() =>
      parsePersistedLanguage(loadString(LANGUAGE_KEY)),
    )
    const [meetingsBySegment, setMeetingsBySegment] = useState<
      Partial<Record<MeetingsSegment, readonly LanguageCarrier[]>>
    >({})

    // Read during render so this observer re-renders when hydration lands.
    const fellowship = resolveFellowship({
      persisted: persistedFellowship,
      saved: profileStore.fellowship,
      active: ACTIVE_FELLOWSHIPS,
    })

    useEffect(() => {
      const unsubscribe = liveEvents.subscribe((event) => {
        if (event.type === "preferences_changed" && event.reason === "fellowship") {
          // Drop the bar's own pick so it follows the new Settings value.
          // CHANGED 2026-09-26: the module-scope subscriber above now also
          // clears the MMKV key, so when this provider IS mounted the two
          // handlers both fire and both call remove() — harmless (remove is
          // idempotent) — but only this one can also reset live React state
          // (setPersistedFellowship), which the module-scope handler can't
          // reach. Keep both: this covers the mounted case, the module-scope
          // one covers the not-yet-mounted case (see file header).
          setPersistedFellowship(null)
          remove(FELLOWSHIP_KEY)
        }
      })
      return () => {
        unsubscribe()
      }
    }, [])

    const setFellowship = useCallback((value: string) => {
      setPersistedFellowship(value)
      saveString(FELLOWSHIP_KEY, value)
    }, [])

    const setLanguage = useCallback((value: string | null) => {
      const code = value ? value.toUpperCase() : null
      setLanguageState(code)
      if (code) saveString(LANGUAGE_KEY, code)
      else remove(LANGUAGE_KEY)
    }, [])

    // Identity check keeps a re-report of the same array from re-rendering
    // every consumer.
    const reportMeetings = useCallback(
      (segment: MeetingsSegment, meetings: readonly LanguageCarrier[]) => {
        setMeetingsBySegment((prev) =>
          prev[segment] === meetings ? prev : { ...prev, [segment]: meetings },
        )
      },
      [],
    )

    const value = useMemo<MeetingFiltersValue>(
      () => ({
        fellowship,
        language,
        setFellowship,
        setLanguage,
        reportMeetings,
        meetingsBySegment,
      }),
      [fellowship, language, setFellowship, setLanguage, reportMeetings, meetingsBySegment],
    )

    return <MeetingFiltersContext.Provider value={value}>{children}</MeetingFiltersContext.Provider>
  },
)

export function useMeetingFilters(): MeetingFiltersValue {
  const ctx = useContext(MeetingFiltersContext)
  if (!ctx) throw new Error("useMeetingFilters must be used inside MeetingFiltersProvider")
  return ctx
}
