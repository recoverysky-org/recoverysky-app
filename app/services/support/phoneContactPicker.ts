/**
 * The app's one door to the native phone-number picker (modules/phone-contact-picker).
 *
 * ADDED 2026-11-06 (support contacts spec D2). Contract for callers:
 * - `null` means the person cancelled. It is never an error.
 * - Every failure rejects with `PhoneContactPickerError`, whose `code` is one of
 *   `PhoneContactPickerErrorCode` (mapped by the pure `pickerErrorCodeFrom`).
 * - `isPhoneContactPickerAvailable()` is false on web and on a binary built before the module
 *   existed (an OTA can reach one), so the UI hides the "pick from contacts" path there.
 *
 * Relative import on purpose: `@/*` maps to `app/*` and `modules/` sits beside it. This file is
 * the one place the module is imported.
 *
 * Privacy: a picked name and number are support contacts' personal data. Nothing here logs
 * either; the failure line carries the error code alone.
 */
import { logger } from "@/utils/logger"

import {
  pickerErrorCodeFrom,
  type PhoneContactPickerErrorCode,
  type PickedPhoneContact,
} from "./supportContactsLogic"
import PhoneContactPicker from "../../../modules/phone-contact-picker"

const log = logger.child({ module: "Support" })

export class PhoneContactPickerError extends Error {
  constructor(readonly code: PhoneContactPickerErrorCode) {
    super(`Phone contact picker failed: ${code}`)
    this.name = "PhoneContactPickerError"
  }
}

export function isPhoneContactPickerAvailable(): boolean {
  return PhoneContactPicker !== null
}

export async function pickPhoneContact(): Promise<PickedPhoneContact | null> {
  if (PhoneContactPicker === null) {
    log.warn("Phone contact picker unavailable", { code: "no_picker" })
    throw new PhoneContactPickerError("no_picker")
  }
  try {
    return await PhoneContactPicker.pickPhoneContact()
  } catch (e) {
    // Only the native code is read off the rejection: its message and cause are never logged,
    // so a future native change that put contact data in a message could not leak it here.
    const code = pickerErrorCodeFrom((e as { code?: unknown } | null)?.code)
    log.warn("Phone contact pick failed", { code })
    throw new PhoneContactPickerError(code)
  }
}
