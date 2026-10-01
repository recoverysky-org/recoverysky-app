/**
 * OwnerRelinkMigrator Component
 *
 * ADDED 2026-09-30 (spec 2 §7). Headless: once the database is open, moves
 * rows still stamped with one of the owner's previous subs to `ownerSub`
 * (see rewriteOwnerUid). The ownership gate does the same thing itself when
 * the database is already open; this covers the cold start where Auth0
 * restores the session before <DatabaseProvider> has opened it, and a crash
 * between the gate's steps.
 *
 * MUST be mounted before <ReportPollingResumer>: effects run in tree order,
 * so its rewrite lands before the resume pass decides which reports belong
 * to the signed-in user.
 */

import { useEffect } from "react"
import { observer } from "mobx-react-lite"

import { useAuthenticationStore } from "@/models"
import { resumeUnconfirmedPolls } from "@/services/polling"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"
import { rewriteOwnerUid } from "./rewriteOwnerUid"

const log = logger.child({ module: "OwnerRelinkMigrator" })

export const OwnerRelinkMigrator = observer(function OwnerRelinkMigrator(): null {
  const { status } = useDatabase()
  const { ownerSub, previousOwnerSubs, userId } = useAuthenticationStore()
  // Joined so the effect's dependency is a stable primitive; the MST array
  // identity does not change when an entry is pushed.
  const previous = previousOwnerSubs.join("\n")

  useEffect(() => {
    if (status !== "open" && status !== "seeded") return
    if (!ownerSub || !previous) return
    try {
      const moved = rewriteOwnerUid(previous.split("\n"), ownerSub)
      // When the gate's own rewrite failed, ReportPollingResumer has already
      // run for the new userId and skipped these reports as foreign. Resume
      // again now that they carry it; a resume never restarts an active poll
      // (reportPollingService's asymmetric dedup), so a double pass is harmless.
      if (moved && userId === ownerSub) void resumeUnconfirmedPolls(userId)
    } catch (err) {
      // Rows stay on the old sub until this effect re-runs — the next database
      // open (normally the next launch). Nothing is lost meanwhile.
      log.error("Failed to move local rows to the relinked owner", { error: String(err) })
    }
    // userId is read, not a trigger: the rewrite keys on the owner record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, ownerSub, previous])

  return null
})
