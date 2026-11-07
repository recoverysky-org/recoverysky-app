import { Linking } from "react-native"

import { logger } from "@/utils/logger"

import { dialUrl, type DialKind } from "./supportContactsLogic"

const log = logger.child({ module: "Support" })

/**
 * Hands a support contact's number to the phone or messages app (spec D7).
 * ADDED 2026-11-06.
 *
 * Resolves `true` once the OS accepted the link, `false` when it could not open
 * (no phone app, a tablet without telephony). It never throws, so a caller can
 * show its own "couldn't open" toast.
 *
 * Names only (spec D1): the warn line carries `{ kind }` and nothing else. Not
 * the URL (it is the number), not the number, and not the error message, which
 * on some platforms echoes the URL it failed to open.
 */
export async function openDial(kind: DialKind, number: string): Promise<boolean> {
  try {
    await Linking.openURL(dialUrl(kind, number))
    return true
  } catch {
    log.warn("Could not open the dialer", { kind })
    return false
  }
}
