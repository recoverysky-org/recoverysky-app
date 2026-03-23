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

import { logger } from "@/utils/logger"

import { feedbackRepo, type FeedbackRecord } from "./repositories"

const log = logger.child({ module: "feedbackCache" })

// In-memory cache: mid -> FeedbackRecord
let cache = new Map<string, FeedbackRecord>()
let loaded = false

// Listeners for reactive updates
type FeedbackListener = (mid: string, feedback: FeedbackRecord) => void
const listeners = new Set<FeedbackListener>()

/**
 * Notify all listeners of a feedback change
 */
function notifyListeners(mid: string, feedback: FeedbackRecord) {
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
 * Feedback cache service
 */
export const feedbackCache = {
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
   */
  get(mid: string): FeedbackRecord | null {
    return cache.get(mid) ?? null
  },

  /**
   * Get all cached feedback records
   */
  getAll(): Map<string, FeedbackRecord> {
    return new Map(cache)
  },

  /**
   * Toggle love status for a meeting
   * Updates cache immediately, then persists to SQLite
   * Returns new loves state
   */
  async toggleLove(mid: string): Promise<boolean> {
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
   * Set rating for a meeting (0-5)
   * Updates cache immediately, then persists to SQLite
   */
  async setRating(mid: string, rating: number): Promise<void> {
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
   */
  async recordJoin(mid: string): Promise<void> {
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
