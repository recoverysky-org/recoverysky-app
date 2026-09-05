/**
 * One-time migration: existing per-meeting favorites → schedule-wide favorites.
 *
 * ADDED 2026-09-04, alongside the schedule-wide favorite change: hearts set
 * before that update marked only the single tapped meeting, so a user's
 * Monday favorite left Tue/Wed/… occurrences of the same schedule unloved.
 * On first run after the update this walks every currently-loved meeting,
 * asks the API which schedule it belongs to, and favorites the whole
 * schedule — after which the popups' schedule-wide toggle keeps everything
 * consistent on its own.
 *
 * Flag semantics: the MMKV done-flag is written ONLY after a fully
 * successful pass. Any transient failure (offline launch, API timeout,
 * failed SQLite write) aborts the pass with the flag unset, and the next
 * cold start retries the whole thing — safe because the operation is
 * idempotent (`setLoveForMids` skips mids already loved). `not-found` /
 * `bad-data` lookups are counted as handled instead: a favorite on a
 * meeting delisted upstream must not block the flag forever. The
 * per-outcome rule lives in `classifyMigrationLookup` (vitest-covered).
 *
 * Runs once per install, fired by `FavoritesMigrator` (app/db/) after the
 * database is seeded. Like services/sync, this imports the specific `@/db/*`
 * modules rather than the `@/db` barrel — the barrel exports the migrator
 * component, which imports this service, and the barrel import would hand
 * depcruise that cycle.
 */
import { feedbackCache } from "@/db/feedbackCache"
import { api } from "@/services/api"
import { classifyMigrationLookup, decideScheduleLove } from "@/utils/favoriteLogic"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "migrateFavorites" })

/** MMKV done-flag. Bump the suffix if the migration ever needs to re-run. */
export const FAVORITES_MIGRATION_KEY = "favorites.scheduleMigration.v1"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait (bounded) for the feedback cache. React runs child effects before
 * parent effects, so FavoritesMigrator's effect fires BEFORE the
 * DatabaseProvider effect that even *starts* feedbackCache.loadAll() — on
 * every launch, not just slow ones. A plain isLoaded() check here would
 * therefore defer forever; polling briefly is what actually lets the
 * migration run on the launch it was asked to.
 */
async function waitForFeedbackCache(timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!feedbackCache.isLoaded()) {
    if (Date.now() > deadline) return false
    await sleep(250)
  }
  return true
}

export async function migrateFavoritesToSchedules(): Promise<void> {
  if (loadString(FAVORITES_MIGRATION_KEY) === "done") return

  if (!(await waitForFeedbackCache())) {
    log.warn("Feedback cache never loaded; deferring favorites migration to next launch")
    return
  }

  const lovedMids = [...feedbackCache.getAll().values()]
    .filter((fb) => fb.loves)
    .map((fb) => fb.mid)

  if (lovedMids.length === 0) {
    saveString(FAVORITES_MIGRATION_KEY, "done")
    log.info("No pre-existing favorites; migration trivially complete")
    return
  }

  log.info("Migrating favorites to schedule-wide", { count: lovedMids.length })

  // Mids already written by an earlier schedule in this pass — two loved
  // meetings often share one schedule, and the second lookup would be a
  // wasted round trip.
  const covered = new Set<string>()

  for (const mid of lovedMids) {
    if (covered.has(mid)) continue

    const outcome = await api.getScheduleByMeetingIdAnyVenue(mid)
    if (outcome.kind !== "ok") {
      if (classifyMigrationLookup(outcome.kind) === "abort") {
        log.info("Favorites migration aborted; will retry next launch", {
          mid,
          kind: outcome.kind,
        })
        return
      }
      // skip: delisted upstream / malformed — handled, nothing to propagate
      covered.add(mid)
      continue
    }

    // currentLoves: false makes decideScheduleLove yield loves: true — the
    // migration only ever favorites, it never clears.
    const { mids, loves } = decideScheduleLove({
      tappedMid: mid,
      currentLoves: false,
      scheduleData: outcome.schedule.data,
    })
    const allPersisted = await feedbackCache.setLoveForMids(mids, loves)
    if (!allPersisted) {
      log.info("Favorites migration aborted on failed write; will retry next launch", { mid })
      return
    }
    mids.forEach((m) => covered.add(m))
  }

  saveString(FAVORITES_MIGRATION_KEY, "done")
  log.info("Favorites migration complete", { favorites: lovedMids.length, written: covered.size })
}
