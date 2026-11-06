/**
 * Which of the bundled My Day photos to show. Pure (no `@/` imports) so vitest covers it; the
 * photos themselves are `require`d in `app/theme/myDayPhotos.ts`.
 *
 * `random` is injectable for tests. The min() guards a random() of exactly 1 (not a legal
 * Math.random result, but a cheap overflow guard); an empty set answers 0.
 */
export function pickPhotoIndex(count: number, random: () => number = Math.random): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.floor(random() * count))
}
