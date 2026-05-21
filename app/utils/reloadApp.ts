/**
 * Safe app-reload helper.
 *
 * Funnels every `Updates.reloadAsync()` call site through one place so we can
 * deterministically tear down JSI-backed native resources BEFORE the JS
 * runtime is destroyed.
 *
 * Why this exists: we shipped a Sentry crash on 4.5.0 —
 *   EXC_BAD_ACCESS in `.cxx_destruct` → `SharedObjectRegistry.clear` →
 *   `jsi::WeakObject::~WeakObject` — that fired during an OTA reload.
 * expo-modules-core walks every registered JSI SharedObject on teardown and
 * runs its C++ destructor on a background dispatch queue; if the Hermes
 * runtime is already being invalidated, a WeakObject destructor dereferences
 * the now-null runtime pointer and crashes. The expo-sqlite database handle
 * is one such SharedObject and we were leaving it open at reload time.
 *
 * Closing the DB here, while the runtime is still alive, releases that
 * SharedObject deterministically so the registry has nothing dangling to
 * destroy. It does NOT guarantee the upstream race never fires for some
 * other module's SharedObject, but it removes the one we were clearly
 * leaving behind.
 *
 * Always reloads even if the close throws — a reload that crashes on the way
 * out is still better than a stuck app, and the close is best-effort cleanup.
 */

import * as Updates from "expo-updates"

import { closeDb } from "@/db/provider"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "reloadApp" })

/**
 * Close JSI-backed native resources, then reload the JS bundle.
 *
 * @param onError Optional handler if `reloadAsync` itself rejects (e.g. to
 *   fall back to `BackHandler.exitApp()`). The DB-close step never rejects.
 */
export async function reloadApp(onError?: (e: unknown) => void): Promise<void> {
  try {
    // Deterministically release the expo-sqlite SharedObject before the
    // runtime tears down — see file header for the teardown-race rationale.
    await closeDb()
  } catch (e) {
    // Best-effort: a failed close must not block the reload.
    log.warn("closeDb before reload failed", { error: String(e) })
  }

  try {
    await Updates.reloadAsync()
  } catch (e) {
    log.warn("reloadAsync failed", { error: String(e) })
    onError?.(e)
  }
}
