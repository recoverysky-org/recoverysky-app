/**
 * Rating engine orchestrator — the only file here that performs side effects
 * (MMKV, Alert, StoreReview, Linking, analytics). The gnarly gating lives in the
 * pure modules (decide.ts / reducers.ts); this just wires them to the platform.
 *
 * Flow: a source calls recordEvent() → counter increments UNCONDITIONALLY →
 * maybePrompt() applies the prompt gate → soft-ask Alert → OS prompt on "Yes!",
 * feedback divert on "Not really". See the design doc for the full model.
 */

import { Alert, Linking, Platform } from "react-native"
import * as Application from "expo-application"
import * as StoreReview from "expo-store-review"

import { meetingEvents } from "@/db/meetingEvents"
import { translate } from "@/i18n"
import type { ConfigStore } from "@/models/ConfigStore"
import { trackEvent } from "@/services/tracking"
import { logger } from "@/utils/logger"

import { CFG, SUPPORT_URL } from "./config"
import { daysBetween, shouldPrompt } from "./decide"
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
    if (event.type === "completed") {
      // DIAG: confirms the meeting-completion signal reached the rating engine.
      log.info("rating[diag]: meetingEvents.completed received", { reason: event.reason })
      recordEvent("meeting")
    }
  })
  // DIAG: full startup snapshot — events carried over, the prompt gate flag, and
  // the active thresholds. If reviewEnabled is false here, the server /config
  // (or env) hasn't enabled it and NO prompt will ever show.
  log.info("rating[diag]: initialized", {
    events: state.events,
    installedAt: state.installedAt,
    lastPromptAt: state.lastPromptAt ?? "null",
    disabled: state.disabled,
    reviewEnabled: cs.reviewEnabled,
    MIN_EVENTS: CFG.MIN_EVENTS,
    MIN_DAYS: CFG.MIN_DAYS,
  })
}

/**
 * Generic event intake. ALWAYS increments the counter and does NOTHING else —
 * counting is decoupled from presenting (that's what makes the REVIEW_ENABLED
 * off→on operator lever work: events accrue while the flag is off, then the next
 * present-check after re-enable fires the prompt).
 *
 * It deliberately does NOT present the soft-ask here. recordEvent is emitted
 * SYNCHRONOUSLY from inside saveTimerAttendance (the external-Zoom timer Save
 * flow), i.e. while the timer <Modal> is still being torn down — presenting an
 * Alert at that moment freezes iOS UIKit ("tried to present while a presentation
 * is in progress"). Presentation is owned by maybePresentRatingPrompt(), which
 * SchedulePopup calls only AFTER its modal has fully dismissed. See that call
 * site and the rating design doc.
 */
export function recordEvent(source: string): void {
  // Never throw out of here: recordEvent runs SYNCHRONOUSLY inside
  // meetingEvents.completed, which is on saveTimerAttendance's critical path.
  // A throw would propagate into the timer save and strand the modal open.
  // (meetingEvents.emit now also isolates listeners — this is belt-and-suspenders.)
  try {
    if (!state) state = initState(new Date(), CFG) // defensive: count even if init was skipped
    state = reduceRecordEvent(state)
    saveState(state)
    // DIAG: every counted event. If this doesn't appear after a meeting, the
    // meetingEvents.completed signal never fired (invalid/short session, or
    // attendance disabled so the timer never ran).
    log.info("rating[diag]: event recorded", { source, events: state.events })
  } catch (err) {
    log.error("rating: recordEvent failed (event not counted)", { source, error: String(err) })
  }
}

/**
 * Present the soft-ask now IF the user is eligible. Safe to call from any
 * post-dismissal UI moment (no modal in flight) — currently SchedulePopup's
 * close. Idempotent in practice: once shown, applyApprove/applyDeny set
 * lastPromptAt so shouldPrompt returns false until the next eligible window, so
 * repeated calls don't re-present.
 *
 * MUST only be called when no modal is mid-presentation/dismissal, otherwise the
 * iOS freeze described on recordEvent returns.
 */
export function maybePresentRatingPrompt(): void {
  if (!state) {
    log.info("rating[diag]: present check → SKIP (no state — engine not initialized?)")
    return
  }

  const now = new Date()
  const version = Application.nativeApplicationVersion
  const eligible = shouldPrompt(state, now, version, CFG)

  // DIAG: the complete decision snapshot. This is the line to read when the
  // prompt "doesn't show" — every gate input is here.
  log.info("rating[diag]: present check", {
    platform: Platform.OS,
    reviewEnabled: configStore?.reviewEnabled,
    events: state.events,
    MIN_EVENTS: CFG.MIN_EVENTS,
    daysSinceInstall: daysBetween(state.installedAt, now),
    MIN_DAYS: CFG.MIN_DAYS,
    lastPromptAt: state.lastPromptAt ?? "null",
    denyCount: state.denyCount,
    approvedAtVersion: state.approvedAtVersion ?? "null",
    disabled: state.disabled,
    version: version ?? "unknown",
    shouldPrompt: eligible,
  })

  if (Platform.OS === "web") {
    log.info("rating[diag]: present check → SKIP (web)")
    return
  }
  // Prompt gate. Counting already happened in recordEvent; this only blocks the dialog.
  if (!configStore?.reviewEnabled) {
    log.info(
      "rating[diag]: present check → SKIP (reviewEnabled is false — enable via server /config)",
    )
    return
  }
  if (!eligible) {
    log.info("rating[diag]: present check → SKIP (not eligible — see shouldPrompt inputs above)")
    return
  }

  log.info("rating[diag]: present check → SHOWING soft-ask", { events: state.events })
  showSoftAsk(version)
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
