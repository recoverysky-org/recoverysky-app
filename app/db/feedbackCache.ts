/**
 * FeedbackCache - In-memory cache with write-through to SQLite
 *
 * Provides fast synchronous reads for feedback data. All writes
 * update the in-memory cache first, then persist to SQLite.
 *
 * @example
 * import { feedbackCache } from "@/db"
 *
 * // Initialize at startup (after DB ready)
 * await feedbackCache.loadAll()
 *
 * // Fast synchronous reads
 * const fb = feedbackCache.get("meeting-123")
 *
 * // Writes update cache + SQLite
 * await feedbackCache.toggleLove("meeting-123")
 */

import { reconcileScheduleFeedback, type ScheduleRowLike } from "@/utils/favoriteLogic"
import { logger } from "@/utils/logger"

import { createSuppression } from "./feedbackSuppressionLogic"
import { feedbackRepo, type FeedbackRecord } from "./repositories"

const log = logger.child({ module: "feedbackCache" })

// In-memory cache: mid -> FeedbackRecord
let cache = new Map<string, FeedbackRecord>()
let loaded = false

// Schedule payloads that arrived before `loadAll()` finished, replayed through
// `reconcileSchedules` once it does. ADDED 2026-10-02: MeetingProvider mounts
// in the same commit that starts `loadAll()` and child effects flush first, so
// the first Live fetch races the SQLite load. When the network won, the
// payload hit `if (!loaded) return` and its schedules went unreconciled until
// the next quarter-hour poll. Cleared on load, so it holds at most the few
// payloads of a cold start.
let pendingReconcile: (readonly ScheduleRowLike[])[] = []

// Listeners for reactive updates
type FeedbackListener = (mid: string, feedback: FeedbackRecord) => void
const listeners = new Set<FeedbackListener>()

// Guest-mode switch. ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md):
// while it is active this cache shows nothing, writes nothing and notifies no
// one. The rows stay loaded underneath for the owner's next session. The
// predicate is injected through `setSuppressedWhen` (see
// feedbackSuppressionLogic.ts for why, and for its fail-closed rule).
const suppression = createSuppression()

/**
 * Notify all listeners of a feedback change
 * CHANGED 2026-10-11: silent while guest mode suppresses the cache. loadAll()
 * replays every loaded row through here, which would otherwise push the
 * owner's hearts and stars into a guest's Meetings lists.
 */
function notifyListeners(mid: string, feedback: FeedbackRecord) {
  if (suppression.active()) return
  listeners.forEach((listener) => listener(mid, feedback))
}

/**
 * Default feedback values for new records
 */
function defaultFeedback(mid: string): FeedbackRecord {
  return {
    mid,
    loves: false,
    rates: 0,
    joins: 0,
    lastJoin: 0,
  }
}

/**
 * Shared body of `setLoveForMids` / `setRatingForMids`: SET one field on a set
 * of meetings, in two phases.
 *
 * 1. **Synchronous optimistic apply.** Every mid's cache entry is updated and
 *    its listeners notified BEFORE the first `await`, i.e. within the tap's own
 *    JS tick. React 18 batches the resulting setState calls, so the three
 *    subscribed Meetings segments re-render once each instead of once per
 *    sibling, and a popup subscribed to its own mid paints the new heart/star
 *    on the tap itself.
 * 2. **Background persist.** The SQLite writes run in parallel (the driver
 *    serialises them anyway; this just stops N bridge round-trip latencies
 *    from adding up) and any failed row is reverted and re-notified.
 *
 * ADDED 2026-09-09. The previous shape interleaved the two phases: one
 * optimistic update, one await on SQLite, one notification, repeat — for a
 * week-long schedule that was ~14 bridge calls with three list re-renders
 * between each, all on the JS thread the popup was awaiting before it would
 * flip its icon. Users read that as a sluggish, delayed heart.
 *
 * The revert only fires when the cache still holds *our* optimistic record.
 * With writes now running in the background a second tap can land before the
 * first one's write settles, and blindly restoring `previous` would clobber
 * the newer value with an older one.
 *
 * Returns true when every write persisted.
 */
