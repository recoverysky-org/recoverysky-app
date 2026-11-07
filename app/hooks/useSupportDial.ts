import { useCallback } from "react"

import { useToast } from "@/components/Toast"
import { openDial } from "@/services/support/dial"
import type { DialKind } from "@/services/support/supportContactsLogic"
import { trackEvent } from "@/services/tracking"

/**
 * The one dial handler for support contacts and the crisis line.
 * ADDED 2026-11-06 (Support Contacts): the Home card and the Support screen
 * (contact rows and 988) shared three copies of this body.
 *
 * Opens the phone app, tracks `event` on success and toasts on failure.
 * NAMES ONLY (spec D1): the number goes to `openDial` and nowhere else; the
 * event is a fixed name and the toast a translation key.
 */
export function useSupportDial(): (kind: DialKind, number: string, event: string) => Promise<void> {
  const { showToast } = useToast()
  return useCallback(
    async (kind, number, event) => {
      const ok = await openDial(kind, number)
      if (ok) {
        trackEvent(event)
      } else {
        showToast({ tx: "support:couldntOpenPhone", type: "error" })
      }
    },
    [showToast],
  )
}
