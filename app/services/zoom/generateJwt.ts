/**
 * Zoom JWT Token Generation
 *
 * Generates JWT tokens for Zoom Meeting SDK authentication.
 * Uses react-native-pure-jwt for native JWT signing.
 */

import { sign } from "react-native-pure-jwt"

import { logger } from "@/utils/logger"

import { getZoomConfig } from "./zoomConfig"
import type { ZoomRole } from "./zoomTypes"

const log = logger.child({ module: "ZoomJWT" })

/**
 * Generate a JWT token for Zoom Meeting SDK
 *
 * @param meetingNumber - The Zoom meeting number
 * @param role - 0 for participant, 1 for host (default: 0)
 * @returns JWT token string
 * @throws Error if SDK keys are not configured or signing fails
 */
export async function generateZoomJwt(meetingNumber: string, role: ZoomRole = 0): Promise<string> {
  const config = getZoomConfig()

  if (!config.sdkKey || !config.sdkSecret) {
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
        sdkKey: config.sdkKey,
        appKey: config.sdkKey,
        iat,
        role,
        mn: meetingNumber,
        tokenExp: Math.floor(exp / 1000),
        exp,
      },
      config.sdkSecret,
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
