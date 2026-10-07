/**
 * DEV-ONLY: "Send test push" items in the Expo dev menu.
 *
 * Added 2026-10-06 for the 4.11.0 device checklist (spec
 * 2026-09-12-next-native-build-design.md §D, the two push-tap cases): the
 * launcher trampoline must forward a notification's extras on a cold-start
 * tap, and must not clear an open Custom Tab or a running timer on a
 * backgrounded tap. There was no way to send this device a push without the
 * full Expo push token, and the token is never logged (it is a delivery
 * credential, and CLAUDE.md's logging rules apply to it as much as to a sub).
 *
 * So the app sends the push to itself: it asks expo-notifications for its own
 * token and POSTs one message to Expo's public push API. The token goes only to
 * Expo, which issued it. Nothing is logged but the outcome.
 *
 * Usage: open the dev menu → "Test push → Meetings" (or Settings / Attendance).
 * The push arrives within seconds and sits in the shade, so for the cold case
 * swipe the app away first, then tap the notification.
 *
 * Never registered outside __DEV__ (see the call site in app.tsx), and
 * expo-dev-menu is excluded from production builds by eas-pre-install.js
 * anyway, so this cannot ship as a live feature.
 */
import { Platform } from "react-native"
import * as Notifications from "expo-notifications"

import { logger } from "@/utils/logger"

import { getProjectId } from "./expoNotificationService"

const log = logger.child({ module: "devTestPush" })

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

/** Tabs the click handler routes by `data.screen` (MainTabParamList names). */
const TARGETS = ["Meetings", "Settings", "Attendance"] as const

async function sendTestPush(screen: (typeof TARGETS)[number]): Promise<void> {
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() })
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        title: "RecoverySky test push",
        body: `Tap to open ${screen}`,
        // Same { screen, ... } contract the real senders use (addClickHandler).
        data: { screen },
      }),
    })
    const json = (await res.json()) as { data?: { status?: string; message?: string } }
    // Outcome only — never the token.
    log.info("Test push sent", {
      screen,
      httpStatus: res.status,
      ticket: json.data?.status,
      message: json.data?.message,
    })
  } catch (err) {
    log.warn("Test push failed", { screen, error: String(err) })
  }
}

export function registerTestPushDevMenu(): void {
  if (!__DEV__ || Platform.OS === "web") return
  // Lazy require, inside __DEV__: keeps expo-dev-menu out of the production
  // bundle entirely (its native module is excluded there by eas-pre-install.js;
  // its JS would load as a null module, but there is no reason to ship it).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerDevMenuItems } = require("expo-dev-menu") as typeof import("expo-dev-menu")
  registerDevMenuItems(
    TARGETS.map((screen) => ({
      name: `Test push → ${screen}`,
      callback: () => void sendTestPush(screen),
      shouldCollapse: true,
    })),
  ).catch((err) => log.warn("Could not register test-push dev menu items", { error: String(err) }))
}
