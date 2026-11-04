/**
 * Delete My Day's local data on this phone: the Daily Dash database file
 * (`dd-<hash>.db`), its key and the Daily Dash session record. ADDED 2026-11-04
 * (My Day spec D8, §4.9; final review I-1).
 *
 * This is the ONE place the Daily Dash reset happens (the policy test,
 * dailyDashPolicy.test.ts, pins `signOut("reset_local_data")` to this file).
 * It has two callers:
 * - Settings → Delete User Data, step 7b (SettingsScreen.tsx);
 * - the database overlay's "Reset local data" (DatabaseProvider's
 *   `resetLocalData`), injected as the `resetDailyDash` prop from app.tsx so
 *   `app/db/` imports nothing of the client.
 * Both of our resets clear `ownerSub`, so the next sign-in on this phone may be
 * a different account. The client's `restore()` goes from a stored session
 * record straight to signedIn with no owner check, so leaving My Day's data
 * behind would hand the previous owner's My Day to that account.
 *
 * `start()` runs first so a STORED SESSION from an earlier premium period is
 * restored and its file is deleted by hash; the `reset_local_data` branch also
 * drops a kept file whether or not start() ran. `start()` is idempotent in the
 * client, so a session the driver already started is not started twice.
 *
 * It NEVER throws: neither caller may be blocked from its own reset by a
 * failure here. Failures are logged by error code only (never the error
 * object, never its `cause`), as MyDayGate.tsx does.
 */
import { appErrorOf } from "@daily-dash/client"

import { logger } from "@/utils/logger"

import { getDailyDashSession } from "./dailyDashSession"

const log = logger.child({ module: "DailyDash" })

export async function resetDailyDashLocalData(): Promise<void> {
  try {
    // Builds the session if nothing has yet (a free account, or a cold start
    // that never opened the tab): a stored record from an earlier premium
    // period must still be found and deleted. Null only when the build has no
    // valid EXPO_PUBLIC_DAILY_DASH_API_URL, and then no session was ever built.
    const dd = getDailyDashSession()
    if (!dd) {
      log.info("No Daily Dash session configured, nothing to reset")
      return
    }
    await dd.start()
    await dd.signOut("reset_local_data")
  } catch (e) {
    log.warn("My Day local data reset failed", { code: appErrorOf(e)?.code })
  }
}
