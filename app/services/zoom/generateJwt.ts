/**
 * Zoom JWT Token Generation
 *
 * Generates JWT tokens for Zoom Meeting SDK authentication.
 * Uses react-native-pure-jwt for native JWT signing.
 */

import { sign } from "react-native-pure-jwt"

import { logger } from "@/utils/logger"

import type { ZoomRole } from "./zoomTypes"

const log = logger.child({ module: "ZoomJWT" })

/**
 * Generate a JWT token for Zoom Meeting SDK
 *
 * @param meetingNumber - The Zoom meeting number
 * @param role - 0 for participant, 1 for host (default: 0)
 * @param sdkKey - Zoom SDK key from ConfigStore
 * @param sdkSecret - Zoom SDK secret from ConfigStore
 * @returns JWT token string
 * @throws Error if SDK keys are not configured or signing fails
 */
export async function generateZoomJwt(
  meetingNumber: string,
  role: ZoomRole = 0,
  sdkKey: string = "",
  sdkSecret: string = "",
): Promise<string> {
  if (!sdkKey || !sdkSecret) {
    throw new Error("Zoom SDK keys not configured")
  }

  const iat = Date.now()
  const exp = iat + 20 * 60 * 60 * 1000 // 20 hours from now

  log.debug("Generating Zoom JWT", {
    meetingNumber,
    role,
    expiresIn: "20 hours",
  })

  try {
    const token = await sign(
      {
        sdkKey,
        appKey: sdkKey,
        iat,
        role,
        mn: meetingNumber,
        tokenExp: Math.floor(exp / 1000),
        exp,
      },
      sdkSecret,
      { alg: "HS256" },
    )

    log.debug("Zoom JWT generated successfully")
    return token
  } catch (error) {
    log.error("Failed to generate Zoom JWT", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
