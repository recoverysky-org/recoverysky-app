/**
 * SyncResumer Component
 *
 * Fires the attendance cloud-sync cold-start catch-up once the SQLite database
 * is ready. Headless component (renders null).
 *
 * Why this exists as a component rather than a call in initAttendanceSync:
 * initAttendanceSync() runs from app.tsx's RootStore setup path, which executes
 * BEFORE <DatabaseProvider> mounts and calls openDb(). A fullSync() fired from
 * there raced the DB open and threw "Database not opened" on every launch. This
 * component instead waits on the provider's own readiness signal, so the pull
 * happens exactly when the DB can serve it.
 *
 * fullSync()'s gate() still decides whether this does any real work — for a user
 * who hasn't opted into cloud backup (syncEnabled false, or no attendance
 * entitlement) every tick short-circuits and this is a no-op.
 *
 * Place inside DatabaseProvider, next to the other DB-ready resumers:
 * <DatabaseProvider>
 *   <ProfileHydrator />
 *   <ReportPollingResumer />
 *   <SyncResumer />
 *   ...
 * </DatabaseProvider>
 */

import { useEffect, useRef } from "react"

import { attendanceSync } from "@/services/sync"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "SyncResumer" })

export function SyncResumer(): null {
  const { status } = useDatabase()
  const hasResumed = useRef(false)

  useEffect(() => {
    if ((status === "open" || status === "seeded") && !hasResumed.current) {
      hasResumed.current = true
      log.info("Database ready, running attendance sync cold-start catch-up")
      void attendanceSync
        .fullSync()
        .catch((error) => log.error("Cold-start fullSync failed", { error: String(error) }))
    }
  }, [status])

  return null
}
