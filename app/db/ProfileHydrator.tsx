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

import { useStores } from "@/models"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"
import { profileRepository } from "./repositories"

const log = logger.child({ module: "ProfileHydrator" })

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
        .then((data) => {
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
        })
        .catch((err) => {
          log.error("Failed to hydrate profile from SQLite", { error: String(err) })
        })
    }
  }, [status, profileStore])

  return null
}