async function applyToMids(args: {
  mids: string[]
  /** Skip the write when the record is already at the target value. */
  alreadyAt: (record: FeedbackRecord | null) => boolean
  patch: Partial<FeedbackRecord>
  persist: (mid: string) => Promise<{ ok: boolean; error?: unknown }>
  label: string
}): Promise<boolean> {
  const { mids, alreadyAt, patch, persist, label } = args

  // Phase 1 — synchronous. No await may appear in this loop.
  const pending: { mid: string; previous: FeedbackRecord | null; updated: FeedbackRecord }[] = []
  for (const mid of mids) {
    const previous = cache.get(mid) ?? null
    if (alreadyAt(previous)) continue // already there; skip the write
    const updated: FeedbackRecord = { ...(previous ?? defaultFeedback(mid)), ...patch }
    cache.set(mid, updated)
    notifyListeners(mid, updated)
    pending.push({ mid, previous, updated })
  }

  // Phase 2 — background.
  const outcomes = await Promise.all(
    pending.map(async ({ mid, previous, updated }) => {
      const result = await persist(mid)
      if (result.ok) return true
      log.error(`Failed to persist ${label}`, {
        mid,
        patch: JSON.stringify(patch),
        error: String(result.error),
      })
      if (cache.get(mid) !== updated) return false // a newer write owns this row now
      // Revert cache on failure — and notify, so rows already painted with
      // the optimistic value fall back in step with the store.
      if (previous === null) {
        cache.delete(mid) // was new and empty; remove rather than keep a phantom row
        notifyListeners(mid, defaultFeedback(mid))
      } else {
        cache.set(mid, previous)
        notifyListeners(mid, previous)
      }
      return false
    }),
  )

  const allPersisted = outcomes.every(Boolean)
  log.debug(`${label} for schedule`, { count: mids.length, written: pending.length, allPersisted })
  return allPersisted
}

/**
 * Feedback cache service
 */
