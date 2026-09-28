/**
 * Pure decisions for the recovery date at profile hydration.
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules (Vitest
 * cannot resolve the `@/` alias; see CLAUDE.md "Test Runner Split"). The I/O
 * that feeds it — the SQLite load, the install time from expo-application —
 * lives in db/ProfileHydrator.tsx.
 *
 * ADDED 2026-09-26. `recoveryDate` is a volatile ProfileStore field whose
 * in-memory default is "today", and until now it only reached encrypted SQLite
 * when the user touched a date picker. A user who accepted the onboarding
 * default therefore had nothing stored: every cold start recomputed "today",
 * so their clean time read 0 days forever and the date walked forward with the
 * calendar. This has been true since the field moved into the volatile tier
 * (16aeab1). New installs are fixed by completeOnboarding() persisting the
 * date; installs already in that state are repaired here.
 */

/**
 * Where the current recovery date came from.
 *
 * - `"user"`: the user picked it (a date picker) or it was imported from the
 *   old Firebase app. A Firebase import must not overwrite it.
 * - `"default"`: the app chose it (onboarding default, or the backfill below).
 *   A Firebase import may replace it — that is the whole point of the import.
 * - `""`: not yet migrated. Only an install predating this module is in this
 *   state, and only until its first hydration.
 *
 * Before this module, the date could ONLY reach SQLite through a user action,
 * so "a stored date exists" is an exact test for `"user"` during the one-time
 * migration from `""`. That stops being true the moment completeOnboarding()
 * persists the default — which is why the migration keys off `""` and runs once.
 */
export type RecoveryDateSource = "" | "default" | "user"

export interface RecoveryDateHydrationInput {
  /** The date stored in encrypted SQLite, or undefined when none is stored. */
  storedDate: string | undefined
  source: RecoveryDateSource
  onboardingCompleted: boolean
  /** Local calendar day of the app install, or null when unknown (web). */
  installDate: string | null
  /** Local calendar day right now. */
  today: string
}

export type RecoveryDateHydrationDecision =
  /** Keep the stored date; record the (possibly migrated) source. */
  | { kind: "use-stored"; source: "default" | "user" }
  /** Nothing stored after onboarding: persist `date` as the app's default. */
  | { kind: "backfill"; date: string }
  /** Mid-onboarding: leave the in-memory default; completeOnboarding persists it. */
  | { kind: "keep-default" }

export function decideRecoveryDateHydration(
  input: RecoveryDateHydrationInput,
): RecoveryDateHydrationDecision {
  const { storedDate, source, onboardingCompleted, installDate, today } = input

  if (storedDate) {
    return { kind: "use-stored", source: source === "" ? "user" : source }
  }

  if (!onboardingCompleted) return { kind: "keep-default" }

  // The install day is exactly the date these users saw and accepted on the
  // onboarding screen, so it restores what they chose rather than inventing a
  // new date. Fall back to today when it's unknown (web returns null) or
  // implausible (a clock set back after install would otherwise put the
  // recovery date in the future) — either way the date stops drifting.
  const date = installDate && installDate <= today ? installDate : today
  return { kind: "backfill", date }
}

/**
 * Whether a Firebase import may write its recovery date over the current one.
 *
 * CHANGED 2026-09-26: this used to be `recoveryDate === today` in
 * OnboardingImport, which only worked because the unsaved default re-read as
 * today on every launch. With the date now persisted, a default from last week
 * no longer equals today, and that comparison would silently drop the user's
 * real Firebase clean date.
 */
export function mayImportRecoveryDate(source: RecoveryDateSource): boolean {
  return source !== "user"
}
