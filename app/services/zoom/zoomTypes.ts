/**
 * Zoom Meeting SDK Types
 */

/**
 * Configuration for joining a Zoom meeting
 */
export interface ZoomJoinConfig {
  /** Our internal meeting ID (for attendance tracking) */
  meetingId: string
  /** The Zoom meeting number/ID */
  meetingNumber: string
  /** Display name for the user in the meeting */
  userName: string
  /** Meeting password (if required) */
  password?: string
}

/**
 * Result of a Zoom meeting join attempt
 */
export interface ZoomJoinResult {
  /** Whether the join was successful */
  success: boolean
  /** Error message if join failed */
  error?: string
}

/**
 * Zoom SDK initialization state
 */
export type ZoomInitState = "idle" | "initializing" | "ready" | "error"

/**
 * Zoom meeting state
 */
export type ZoomMeetingState = "idle" | "joining" | "inMeeting" | "ended" | "error"

/**
 * Zoom meeting role
 * 0 = participant
 * 1 = host
 */
export type ZoomRole = 0 | 1
