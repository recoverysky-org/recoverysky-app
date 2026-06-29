/**
 * Rating engine orchestrator — the only file here that performs side effects
 * (MMKV, Alert, StoreReview, Linking, analytics). The gnarly gating lives in the
 * pure modules (decide.ts / reducers.ts); this just wires them to the platform.
 *
 * Flow: a source calls recordEvent() → counter increments UNCONDITIONALLY →
 * maybePrompt() applies the prompt gate → soft-ask Alert → OS prompt on "Yes!",
 * feedback divert on "Not really". See the design doc for the full model.
 */

import { Alert, InteractionManager, Linking, Platform } from "react-native"
import * as Application from "expo-application"
import * as StoreReview from "expo-store-review"

import { meetingEvents } from "@/db/meetingEvents"
import { translate } from "@/i18n"
import type { ConfigStore } from "@/models/ConfigStore"
import { trackEvent } from "@/services/tracking"
import { logger } from "@/utils/logger"

import { CFG, SUPPORT_URL } from "./config"
import { shouldPrompt } from "./decide"
import { applyApprove, applyDeny, reduceRecordEvent } from "./reducers"
import { initState, saveState } from "./state"
import type { RatingState } from "./types"

const log = logger.child({ module: "RatingEngine" })

/** In-memory mirror of the persisted state; null until initRatingEngine runs. */
let state: RatingState | null = null
/** ConfigStore reference for the reviewEnabled prompt gate. */
let configStore: ConfigStore | null = null

/**
 * Wire the engine at app startup: run migration/init, stash the config ref, and
 * subscribe to event sources. v1 has a single source (meeting completion); any
 * future source just calls recordEvent("...").
 */
export function initRatingEngine(cs: ConfigStore): void {
  configStore = cs
  state = initState(new Date(), CFG)
  meetingEvents.subscribe((event) => {
    if (event.type === "completed") recordEvent("meeting")
  })
  log.debug("rating: initialized", { events: state.events, disabled: state.disabled })
}

/**
 * Generic event intake. ALWAYS increments the counter — the only gate is on the
 * PROMPT (in maybePrompt), never on counting. This is what makes the
 * REVIEW_ENABLED off→on operator lever work: events keep accruing while the flag
 * is off, then the next event after re-enable fires the prompt.
 */
export function recordEvent(source: string): void {
  if (!state) state = initState(new Date(), CFG) // defensive: count even if init was skipped
  state = reduceRecordEvent(state)
  saveState(state)
  log.debug("rating: event recorded", { source, events: state.events })
  void maybePrompt()
}

async function maybePrompt(): Promise<void> {
  if (!state) return
  if (Platform.OS === "web") return
  // Prompt gate. Counting already happened above; this only blocks the dialog.
  if (!configStore?.reviewEnabled) return

  const version = Application.nativeApplicationVersion
  if (!shouldPrompt(state, new Date(), version, CFG)) return

  log.debug("rating: showing soft-ask", { events: state.events, version: version ?? "unknown" })

  // Defer presentation until the current interaction/animation batch settles.
  // recordEvent() is emitted SYNCHRONOUSLY from inside saveTimerAttendance (the
  // external-Zoom timer Save flow), so calling Alert.alert here directly pops the
  // soft-ask WHILE the timer <Modal> is still being torn down by handleSave's
  // onSaved → setTimerVisible(false). iOS UIKit then freezes ("tried to present
  // while a presentation is in progress") until the user taps to flush the queue.
  // runAfterInteractions waits for the modal-dismiss (and topic-panel slide-in)
  // animation batch to finish first — the same fix the Education→Timer hand-off
  // uses in SchedulePopup.handleEducationContinue.
  InteractionManager.runAfterInteractions(() => showSoftAsk(version))
}

function showSoftAsk(version: string | null): void {
  Alert.alert(translate("common:ratingSoftAskTitle"), translate("common:ratingSoftAskMessage"), [
    { text: translate("common:ratingNotReally"), style: "cancel", onPress: () => onDeny() },
    {
      text: translate("common:ratingYes"),
      style: "default",
      onPress: () => void onApprove(version),
    },
  ])
}

async function onApprove(version: string | null): Promise<void> {
  if (!state) return
  state = applyApprove(state, new Date().toISOString(), version)
  saveState(state)
  trackEvent("rating_soft_ask_yes")
  await presentOsReview()
}

function onDeny(): void {
  if (!state) return
  state = applyDeny(state, new Date().toISOString(), CFG)
  saveState(state)
  trackEvent("rating_soft_ask_no")
  // Feedback divert: catch the unhappy user here instead of in a 1-star review.
  Alert.alert(translate("common:ratingFeedbackTitle"), translate("common:ratingFeedbackMessage"), [
    { text: translate("common:cancel"), style: "cancel" },
    {
      text: translate("common:ratingContactUs"),
      style: "default",
      onPress: () => {
        Linking.openURL(SUPPORT_URL).catch((e: unknown) =>
          log.warn("rating: support link failed", { error: String(e) }),
        )
      },
    },
  ])
}

/**
 * Best-effort native review prompt. The OS rate-limits this (~3/yr) and silently
 * no-ops — and gives no signal back — so a no-show is expected, not an error.
 */
async function presentOsReview(): Promise<void> {
  try {
    if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview()
  } catch (e: unknown) {
    log.warn("rating: StoreReview.requestReview failed", { error: String(e) })
  }
}

/**
 * Explicit "Rate App" button in Settings. Fires the OS prompt directly and
 * records it as an approve so the version-gated cooldown applies (does NOT
 * permanently disable — an explicit tap shouldn't kill future auto-asks forever).
 */
export async function requestRatingFromSettings(): Promise<void> {
  if (Platform.OS === "web") return
  const version = Application.nativeApplicationVersion
  await presentOsReview()
  if (!state) state = initState(new Date(), CFG)
  state = applyApprove(state, new Date().toISOString(), version)
  saveState(state)
}
