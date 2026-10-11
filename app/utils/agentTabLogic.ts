/**
 * Pure decision for whether the Sky Agent tab is shown. Kept free of runtime
 * `@/` and React Native imports so vitest can import it (see CLAUDE.md "Test
 * Runner Split"); MainNavigator supplies the inputs.
 */

/**
 * An absolute http(s) base URL: scheme, host (DNS labels, so `localhost` and
 * dotted IPv4 pass), optional port, optional path. No query or fragment,
 * because AgentScreen appends `/api/v1/chat` to it and a `?` or `#` would
 * swallow that suffix.
 *
 * A regex rather than `new URL()`: React Native's built-in URL has no
 * `protocol`/`hostname` getters (they throw "not implemented") and this app
 * ships no URL polyfill, so a `URL`-based check would pass under vitest/Node
 * and throw on device.
 */
const AGENT_URL_PATTERN =
  /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?(?:\/[^\s?#]*)?$/

export function isValidAgentUrl(raw: string | undefined | null): boolean {
  if (typeof raw !== "string") return false
  return AGENT_URL_PATTERN.test(raw.trim())
}

export interface AgentTabInputs {
  /** The build's `EXPO_PUBLIC_AGENT_URL`, as inlined at bundle time. */
  agentUrlEnv: string | undefined
  isDev: boolean
  isPremium: boolean
}

/**
 * The tab needs a build that was given an agent URL AND the existing
 * entitlement gate (`__DEV__ || isPremium`). The URL is a hard requirement in
 * dev too: a dev build with no agent configured has nothing to talk to.
 *
 * Deliberately keyed on the env var, not `configStore.agentUrl`: the store
 * falls back to a hardcoded production URL when the env var is missing, so it
 * is never empty and could not serve as an on/off switch. Removing the var from
 * a build's environment is what turns the tab off.
 */
export function decideAgentTabVisible({ agentUrlEnv, isDev, isPremium }: AgentTabInputs): boolean {
  return isValidAgentUrl(agentUrlEnv) && (isDev || isPremium)
}
