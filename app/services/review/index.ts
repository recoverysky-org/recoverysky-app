/**
 * App Store review prompt service
 *
 * Cycle-based prompting strategy:
 * - During a cycle (up to 5 unique days of app usage), prompt on every
 *   odd-numbered meeting joined (1st, 3rd, 5th, ...).
 * - If the user rates via Settings, the cycle ends and a cooldown begins.
 * - If 5 unique days pass without rating, the cycle ends and cooldown begins.
 * - After EXPO_PUBLIC_REVIEW_POST_REVIEW_DAYS, a new cycle starts.
 * - Users who already rated also re-enter a cycle after the cooldown.
 */

import { Platform } from "react-native"
import * as StoreReview from "expo-store-review"

import { load, save } from "@/utils/storage"

const STORAGE_KEY = "app-review-state-v2"

/** Kill switch — set EXPO_PUBLIC_REVIEW_ENABLED=true to activate the review system */
const REVIEW_ENABLED = process.env.EXPO_PUBLIC_REVIEW_ENABLED === "true"

/** Max unique days of app usage before a cycle expires */
const MAX_CYCLE_DAYS = 5

/** Days to wait after a cycle ends (rated or exhausted) before starting a new one */
const POST_REVIEW_DAYS = Number(process.env.EXPO_PUBLIC_REVIEW_POST_REVIEW_DAYS) || 14
const POST_REVIEW_MS = POST_REVIEW_DAYS * 24 * 60 * 60 * 1000

interface ReviewState {
  /** Meetings joined in the current cycle */
  meetingsInCycle: number
  /** Unique YYYY-MM-DD dates the app was used during this cycle */
  uniqueDays: string[]
  /** Timestamp when the cycle ended (0 = cycle is active) */
  cycleEndedAt: number
}

function getState(): ReviewState {
  return (
    load<ReviewState>(STORAGE_KEY) ?? {
      meetingsInCycle: 0,
      uniqueDays: [],
      cycleEndedAt: 0,
    }
  )
}

function setState(state: ReviewState): void {
  save(STORAGE_KEY, state)
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function freshCycle(): ReviewState {
  return { meetingsInCycle: 0, uniqueDays: [], cycleEndedAt: 0 }
}

/**
 * Call when the user finishes a Zoom meeting.
 * Tracks meeting count and unique usage days for the current review cycle.
 */
export function recordMeetingJoined(): void {
  if (!REVIEW_ENABLED) return

  let state = getState()

  // If cycle ended and cooldown has passed, start a fresh cycle
  if (state.cycleEndedAt > 0 && Date.now() - state.cycleEndedAt >= POST_REVIEW_MS) {
    state = freshCycle()
  }

  // Still in cooldown — don't count meetings
  if (state.cycleEndedAt > 0) {
    return
  }

  // Track unique day
  const day = todayString()
  if (!state.uniqueDays.includes(day)) {
    state.uniqueDays.push(day)
  }

  state.meetingsInCycle += 1
  setState(state)
}

/**
 * Call after recordMeetingJoined(). Shows the review prompt on odd-numbered
 * meetings (1st, 3rd, 5th, ...) within the active cycle window.
 */
export async function maybeRequestReview(): Promise<void> {
  if (!REVIEW_ENABLED) return
  if (Platform.OS === "web") return

  const available = await StoreReview.isAvailableAsync()
  if (!available) return

  const state = getState()

  // In cooldown — skip
  if (state.cycleEndedAt > 0) return

  // Cycle exhausted (used app on more than MAX_CYCLE_DAYS unique days) — end cycle
  if (state.uniqueDays.length > MAX_CYCLE_DAYS) {
    state.cycleEndedAt = Date.now()
    setState(state)
    return
  }

  // Prompt on odd meeting numbers: 1, 3, 5, 7, ...
  if (state.meetingsInCycle > 0 && state.meetingsInCycle % 2 === 1) {
    await StoreReview.requestReview()
  }
}

/**
 * Explicit review request from Settings. Always shows the prompt (if available)
 * and ends the current cycle, starting a cooldown before the next cycle.
 */
export async function requestReviewFromSettings(): Promise<void> {
  if (!REVIEW_ENABLED) return
  if (Platform.OS === "web") return

  const available = await StoreReview.isAvailableAsync()
  if (!available) return

  await StoreReview.requestReview()

  // Rating from Settings ends the cycle → cooldown before next cycle
  const state = getState()
  state.cycleEndedAt = Date.now()
  setState(state)
}
