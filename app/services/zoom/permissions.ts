/**
 * Zoom Media Permissions Utility
 *
 * Handles camera/microphone permission requests BEFORE joining a meeting.
 * This prevents the Zoom SDK black screen issue that occurs when permissions
 * are granted after SDK initialization.
 *
 * The problem: Zoom SDK caches device availability state at init time.
 * When permissions change after init, the SDK doesn't re-query devices.
 *
 * The solution: Request permissions before joining, and reinitialize SDK
 * if permissions were just granted (changed from undetermined to granted).
 */

import { Audio } from "expo-av"
import { Camera } from "expo-camera"
import { PermissionStatus } from "expo-modules-core"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomPermissions" })

export interface MediaPermissionState {
  camera: PermissionStatus
  audio: PermissionStatus
  /** True if both camera and audio are granted */
  allGranted: boolean
  /** True if either permission has never been requested */
  anyUndetermined: boolean
}

export interface MediaPermissionResult {
  camera: { status: PermissionStatus; granted: boolean; canAskAgain: boolean }
  audio: { status: PermissionStatus; granted: boolean; canAskAgain: boolean }
  /** True if any permission changed from undetermined to granted */
  justGranted: boolean
}

/**
 * Check current camera and microphone permission status
 * without triggering permission dialogs.
 */
export async function checkMediaPermissions(): Promise<MediaPermissionState> {
  const [cameraResponse, audioResponse] = await Promise.all([
    Camera.getCameraPermissionsAsync(),
    Audio.getPermissionsAsync(),
  ])

  const state: MediaPermissionState = {
    camera: cameraResponse.status,
    audio: audioResponse.status,
    allGranted: cameraResponse.granted && audioResponse.granted,
    anyUndetermined:
      cameraResponse.status === PermissionStatus.UNDETERMINED ||
      audioResponse.status === PermissionStatus.UNDETERMINED,
  }

  log.debug("Checked media permissions", {
    camera: state.camera,
    audio: state.audio,
    allGranted: state.allGranted,
    anyUndetermined: state.anyUndetermined,
  })

  return state
}

/**
 * Request camera and microphone permissions.
 * Returns whether permissions were just granted (changed from undetermined).
 */
export async function requestMediaPermissions(): Promise<MediaPermissionResult> {
  // First check current state to detect changes
  const before = await checkMediaPermissions()

  // Request both permissions in parallel
  const [cameraResponse, audioResponse] = await Promise.all([
    Camera.requestCameraPermissionsAsync(),
    Audio.requestPermissionsAsync(),
  ])

  // Determine if any permission was just granted
  // (was undetermined before, now granted)
  const cameraJustGranted =
    before.camera === PermissionStatus.UNDETERMINED && cameraResponse.granted
  const audioJustGranted = before.audio === PermissionStatus.UNDETERMINED && audioResponse.granted

  const result: MediaPermissionResult = {
    camera: {
      status: cameraResponse.status,
      granted: cameraResponse.granted,
      canAskAgain: cameraResponse.canAskAgain,
    },
    audio: {
      status: audioResponse.status,
      granted: audioResponse.granted,
      canAskAgain: audioResponse.canAskAgain,
    },
    justGranted: cameraJustGranted || audioJustGranted,
  }

  log.info("Requested media permissions", {
    cameraGranted: result.camera.granted,
    audioGranted: result.audio.granted,
    justGranted: result.justGranted,
  })

  return result
}

/**
 * Convenience function to check if we should request permissions
 * before joining a meeting (when permissions are undetermined).
 */
export async function needsPermissionRequest(): Promise<boolean> {
  const state = await checkMediaPermissions()
  return state.anyUndetermined
}