export const feedbackCache = {
  /**
   * Hide this cache while `predicate` returns true: guest mode. ADDED
   * 2026-10-11 (spec 2026-09-27-guest-mode-design.md). The hearts, stars and
   * join counts here are the device owner's, and a guest may be a stranger
   * holding the owner's phone.
   *
   * app.tsx registers `() => authenticationStore.isGuest` once, right after
   * setupRootStore() and before any screen mounts. It is injected rather than
   * imported so app/db/ gains no runtime dependency on app/models/. While the
   * predicate is true, `get` returns null, `getAll` an empty Map, every write
   * is a no-op that returns its "nothing happened" value, and listeners are
   * not notified. It is read on every call, so Sign in brings the owner's
   * data back with no reload. Pure decision and fail-closed rule:
   * feedbackSuppressionLogic.ts.
   */
  setSuppressedWhen(predicate: () => boolean): void {
    suppression.setWhen(predicate)
  },

  /**
   * Load all feedback records from SQLite into memory
   * Call once at app startup after database is seeded
   */
  async loadAll(): Promise<void> {
    try {
      log.info("Loading feedback cache...")
      const result = await feedbackRepo.findAll()

      if (result.ok) {
        cache = new Map(result.value.map((fb) => [fb.mid, fb]))
        loaded = true
        log.info("Feedback cache loaded", { count: cache.size })
        // Notify listeners so components that mounted before cache loaded get updated
        cache.forEach((fb, mid) => notifyListeners(mid, fb))
      } else {
        log.error("Failed to load feedback cache", { error: String(result.error) })
        // Initialize empty cache so app can still function
        cache = new Map()
        loaded = true
      }
    } catch (error) {
      log.error("Error loading feedback cache", { error: String(error) })
      cache = new Map()
      loaded = true
    }
    const queued = pendingReconcile
    pendingReconcile = []
    for (const schedules of queued) this.reconcileSchedules(schedules)
  },

  /**
   * Check if cache has been loaded
   */
  isLoaded(): boolean {
    return loaded
  },

  /**
   * Get feedback for a meeting (synchronous, from memory)
   * Returns null if no feedback exists for this meeting
   * CHANGED 2026-10-11: also null while guest mode suppresses the cache (see
   * `setSuppressedWhen`).
   */
  get(mid: string): FeedbackRecord | null {
    if (suppression.active()) return null
    return cache.get(mid) ?? null
  },

  /**
   * Get all cached feedback records
   * CHANGED 2026-10-11: an empty Map while guest mode suppresses the cache
   * (see `setSuppressedWhen`).
   */
  getAll(): Map<string, FeedbackRecord> {
    if (suppression.active()) return new Map()
    return new Map(cache)
  },

  /**
   * Toggle love status for a meeting
   * Updates cache immediately, then persists to SQLite
   * Returns new loves state
   * CHANGED 2026-10-11: a no-op returning false while guest mode suppresses
   * the cache (see `setSuppressedWhen`); a guest's tap must not write the
   * owner's favorites.
   */
  async toggleLove(mid: string): Promise<boolean> {
    if (suppression.active()) return false
    // Get current or create new
    const current = cache.get(mid) ?? defaultFeedback(mid)
    const newLoves = !current.loves

    // Update cache immediately (optimistic)
    const updated: FeedbackRecord = { ...current, loves: newLoves }
    cache.set(mid, updated)

    // Persist to SQLite
    const result = await feedbackRepo.toggleLove(mid)
    if (!result.ok) {
      log.error("Failed to persist toggleLove", { mid, error: String(result.error) })
      // Revert cache on failure
      if (current.loves === false && current.rates === 0 && current.joins === 0) {
        cache.delete(mid) // Remove if it was new and empty
      } else {
        cache.set(mid, current) // Restore previous state
      }
      return current.loves
    }

    // Sync with actual SQLite state (in case of edge cases)
    const actualLoves = result.value
    if (actualLoves !== newLoves) {
      updated.loves = actualLoves
      cache.set(mid, updated)
    }

    // Notify listeners of the change
    notifyListeners(mid, cache.get(mid)!)

    log.debug("Toggle love", { mid, loves: actualLoves })
    return actualLoves
  },

  /**
   * Set love status for a set of meetings to one explicit value.
   *
   * ADDED 2026-09-04 for schedule-wide favorite propagation: the popups hand
   * this every mid in the tapped meeting's schedule (via
   * `decideScheduleLove` in utils/favoriteLogic.ts) so one heart tap
   * favorites/unfavorites the whole schedule. SET semantics, not per-mid
   * toggle — that is what lets a legacy mixed schedule converge on one tap.
   *
   * Per-mid optimistic update + persist, so one failed row doesn't hold the
   * rest hostage. Unlike toggleLove's older revert path, a revert here DOES
   * notify listeners — subscribed screens (`displayFeedback` maps) would
   * otherwise keep the optimistic value the popup no longer shows.
   *
   * CHANGED 2026-09-09: two-phase via `applyToMids` — every optimistic
   * update lands synchronously before the first await, and the writes run in
   * the background. The popups no longer await this; they subscribe. See
   * `applyToMids` for the sluggish-tap failure this fixes.
   *
   * Returns true when every write persisted. The popups ignore this (their
   * subscription already reflects any revert); the favorites migration uses
   * it to avoid setting its done-flag over failed SQLite writes.
   *
   * CHANGED 2026-10-11: a no-op returning false while guest mode suppresses
   * the cache (see `setSuppressedWhen`). False because nothing was written,
   * so a caller keyed on success never records a write that did not happen.
   */
  async setLoveForMids(mids: string[], loves: boolean): Promise<boolean> {
    if (suppression.active()) return false
    return applyToMids({
      mids,
      alreadyAt: (record) => (record?.loves ?? false) === loves,
      patch: { loves },
      persist: (mid) => feedbackRepo.setLove(mid, loves),
      label: "setLoveForMids",
    })
  },

  /**
   * Set the star rating for a set of meetings to one explicit value (0–5).
   *
   * ADDED 2026-09-09 for schedule-wide ratings, the star twin of
   * `setLoveForMids`: the popups hand this every mid in the tapped meeting's
   * schedule (via `decideScheduleRating` in utils/favoriteLogic.ts) so one
   * star tap rates the whole schedule. SET semantics — a legacy mixed
   * schedule converges on the tapped value.
   *
   * Same two-phase optimistic-then-persist contract as `setLoveForMids` (see
   * `applyToMids`). Returns true when every write persisted (the ratings
   * migration keys its done-flag on it).
   *
   * CHANGED 2026-10-11: a no-op returning false while guest mode suppresses
   * the cache, as in `setLoveForMids`.
   */
  async setRatingForMids(mids: string[], rating: number): Promise<boolean> {
    if (suppression.active()) return false
    const clampedRating = Math.max(0, Math.min(5, rating))
    return applyToMids({
      mids,
      alreadyAt: (record) => (record?.rates ?? 0) === clampedRating,
      patch: { rates: clampedRating },
      persist: (mid) => feedbackRepo.setRating(mid, clampedRating),
      label: "setRatingForMids",
    })
  },

  /**
   * Bring legacy per-meeting hearts/stars up to schedule-wide for a batch of
   * schedules that just arrived from the API. ADDED 2026-09-14, replacing the
   * one-time `migrateFavorites` pass that looked every favorite up over the
   * network — see `reconcileScheduleFeedback` for the full story.
   *
   * Call it BEFORE mapping the payload to rows: the setters' optimistic
   * phase is synchronous (see `applyToMids`), so the `feedback` snapshot each
   * fetch site takes right after already reflects the propagated value and
   * the row paints with its heart on first render. Deliberately not async —
   * the caller must not have to await it, and the writes settle in the
   * background exactly like a popup tap. Uniform schedules cost one Map read
   * per cell and produce no writes.
   *
   * CHANGED 2026-10-11: a no-op while guest mode suppresses the cache (see
   * `setSuppressedWhen`). The reconcile writes the owner's hearts and stars,
   * so a guest's payloads are dropped, not queued. Nothing is lost: it runs on
   * every payload, so the owner's fetches after Sign in reconcile what they
   * carry.
   */
  reconcileSchedules(schedules: readonly ScheduleRowLike[]): void {
    if (suppression.active()) return
    // CHANGED 2026-10-02: queued instead of dropped before the cache loads
    // (see `pendingReconcile`). Planning against an empty cache would see no
    // loved sibling and write nothing, so it has to wait for the real one.
    if (!loaded) {
      pendingReconcile.push(schedules)
      return
    }
    const plan = reconcileScheduleFeedback(schedules, (mid) => cache.get(mid) ?? null)
    if (plan.loveMids.length === 0 && plan.ratingWrites.length === 0) return
    log.info("Reconciling legacy per-meeting feedback to schedule-wide", {
      loveSchedules: plan.loveMids.length,
      ratingSchedules: plan.ratingWrites.length,
    })
    for (const mids of plan.loveMids) void this.setLoveForMids(mids, true)
    for (const w of plan.ratingWrites) void this.setRatingForMids(w.mids, w.rates)
  },

  /**
   * Set rating for a meeting (0-5)
   * Updates cache immediately, then persists to SQLite
   * NOTE 2026-09-09: no longer called by the popups, which rate schedule-wide
   * through `setRatingForMids` above. Kept as the single-meeting primitive,
   * like `toggleLove` beside `setLoveForMids`.
   * CHANGED 2026-10-11: a no-op while guest mode suppresses the cache (see
   * `setSuppressedWhen`).
   */
  async setRating(mid: string, rating: number): Promise<void> {
    if (suppression.active()) return
    const clampedRating = Math.max(0, Math.min(5, rating))

    // Get current or create new
    const current = cache.get(mid) ?? defaultFeedback(mid)

    // Update cache immediately (optimistic)
    const updated: FeedbackRecord = { ...current, rates: clampedRating }
    cache.set(mid, updated)

    // Persist to SQLite
    const result = await feedbackRepo.setRating(mid, clampedRating)
    if (!result.ok) {
      log.error("Failed to persist setRating", {
        mid,
        rating: clampedRating,
        error: String(result.error),
      })
      // Revert cache on failure
      cache.set(mid, current)
      return
    }

    // Notify listeners of the change
    notifyListeners(mid, cache.get(mid)!)

    log.debug("Set rating", { mid, rating: clampedRating })
  },

  /**
   * Record a join event (increment joins, update lastJoin)
   * Updates cache immediately, then persists to SQLite
   * CHANGED 2026-10-11: a no-op while guest mode suppresses the cache (see
   * `setSuppressedWhen`), so a guest's joins never add to the owner's counts.
   */
  async recordJoin(mid: string): Promise<void> {
    if (suppression.active()) return
    const now = Date.now()

    // Get current or create new
    const current = cache.get(mid) ?? defaultFeedback(mid)

    // Update cache immediately (optimistic)
    const updated: FeedbackRecord = {
      ...current,
      joins: current.joins + 1,
      lastJoin: now,
    }
    cache.set(mid, updated)

    // Persist to SQLite
    const result = await feedbackRepo.recordJoin(mid)
    if (!result.ok) {
      log.error("Failed to persist recordJoin", { mid, error: String(result.error) })
      // Revert cache on failure
      cache.set(mid, current)
      return
    }

    // Notify listeners of the change
    notifyListeners(mid, cache.get(mid)!)

    log.debug("Record join", { mid, joins: updated.joins })
  },

  /**
   * Clear the cache (for testing or reset)
   */
  clear(): void {
    cache.clear()
    pendingReconcile = []
    loaded = false
  },

  /**
   * Subscribe to feedback changes
   * Returns unsubscribe function
   */
  subscribe(listener: FeedbackListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
