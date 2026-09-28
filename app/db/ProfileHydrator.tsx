/**
 * ProfileHydrator Component
 *
 * Hydrates sensitive profile data from encrypted SQLite once the database is ready.
 * This is a headless component (renders null) that handles the async hydration.
 *
 * Place this inside DatabaseProvider and RootStoreProvider:
 * <RootStoreProvider>
 *   <DatabaseProvider>
 *     <ProfileHydrator />
 *     ...
 *   </DatabaseProvider>
 * </RootStoreProvider>
 */

import { useEffect, useRef } from "react"
import * as Application from "expo-application"

import { useStores } from "@/models"
import { todayLocalISODate } from "@/utils/localDate"
import { logger } from "@/utils/logger"
import { decideRecoveryDateHydration } from "@/utils/recoveryDateLogic"

import { useDatabase } from "./DatabaseProvider"
import { profileRepository } from "./repositories"

const log = logger.child({ module: "ProfileHydrator" })

/**
 * Local calendar day the app was installed, or null when unavailable. Web's
 * implementation resolves null despite the `Promise<Date>` type, and a native
 * failure must not block hydration — the caller falls back to today.
 */
async function loadInstallDate(): Promise<string | null> {
  try {
    const installed: Date | null = await Application.getInstallationTimeAsync()
    return installed ? todayLocalISODate(installed) : null
  } catch (err) {
    log.warn("Install time unavailable", { error: String(err) })
    return null
  }
}

/**
 * Hydrates profile store with sensitive data from SQLite.
 * Renders nothing - just handles the side effect.
 */
export function ProfileHydrator(): null {
  const { status } = useDatabase()
  const { profileStore } = useStores()
  const hasHydrated = useRef(false)

  useEffect(() => {
    // Only hydrate once, when database is ready
    if ((status === "open" || status === "seeded") && !hasHydrated.current) {
      hasHydrated.current = true

      log.info("Database ready, hydrating profile from SQLite")

      profileRepository
        .load()
        .then(async (data) => {
          if (data) {
            profileStore.hydrateFromSQLite(data)
            log.info("Profile hydrated from SQLite", {
              hasShortName: !!data.shortName,
              hasFellowship: !!data.fellowship,
              hasLanguage: !!data.language,
            })
          } else {
            log.info("No stored profile found, using defaults")
          }

          // ADDED 2026-09-26: repair installs whose recovery date was never
          // saved (onboarding default left untouched), which re-read as today
          // on every launch — see app/utils/recoveryDateLogic.ts. The install
          // time is only fetched when a backfill could actually need it.
          const storedDate = data?.recoveryDate
          const needsInstallDate = !storedDate && profileStore.onboardingCompleted
          const installDate = needsInstallDate ? await loadInstallDate() : null
          const decision = decideRecoveryDateHydration({
            storedDate,
            source: profileStore.recoveryDateSource,
            onboardingCompleted: profileStore.onboardingCompleted,
            installDate,
            today: todayLocalISODate(),
          })
          if (decision.kind === "backfill") {
            profileStore.setDefaultRecoveryDate(decision.date)
            // Which fallback won, never the date itself (the recovery date is
            // sensitive — it lives only in encrypted SQLite). false means the
            // install time was unavailable or in the future and today was used;
            // true on a reinstalled device still means "reinstall day".
            log.info("Backfilled unsaved recovery date", {
              usedInstallDate: installDate !== null && decision.date === installDate,
            })
          } else if (decision.kind === "use-stored") {
            profileStore.setRecoveryDateSource(decision.source)
          }
        })
        .catch((err) => {
          log.error("Failed to hydrate profile from SQLite", { error: String(err) })
        })
    }
  }, [status, profileStore])

  return null
}
