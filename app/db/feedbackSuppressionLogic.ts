/**
 * Guest-mode suppression switch for feedbackCache (hearts, stars, joins).
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * The predicate is injected from app.tsx (`() => authStore.isGuest`) so
 * app/db/ gains no runtime dependency on app/models/. Fails CLOSED: if the
 * predicate throws, treat it as suppressed — showing the owner's favorites to
 * a guest is the failure this exists to prevent.
 * Pure, no `@/` imports.
 */
export function createSuppression() {
  let when: (() => boolean) | undefined
  return {
    setWhen(predicate: () => boolean) {
      when = predicate
    },
    active(): boolean {
      if (!when) return false
      try {
        return when()
      } catch {
        return true
      }
    },
  }
}
