/**
 * The ONE Daily Dash session on this device, built lazily from host deps that
 * app.tsx injects once (`configureDailyDash`). ADDED 2026-11-04 (My Day tab).
 *
 * Why lazily and module-scoped: the session owns the device's Daily Dash
 * records in the vault, so two of them would race each other's exchange and
 * refresh. `ClientProvider` (under the My Day tab) is given this instance via
 * its `session` prop instead of building its own. Building on first use (not
 * at import) keeps a build without `EXPO_PUBLIC_DAILY_DASH_API_URL` from ever
 * creating one, and keeps this file importable before app.tsx has the root
 * store.
 *
 * Everything from the app arrives through `DailyDashHostDeps`, so this folder
 * never imports `@/models` (depcruise: `services/dailyDash` → `utils`,
 * `services/tracking`, never `models`).
 */
import { AppState } from "react-native"
import * as Application from "expo-application"
import * as Updates from "expo-updates"
import { createClientSession, err, internal, ok, sessionRefusal } from "@daily-dash/client"
import type {
  AppError,
  AppResult,
  ClientConnectivity,
  ClientIdentity,
  ClientProduct,
  Logger,
  Session,
  SignIn,
} from "@daily-dash/client"
import { refusalOf } from "@daily-dash/sdk"

import { trackEvent } from "@/services/tracking"
import { promptStoreUpdate } from "@/utils/checkForUpdates"
import { logger } from "@/utils/logger"
import { isValidDailyDashUrl } from "@/utils/myDayTabLogic"

import { createDailyDashConnectivity } from "./dailyDashConnectivity"
import { createDailyDashDriver } from "./dailyDashDriver"
import type { DailyDashDriver } from "./dailyDashDriver"
import { createDailyDashLogger } from "./dailyDashLogger"
import { createDailyDashSignIn } from "./dailyDashSignIn"
import type { DailyDashSignInDeps } from "./dailyDashSignIn"

const log = logger.child({ module: "DailyDashSession" })

/** What app.tsx hands over: the SignIn adapter's deps plus the two the session needs. */
export interface DailyDashHostDeps extends DailyDashSignInDeps {
  /** `rootStore.networkStore`, taken structurally (see dailyDashConnectivity.ts). */
  networkStore: { readonly isOffline: boolean }
  /** The build's `EXPO_PUBLIC_DAILY_DASH_API_URL`; an invalid or missing one means no session. */
  apiBaseUrl: string | undefined
}

let hostDeps: DailyDashHostDeps | null = null
let session: Session | null = null
let sessionLogger: Logger | null = null
let connectivity: ClientConnectivity | null = null
let clientIdentity: ClientIdentity | null = null
let driver: DailyDashDriver | null = null

/**
 * Called once from app.tsx. A later call (Fast Refresh re-running app.tsx in
 * dev) replaces the deps: the SignIn adapter is built per `loadSignIn` call,
 * so it picks the new ones up, while an already-built session and
 * connectivity keep what they were built with (the root store is a
 * singleton, so the network store they hold is the same one).
 */
export function configureDailyDash(deps: DailyDashHostDeps): void {
  hostDeps = deps
}

/**
 * The session's and ClientProvider's `loadSignIn`. Only "recoverysky" is in
 * `products`, so the client asks for nothing else; the product is not
 * branched on. Before `configureDailyDash` this is a Result, never a throw
 * (the client's contract: no adapter method throws).
 */
export const dailyDashLoadSignIn = async (_product: ClientProduct): Promise<AppResult<SignIn>> => {
  if (!hostDeps) return err(internal("Daily Dash is not configured"))
  return ok(createDailyDashSignIn(hostDeps))
}

/** The client's logger over the app's (see dailyDashLogger.ts), built once. */
export function getDailyDashLogger(): Logger {
  if (!sessionLogger) sessionLogger = createDailyDashLogger()
  return sessionLogger
}

