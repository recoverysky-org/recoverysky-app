/**
 * SyncService - Manages offline-first synchronization
 *
 * Handles syncing local changes to the server when connectivity is available.
 * Uses the sync_queue table to store pending operations.
 *
 * Strategy: Client-wins (local changes take precedence over server)
 *
 * @example
 * import { SyncService } from "@/services/sync"
 * import { syncQueueRepo } from "@/db"
 * import { api } from "@/services/api"
 *
 * const syncService = new SyncService(syncQueueRepo, api)
 *
 * // Sync all pending operations
 * const result = await syncService.syncAll()
 * if (result.ok) {
 *   console.log("Synced", result.value.synced, "items")
 * }
 */

import type {
  SyncQueueRepository,
  SyncQueueItem,
  SyncOperation,
} from "@recoverysky-org/common/sqlite"

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Number of successfully synced items */
  synced: number
  /** Number of failed items */
  failed: number
  /** Error messages for failed items */
  errors: Array<{ id: string; error: string }>
}

/**
 * API client interface expected by SyncService
 * Implement this interface in your API service
 */
export interface SyncApiClient {
  createMeeting(data: unknown): Promise<{ ok: boolean; error?: string }>
  updateMeeting(id: string, data: unknown): Promise<{ ok: boolean; error?: string }>
  deleteMeeting(id: string): Promise<{ ok: boolean; error?: string }>
  createSchedule(data: unknown): Promise<{ ok: boolean; error?: string }>
  updateSchedule(id: string, data: unknown): Promise<{ ok: boolean; error?: string }>
  deleteSchedule(id: string): Promise<{ ok: boolean; error?: string }>
}

/**
 * Configuration options for SyncService
 */
export interface SyncServiceConfig {
  /** Maximum retry attempts for failed items (default: 3) */
  maxRetries?: number
  /** Batch size for processing items (default: 10) */
  batchSize?: number
  /** Delay between batches in ms (default: 100) */
  batchDelay?: number
}

/**
 * SyncService manages offline-first data synchronization
 */
export class SyncService {
  private syncQueue: SyncQueueRepository
  private api: SyncApiClient
  private config: Required<SyncServiceConfig>
  private isSyncing = false

  constructor(syncQueue: SyncQueueRepository, api: SyncApiClient, config: SyncServiceConfig = {}) {
    this.syncQueue = syncQueue
    this.api = api
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      batchSize: config.batchSize ?? 10,
      batchDelay: config.batchDelay ?? 100,
    }
  }

  /**
   * Check if a sync is currently in progress
   */
  get syncing(): boolean {
    return this.isSyncing
  }

  /**
   * Sync all pending items to the server
   */
  async syncAll(): Promise<{ ok: true; value: SyncResult } | { ok: false; error: Error }> {
    if (this.isSyncing) {
      return { ok: false, error: new Error("Sync already in progress") }
    }

    this.isSyncing = true
    const result: SyncResult = { synced: 0, failed: 0, errors: [] }

    try {
      // Get all pending items
      const pendingResult = await this.syncQueue.getPending(this.config.maxRetries)
      if (!pendingResult.ok) {
        return { ok: false, error: new Error(pendingResult.error.message) }
      }

      const pending = pendingResult.value
      if (pending.length === 0) {
        return { ok: true, value: result }
      }

      // Process in batches
      for (let i = 0; i < pending.length; i += this.config.batchSize) {
        const batch = pending.slice(i, i + this.config.batchSize)

        await Promise.all(
          batch.map(async (item) => {
            const itemResult = await this.syncItem(item)
            if (itemResult.ok) {
              result.synced++
            } else {
              result.failed++
              result.errors.push({ id: item.id, error: itemResult.error })
            }
          }),
        )

        // Small delay between batches to avoid overwhelming the server
        if (i + this.config.batchSize < pending.length) {
          await this.delay(this.config.batchDelay)
        }
      }

      return { ok: true, value: result }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Sync a single item
   */
  private async syncItem(
    item: SyncQueueItem,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    // Mark as syncing
    await this.syncQueue.markSyncing(item.id)

    try {
      const apiResult = await this.callApi(item)

      if (apiResult.ok) {
        await this.syncQueue.markSynced(item.id)
        return { ok: true }
      } else {
        await this.syncQueue.markFailed(item.id, apiResult.error || "Unknown error")
        return { ok: false, error: apiResult.error || "Unknown error" }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.syncQueue.markFailed(item.id, errorMessage)
      return { ok: false, error: errorMessage }
    }
  }

  /**
   * Call the appropriate API method based on table and operation
   */
  private async callApi(item: SyncQueueItem): Promise<{ ok: boolean; error?: string }> {
    const payload = item.payload ? JSON.parse(item.payload) : undefined
    const operation = item.operation as SyncOperation

    switch (item.tableName) {
      case "meetings":
        switch (operation) {
          case "create":
            return this.api.createMeeting(payload)
          case "update":
            return this.api.updateMeeting(item.recordId, payload)
          case "delete":
            return this.api.deleteMeeting(item.recordId)
        }
        break

      case "schedules":
        switch (operation) {
          case "create":
            return this.api.createSchedule(payload)
          case "update":
            return this.api.updateSchedule(item.recordId, payload)
          case "delete":
            return this.api.deleteSchedule(item.recordId)
        }
        break

      default:
        return { ok: false, error: `Unknown table: ${item.tableName}` }
    }

    return { ok: false, error: `Unknown operation: ${operation}` }
  }

  /**
   * Queue an operation for sync
   */
  async queue(
    tableName: string,
    recordId: string,
    operation: SyncOperation,
    payload?: unknown,
  ): Promise<{ ok: true; id: string } | { ok: false; error: Error }> {
    try {
      const result = await this.syncQueue.enqueue({
        tableName,
        recordId,
        operation,
        payload: payload ? JSON.stringify(payload) : undefined,
      })

      if (result.ok) {
        return { ok: true, id: result.value }
      } else {
        return { ok: false, error: new Error(result.error.message) }
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  /**
   * Get sync queue statistics
   */
  async getStats(): Promise<{
    pending: number
    syncing: number
    synced: number
    failed: number
    total: number
  } | null> {
    const result = await this.syncQueue.getStats()
    return result.ok ? result.value : null
  }

  /**
   * Clear successfully synced items older than specified days
   */
  async clearSynced(olderThanDays = 7): Promise<number> {
    const result = await this.syncQueue.clearSynced(olderThanDays)
    return result.ok ? result.value : 0
  }

  /**
   * Reset all failed items to pending for retry
   */
  async resetFailed(): Promise<number> {
    const result = await this.syncQueue.resetFailed()
    return result.ok ? result.value : 0
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
