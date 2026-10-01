/**
 * One full-screen modal at a time. ADDED 2026-10-01 with VerifyEmailGate:
 * it and AnnouncementGate both check on mount and on every foreground, and
 * two React Native <Modal>s presenting together fail on iOS ("already
 * presenting"). Whoever claims first shows; the other sees `overlayOwner()`
 * change (it is MobX-observable) and checks again once it is free.
 *
 * No `@/` imports: vitest loads this.
 */
import { observable, runInAction } from "mobx"

const owner = observable.box<string | null>(null)

/** True when `name` now holds (or already held) the overlay. */
export function claimOverlay(name: string): boolean {
  const current = owner.get()
  if (current !== null && current !== name) return false
  runInAction(() => owner.set(name))
  return true
}

/** A release by anyone but the owner is ignored. */
export function releaseOverlay(name: string): void {
  if (owner.get() === name) runInAction(() => owner.set(null))
}

export function overlayOwner(): string | null {
  return owner.get()
}