/**
 * Inert stand-in for before `configureDailyDash`: it is never memoised, so the
 * real one is built from the network store as soon as the deps arrive. A
 * reference captured before configure stays inert for good (its
 * `onReconnect` never fires), so app.tsx must configure before anything,
 * such as ClientProvider, reads connectivity.
 */
const UNCONFIGURED_CONNECTIVITY: ClientConnectivity = {
  reach: () => {},
  onReconnect: () => () => {},
}

/** The client's connectivity port over NetworkStore, built once the deps exist. */
export function getDailyDashConnectivity(): ClientConnectivity {
  if (connectivity) return connectivity
  if (!hostDeps) return UNCONFIGURED_CONNECTIVITY
  connectivity = createDailyDashConnectivity(hostDeps.networkStore)
  return connectivity
}

/**
 * Who is calling, for the client's `X-Client` header. The native version (not
 * package.json) because the API's 426 gate is about the installed binary; the
 * EAS Update channel, with a dev/prod fallback for builds without one.
 */
export function getDailyDashClientIdentity(): ClientIdentity {
  if (!clientIdentity) {
    clientIdentity = {
      app: "recoverysky",
      version: Application.nativeApplicationVersion ?? "0.0.0",
      channel: Updates.channel ?? (__DEV__ ? "development" : "production"),
    }
  }
  return clientIdentity
}

/**
 * Transport refusals from the client. A 410 goes to the session
 * (`sessionRefusal` marks the account deleted or purged); a 426
 * `update_required` shows the app's own store prompt, sharing its lock with
 * the cold-start check (checkForUpdates.ts). Reads the built session only —
 * a refusal must never be what builds one.
 */
export const dailyDashOnRefused = (problem: AppError): void => {
  if (session) sessionRefusal(session, problem)
  const refusal = refusalOf(problem)
  if (refusal) log.info("Daily Dash refused a request", { refusal })
  if (refusal === "update_required") promptStoreUpdate()
}

/**
 * The one session, built on first call; `null` before `configureDailyDash` or
 * when the build's API URL is missing or invalid (the tab is hidden then, see
 * `decideMyDayTabVisible`). A null result is not memoised, so configuring
 * later still builds.
 */
export function getDailyDashSession(): Session | null {
  if (session) return session
  const apiBaseUrl = hostDeps?.apiBaseUrl
  if (!hostDeps || !apiBaseUrl || !isValidDailyDashUrl(apiBaseUrl)) return null
  session = createClientSession({
    apiBaseUrl,
    client: getDailyDashClientIdentity(),
    products: ["recoverysky"],
    loadSignIn: dailyDashLoadSignIn,
    logger: getDailyDashLogger(),
    onRefused: dailyDashOnRefused,
    track: trackEvent,
    onReach: getDailyDashConnectivity().reach,
  })
  return session
}

/** The built session or `null`; never builds (for teardown paths such as logout). */
export function peekDailyDashSession(): Session | null {
  return session
}

/**
 * The session's one sign-in driver (dailyDashDriver.ts), built with the session
 * on first call; `null` whenever `getDailyDashSession()` is. ADDED 2026-11-04
 * (My Day tab). One per session because each driver subscribes to the session
 * and would start its own sign-in on the same signedOut edge.
 *
 * Built only after the session, so `getDailyDashConnectivity()` is the real
 * port by then (configure has run) and its `onReconnect` actually fires.
 */
export function getDailyDashDriver(): DailyDashDriver | null {
  if (driver) return driver
  const built = getDailyDashSession()
  if (!built) return null
  driver = createDailyDashDriver({
    session: built,
    connectivity: getDailyDashConnectivity(),
    appState: AppState,
    log: getDailyDashLogger().child({ module: "driver" }),
  })
  return driver
}

/**
 * The built driver or `null`; never builds a driver or a session. For
 * DailyDashProvider's gate-closed path: closing the gate must not be what
 * creates a session for a free account.
 */
export function peekDailyDashDriver(): DailyDashDriver | null {
  return driver
}
