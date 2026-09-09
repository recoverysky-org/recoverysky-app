/**
 * One-time migrations: per-meeting feedback → schedule-wide feedback.
 *
 * ADDED 2026-09-04, alongside the schedule-wide favorite change: hearts set
 * before that update marked only the single tapped meeting, so a user's
 * Monday favorite left Tue/Wed/… occurrences of the same schedule unloved.
 * On first run after the update this walks every currently-loved meeting,
 * asks the API which schedule it belongs to, and favorites the whole
 * schedule — after which the popups' schedule-wide toggle keeps everything
 * consistent on its own.
 *
 * CHANGED 2026-09-09: star ratings went schedule-wide too, and get the same
 * treatment under their own flag. The walk is shared (`runSchedulePass`);
 * each migration supplies its seeds and its writer. Ratings walk highest star
 * first so a schedule holding mixed legacy ratings ends on its best one — see
 * `orderRatedForMigration` — and, like favorites, the pass only ever sets a
 * value, it never clears one.
 *
 * Flag semantics: an MMKV done-flag is written ONLY after a fully
 * successful pass. Any transient failure (offline launch, API timeout,
 * failed SQLite write) aborts the pass with the flag unset, and the next
 * cold start retries the whole thing — safe because the operation is
 * idempotent (`setLoveForMids` / `setRatingForMids` skip mids already at
 * the value). `not-found` / `bad-data` lookups are counted as handled
 * instead: a favorite or rating on a meeting delisted upstream must not
 * block the flag forever. The per-outcome rule lives in
 * `classifyMigrationLookup` (vitest-covered).
 *
 * Runs once per install, fired by `FavoritesMigrator` (app/db/) after the
 * database is seeded. Like services/sync, this imports the specific `@/db/*`
 * modules rather than the `@/db` barrel — the barrel exports the migrator
 * component, which imports this service, and the barrel import would hand
 * depcruise that cycle.
 */
import { feedbackCache } from "@/db/feedbackCache"
import { api } from "@/services/api"
import {
  classifyMigrationLookup,
  collectScheduleMids,
  orderRatedForMigration,
} from "@/utils/favoriteLogic"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "migrateFavorites" })

/** MMKV done-flags. Bump a suffix if that migration ever needs to re-run. */
export const FAVORITES_MIGRATION_KEY = "favorites.scheduleMigration.v1"
export const RATINGS_MIGRATION_KEY = "ratings.scheduleMigration.v1"

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

/** One schedule-wide propagation pass: what to walk, and how to write it. */
interface SchedulePass<V> {
  /** MMKV done-flag for this pass. */
  flagKey: string
  /** Short name for logs. */
  name: string
  /**
   * Seeds to walk, in order. Each is a meeting whose value should be SET on
   * its whole schedule. Order matters when two seeds share a schedule: the
   * first one to reach it wins, and its siblings are then skipped.
   */
  seeds: () => { mid: string; value: V }[]
  /** Writer with `setLoveForMids` semantics: returns true when every row persisted. */
  write: (mids: string[], value: V) => Promise<boolean>
}

async function runSchedulePass<V>(pass: SchedulePass<V>): Promise<void> {
  if (loadString(pass.flagKey) === "done") return

  if (!(await waitForFeedbackCache())) {
    log.warn("Feedback cache never loaded; deferring migration to next launch", {
      pass: pass.name,
    })
    return
  }

  const seeds = pass.seeds()

  if (seeds.length === 0) {
    saveString(pass.flagKey, "done")
    log.info("No pre-existing rows; migration trivially complete", { pass: pass.name })
    return
  }

  log.info("Migrating to schedule-wide", { pass: pass.name, count: seeds.length })

  // Mids already written by an earlier schedule in this pass — two seeds
  // often share one schedule, and the second lookup would be a wasted round
  // trip (and, for ratings, would overwrite the higher star that got there
  // first).
  const covered = new Set<string>()

  for (const { mid, value } of seeds) {
    if (covered.has(mid)) continue

    const outcome = await api.getScheduleByMeetingIdAnyVenue(mid)
    if (outcome.kind !== "ok") {
      if (classifyMigrationLookup(outcome.kind) === "abort") {
        log.info("Migration aborted; will retry next launch", {
          pass: pass.name,
          mid,
          kind: outcome.kind,
        })
        return
      }
      // skip: delisted upstream / malformed — handled, nothing to propagate
      covered.add(mid)
      continue
    }

    const mids = collectScheduleMids(mid, outcome.schedule.data)
    const allPersisted = await pass.write(mids, value)
    if (!allPersisted) {
      log.info("Migration aborted on failed write; will retry next launch", {
        pass: pass.name,
        mid,
      })
      return
    }
    mids.forEach((m) => covered.add(m))
  }

  saveString(pass.flagKey, "done")
  log.info("Migration complete", { pass: pass.name, seeds: seeds.length, written: covered.size })
}

export async function migrateFavoritesToSchedules(): Promise<void> {
  await runSchedulePass<boolean>({
    flagKey: FAVORITES_MIGRATION_KEY,
    name: "favorites",
    // The migration only ever favorites, it never clears.
    seeds: () =>
      [...feedbackCache.getAll().values()]
        .filter((fb) => fb.loves)
        .map((fb) => ({ mid: fb.mid, value: true })),
    write: (mids, loves) => feedbackCache.setLoveForMids(mids, loves),
  })
}

export async function migrateRatingsToSchedules(): Promise<void> {
  await runSchedulePass<number>({
    flagKey: RATINGS_MIGRATION_KEY,
    name: "ratings",
    // Highest star first: the first seed to reach a schedule sets it and
    // covers its siblings, so a mixed legacy schedule lands on its best rating.
    seeds: () =>
      orderRatedForMigration([...feedbackCache.getAll().values()]).map((fb) => ({
        mid: fb.mid,
        value: fb.rates,
      })),
    write: (mids, rates) => feedbackCache.setRatingForMids(mids, rates),
  })
}

/** Both passes, in order. Each guards on its own flag, so re-running is free. */
export async function migrateFeedbackToSchedules(): Promise<void> {
  await migrateFavoritesToSchedules()
  await migrateRatingsToSchedules()
}
