/**
 * ReportPollingResumer Component
 *
 * Resumes polling for unconfirmed attendance reports on app startup.
 * Headless component (renders null) that runs once when the database is ready.
 *
 * CHANGED 2026-09-13: also re-runs when the signed-in identity changes. The
 * resume pass is scoped to reports the current identity owns (see
 * `reportPollingLogic.decideResume`), so a sign-out / sign-in must cancel
 * the old identity's polls and start the new identity's. Before this, one
 * device polled six reports from a previous identity for three days.
 *
 * Place inside DatabaseProvider:
 * <DatabaseProvider>
 *   <ProfileHydrator />
 *   <ChatHydrator />
 *   <ReportPollingResumer />
 *   ...
 * </DatabaseProvider>
 */

import { useEffect } from "react"
import { observer } from "mobx-react-lite"

import { useAuthenticationStore } from "@/models"
import { resumeUnconfirmedPolls, stopAllPolls } from "@/services/polling"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "ReportPollingResumer" })

export const ReportPollingResumer = observer(function ReportPollingResumer(): null {
  const { status } = useDatabase()
  // `userId` is MMKV-persisted, so it is already hydrated by the time the
  // database opens — the first run sees the real identity, not a flash of
  // undefined followed by a second pass.
  const { userId } = useAuthenticationStore()

  useEffect(() => {
    if (status !== "open" && status !== "seeded") return
    // Cheap no-op on the first run; on an identity change it drops the
    // previous identity's timers before the new resume pass.
    stopAllPolls()
    log.info("Database ready, resuming unconfirmed report polling", { signedIn: !!userId })
    void resumeUnconfirmedPolls(userId)
  }, [status, userId])

  return null
})
