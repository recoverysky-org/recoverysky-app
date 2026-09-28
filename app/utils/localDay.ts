/**
 * Observable "today" — the device-local calendar date as "YYYY-MM-DD",
 * kept current while anything is observing it.
 *
 * Why this exists: day counts derived from `new Date()` inside a MobX computed
 * or a `useMemo` never recompute on their own, because the clock isn't an
 * observable and isn't a dependency. The Home clean-time card and
 * `ProfileStore.cleanDays` both froze at whatever day the app was cold-started
 * on — the tab stays mounted, so a phone that lived in the background for a
 * week kept showing last week's count. Reading `getLocalDay()` inside a
 * computed / `observer` makes the date a real dependency, and observers
 * re-render only when the *date string* changes (once a day), not on every
 * tick.
 *
 * The clock runs only while observed (`onBecomeObserved` /
 * `onBecomeUnobserved`), the same pattern as mobx-utils' `now()`:
 * - a timer re-armed for each local midnight (+1 s slack so a slightly early
 *   wake doesn't read the old day), and
 * - an AppState "active" refresh, because JS timers don't run while the app is
 *   suspended and the user may also have crossed a time zone or changed the
 *   clock in the meantime.
 */

import { AppState, type NativeEventSubscription } from "react-native"
import { observable, onBecomeObserved, onBecomeUnobserved, runInAction } from "mobx"

import { todayLocalISODate } from "./localDate"
import { msUntilNextLocalMidnight } from "./localDayLogic"

const MIDNIGHT_SLACK_MS = 1_000

const localDay = observable.box(todayLocalISODate(), { name: "localDay" })

let timer: ReturnType<typeof setTimeout> | null = null
let appStateSub: NativeEventSubscription | null = null

function refresh() {
  const today = todayLocalISODate()
  // observable.box skips notification when the value is unchanged, so a
  // foreground on the same day re-renders nothing.
  if (localDay.get() !== today) runInAction(() => localDay.set(today))
  armMidnightTimer()
}

function armMidnightTimer() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(refresh, msUntilNextLocalMidnight(new Date()) + MIDNIGHT_SLACK_MS)
}

onBecomeObserved(localDay, () => {
  // The box may have sat unobserved across a midnight — resync before arming.
  refresh()
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh()
  })
})

onBecomeUnobserved(localDay, () => {
  if (timer) clearTimeout(timer)
  timer = null
  appStateSub?.remove()
  appStateSub = null
})

/**
 * Today's local date ("YYYY-MM-DD"). Reactive inside MobX computeds and
 * `observer` components; always fresh outside them too.
 */
export function getLocalDay(): string {
  // The box is the change *signal*, not the source of truth: reading it
  // registers the dependency, but the value comes from the device clock. The
  // box can be stale on the first read after an unobserved stretch (the clock
  // only starts once MobX finishes binding this read), and returning it then
  // would show yesterday until the resync in onBecomeObserved re-ran us.
  localDay.get()
  return todayLocalISODate()
}
