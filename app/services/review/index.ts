import * as StoreReview from "expo-store-review"
import { Platform } from "react-native"

import { load, save } from "@/utils/storage"

const STORAGE_KEY = "app-review-state"

const MIN_MEETINGS = Number(process.env.EXPO_PUBLIC_REVIEW_MIN_MEETINGS) || 2
const COOLDOWN_DAYS = Number(process.env.EXPO_PUBLIC_REVIEW_COOLDOWN_DAYS) || 2
const POST_REVIEW_DAYS = Number(process.env.EXPO_PUBLIC_REVIEW_POST_REVIEW_DAYS) || 14

const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000
const POST_REVIEW_MS = POST_REVIEW_DAYS * 24 * 60 * 60 * 1000

interface ReviewState {
  meetingsJoined: number
  lastPromptAt: number
  hasReviewed: boolean
}

function getState(): ReviewState {
  return load<ReviewState>(STORAGE_KEY) ?? {
    meetingsJoined: 0,
    lastPromptAt: 0,
    hasReviewed: false,
  }
}

function setState(state: ReviewState) {
  save(STORAGE_KEY, state)
}

export function recordMeetingJoined() {
  const state = getState()
  state.meetingsJoined += 1
  setState(state)
}

export async function maybeRequestReview() {
  if (Platform.OS === "web") return

  const available = await StoreReview.isAvailableAsync()
  if (!available) return

  const state = getState()

  if (state.meetingsJoined < MIN_MEETINGS) return

  const now = Date.now()
  const cooldown = state.hasReviewed ? POST_REVIEW_MS : COOLDOWN_MS

  if (now - state.lastPromptAt < cooldown) return

  await StoreReview.requestReview()

  state.lastPromptAt = now
  state.hasReviewed = true
  setState(state)
}

export async function requestReviewFromSettings() {
  if (Platform.OS === "web") return

  const available = await StoreReview.isAvailableAsync()
  if (!available) return

  await StoreReview.requestReview()

  const state = getState()
  state.lastPromptAt = Date.now()
  state.hasReviewed = true
  setState(state)
}
