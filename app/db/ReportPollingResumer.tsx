/**
 * ReportPollingResumer Component
 *
 * Resumes polling for unconfirmed attendance reports on app startup.
 * Headless component (renders null) that runs once when the database is ready.
 *
 * Place inside DatabaseProvider:
 * <DatabaseProvider>
 *   <ProfileHydrator />
 *   <ChatHydrator />
 *   <ReportPollingResumer />
 *   ...
 * </DatabaseProvider>
 */

import { useEffect, useRef } from "react"

import { resumeUnconfirmedPolls } from "@/services/polling"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "ReportPollingResumer" })

export function ReportPollingResumer(): null {
  const { status } = useDatabase()
  const hasResumed = useRef(false)

  useEffect(() => {
    if ((status === "open" || status === "seeded") && !hasResumed.current) {
      hasResumed.current = true
      log.info("Database ready, resuming unconfirmed report polling")
      void resumeUnconfirmedPolls()
    }
  }, [status])

  return null
}
