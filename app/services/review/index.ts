/**
 * App Store review prompt service
 *
 * 1. !REVIEW_ENABLED || disabled → skip
 * 2. meetingCount === MIN_MEETINGS → native StoreReview
 * 3. (meetingCount - MIN_MEETINGS) % REMINDER_MEETINGS === 0 → reminder dialog
 * 4. OK → Settings → Rate
 * 5. "Don't show again" → disabled
 * 6. Settings "Rate" button → disabled
 */

import { Alert, Platform } from "react-native"
import * as StoreReview from "expo-store-review"

import { meetingEvents } from "@/db/meetingEvents"
import { translate } from "@/i18n"
import type { ConfigStore } from "@/models/ConfigStore"
import { navigate } from "@/navigators/navigationUtilities"
import { logger } from "@/utils/logger"
import { load, save } from "@/utils/storage"

const STORAGE_KEY = "app-review-state-v4"

/** ConfigStore reference, set at init time */
let _configStore: ConfigStore | null = null

/** Check if review prompts are enabled (server config overrides env var) */
function isReviewEnabled(): boolean {
  if (_configStore) return _configStore.reviewEnabled
  return process.env.EXPO_PUBLIC_REVIEW_ENABLED === "true"
}
const MIN_MEETINGS = Number(process.env.EXPO_PUBLIC_REVIEW_MIN_MEETINGS) || 5
const REMINDER_MEETINGS = Number(process.env.EXPO_PUBLIC_REVIEW_REMINDER_MEETINGS) || 5

interface ReviewState {
  totalMeetings: number
  disabled: boolean
}

function getState(): ReviewState {
  return load<ReviewState>(STORAGE_KEY) ?? { totalMeetings: 0, disabled: false }
}

function setState(state: ReviewState): void {
  save(STORAGE_KEY, state)
}

async function handleMeetingCompleted(): Promise<void> {
  if (!isReviewEnabled()) return
  if (Platform.OS === "web") return

  const state = getState()
  state.totalMeetings += 1
  setState(state)

  const tm = state.totalMeetings
  logger.debug("review: meeting recorded", {
    tm,
    MIN_MEETINGS,
    REMINDER_MEETINGS,
    disabled: state.disabled,
  })

  if (state.disabled) return

  // Native StoreReview at exactly MIN_MEETINGS
  if (tm === MIN_MEETINGS) {
    logger.debug("review: showing native StoreReview", { tm })
    const available = await StoreReview.isAvailableAsync()
    if (available) await StoreReview.requestReview()
    return
  }

  // Reminder dialog every REMINDER_MEETINGS after MIN_MEETINGS
  if (tm > MIN_MEETINGS && (tm - MIN_MEETINGS) % REMINDER_MEETINGS === 0) {
    logger.debug("review: showing reminder dialog", { tm })
    Alert.alert(
      translate("common:reviewReminderTitle"),
      translate("common:reviewReminderMessage"),
      [
        {
          text: translate("common:ok"),
          style: "default",
          onPress: () => navigate("Settings" as never, { section: "legal" } as never),
        },
        {
          text: translate("common:dontShowAgain"),
          style: "cancel",
          onPress: () => {
            const s = getState()
            s.disabled = true
            setState(s)
          },
        },
      ],
    )
  }
}

/**
 * Subscribe to meeting completed events. Call once at app startup.
 */
export function initReviewService(configStore?: ConfigStore): void {
  if (configStore) _configStore = configStore
  meetingEvents.subscribe((event) => {
    if (event.type === "completed") handleMeetingCompleted()
  })
}

/**
 * Explicit review request from Settings "Rate App" button.
 */
export async function requestReviewFromSettings(): Promise<void> {
  if (Platform.OS === "web") return

  const available = await StoreReview.isAvailableAsync()
  if (!available) return

  await StoreReview.requestReview()

  const state = getState()
  state.disabled = true
  setState(state)
}
