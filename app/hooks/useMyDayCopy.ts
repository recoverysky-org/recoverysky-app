/**
 * useMyDayCopy Hook
 *
 * The `MyDayCopy` object the My Day provider takes, built from the app's i18n so the
 * package shows the user's language instead of its English default. The pure mapping is
 * `buildMyDayCopy` (`app/utils/myDayCopy.ts`, vitest-covered); this is the React half.
 *
 * Memoised on `i18n.language`: the copy object is passed down through the package's
 * context, so a fresh object every render would re-render every My Day consumer. A
 * language change (Settings → Language calls `changeLanguage()`) changes
 * `i18n.language`, which re-renders this hook through react-i18next and rebuilds the copy.
 *
 * ADDED 2026-11-04 (My Day tab, task 5).
 */
import { useMemo } from "react"
import type { MyDayCopy } from "@daily-dash/my-day/copy"
import { useTranslation } from "react-i18next"

import { translate, type TxKeyPath } from "@/i18n"
import { buildMyDayCopy } from "@/utils/myDayCopy"

export function useMyDayCopy(): MyDayCopy {
  const { i18n } = useTranslation()
  // `i18n.language` is the only input that changes the result; `translate` reads the
  // global i18next instance, which react-i18next's `i18n` is the same object as.
  return useMemo(
    () => buildMyDayCopy((k, o) => translate(k as TxKeyPath, o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language],
  )
}
