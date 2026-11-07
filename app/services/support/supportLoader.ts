/**
 * Reads the support contacts at cold start and on later foregrounds until a read works.
 * ADDED 2026-11-06 (final review I-3, M-6). Pure: everything arrives as a dependency and there are
 * no `@/` imports, so vitest can cover every branch.
 *
 * Why it exists: a locked keychain (a background launch) can fail both steps of the cold start, and
 * the store then stays un-hydrated until something tries again. The fresh-install clear is the part
 * that must not be skipped on that retry. If it failed, the keychain may still hold a previous
 * installer's contacts, so a clear that has not succeeded blocks the read that would show them.
 *
 * Never rejects: init awaits this, and a keychain failure must not throw out of init.
 */
export interface SupportLoaderDeps {
  /** True on a fresh install: no persisted root snapshot, see `app.tsx`. */
  clearPending: boolean
  /** True when the keychain item is confirmed gone. */
  clear: () => Promise<boolean>
  hydrate: () => Promise<void>
  isHydrated: () => boolean
}

export interface SupportLoader {
  load: () => Promise<void>
}

export function createSupportLoader({
  clearPending,
  clear,
  hydrate,
  isHydrated,
}: SupportLoaderDeps): SupportLoader {
  let clearStillPending = clearPending
  // Init's load and a foreground retry can overlap; they share one run rather than delete and read
  // twice.
  let running: Promise<void> | null = null

  const run = async () => {
    try {
      if (clearStillPending) {
        if (!(await clear())) return
        clearStillPending = false
      }
      if (!isHydrated()) await hydrate()
    } catch {
      // Injected storage never throws today; defended anyway. Nothing is logged: this module has no
      // logger, and error text could echo stored data. The next foreground tries again.
    }
  }

  return {
    load() {
      running ??= run().finally(() => {
        running = null
      })
      return running
    },
  }
}
