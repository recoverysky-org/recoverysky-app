/**
 * Zoom In-Meeting Controls & Info
 *
 * Provides methods for controlling the meeting and getting info
 * while in an active Zoom meeting.
 */

import { NativeModules } from "react-native"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomControls" })

const { RNZoomSDK } = NativeModules

// ============================================================================
// Types
// ============================================================================

export interface MeetingStatusResult {
  state: number
  stateName: string
}

export interface MeetingInfoResult {
  inMeeting: boolean
  meetingNumber?: string
  topic?: string
  hostName?: string
  password?: string
  isHost?: boolean
  isCoHost?: boolean
}

export interface ParticipantCountResult {
  inMeeting: boolean
  count: number
}

export interface MyUserInfoResult {
  inMeeting: boolean
  userId?: number
  userName?: string
  isHost?: boolean
  isCoHost?: boolean
  isAudioMuted?: boolean
  isVideoOn?: boolean
}

// ============================================================================
// In-Meeting Controls
// ============================================================================

/**
 * Leave the current meeting
 * @param endMeeting - If true and you're the host, ends the meeting for everyone
 */
export async function leaveMeeting(endMeeting: boolean = false): Promise<boolean> {
  log.trace("leaveMeeting called", { endMeeting, hasRNZoomSDK: !!RNZoomSDK })
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return false
  }

  try {
    log.info("Leaving meeting", { endMeeting })
    const result = await RNZoomSDK.leaveMeeting(endMeeting)
    log.info("Left meeting successfully")
    log.trace("leaveMeeting native returned", { result: String(result) })
    return result
  } catch (error) {
    log.error("Failed to leave meeting", { error: String(error) })
    log.trace("leaveMeeting native threw", {
      error: String(error),
      stack: error instanceof Error ? (error.stack ?? "") : "",
    })
    throw error
  }
}

/**
 * Mute or unmute your audio
 * @param muted - true to mute, false to unmute
 */
export async function muteMyAudio(muted: boolean): Promise<boolean> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return false
  }

  try {
    log.info("Setting audio mute", { muted })
    const result = await RNZoomSDK.muteMyAudio(muted)
    log.info("Audio mute set successfully", { muted })
    return result
  } catch (error) {
    log.error("Failed to set audio mute", { error: String(error) })
    throw error
  }
}

/**
 * Turn your video on or off
 * @param muted - true to turn off video, false to turn on
 */
export async function muteMyVideo(muted: boolean): Promise<boolean> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return false
  }

  try {
    log.info("Setting video mute", { muted })
    const result = await RNZoomSDK.muteMyVideo(muted)
    log.info("Video mute set successfully", { muted })
    return result
  } catch (error) {
    log.error("Failed to set video mute", { error: String(error) })
    throw error
  }
}

/**
 * Switch between front and back camera
 */
export async function switchCamera(): Promise<boolean> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return false
  }

  try {
    log.info("Switching camera")
    const result = await RNZoomSDK.switchCamera()
    log.info("Camera switched successfully")
    return result
  } catch (error) {
    log.error("Failed to switch camera", { error: String(error) })
    throw error
  }
}

// ============================================================================
// Meeting Info
// ============================================================================

/**
 * Get the current meeting status
 */
export async function getMeetingStatus(): Promise<MeetingStatusResult> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return { state: 0, stateName: "idle" }
  }

  try {
    const result = await RNZoomSDK.getMeetingStatus()
    log.debug("Got meeting status", { stateName: result.stateName })
    log.trace("getMeetingStatus native result", {
      state: result.state,
      stateName: result.stateName,
    })
    return result
  } catch (error) {
    log.error("Failed to get meeting status", { error: String(error) })
    return { state: 0, stateName: "idle" }
  }
}

/**
 * Get information about the current meeting
 */
export async function getMeetingInfo(): Promise<MeetingInfoResult> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return { inMeeting: false }
  }

  try {
    const result = await RNZoomSDK.getMeetingInfo()
    log.debug("Got meeting info", { inMeeting: result.inMeeting, topic: result.topic })
    return result
  } catch (error) {
    log.error("Failed to get meeting info", { error: String(error) })
    return { inMeeting: false }
  }
}

/**
 * Get the number of participants in the meeting
 */
export async function getParticipantCount(): Promise<ParticipantCountResult> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return { inMeeting: false, count: 0 }
  }

  try {
    const result = await RNZoomSDK.getParticipantCount()
    log.debug("Got participant count", { count: result.count })
    return result
  } catch (error) {
    log.error("Failed to get participant count", { error: String(error) })
    return { inMeeting: false, count: 0 }
  }
}

/**
 * Get information about the current user in the meeting
 */
export async function getMyUserInfo(): Promise<MyUserInfoResult> {
  if (!RNZoomSDK) {
    log.warn("RNZoomSDK not available")
    return { inMeeting: false }
  }

  try {
    const result = await RNZoomSDK.getMyUserInfo()
    log.debug("Got my user info", { userName: result.userName, isHost: result.isHost })
    return result
  } catch (error) {
    log.error("Failed to get my user info", { error: String(error) })
    return { inMeeting: false }
  }
}

// ============================================================================
// Convenience Hook
// ============================================================================

/**
 * Check if native Zoom SDK is available
 */
export function isZoomControlsAvailable(): boolean {
  return RNZoomSDK !== null && RNZoomSDK !== undefined
}
