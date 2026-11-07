/**
 * Auth0 post-login Action: "Tier claim".
 *
 * @auth0-action Tier claim
 * @auth0-trigger post-login
 * @auth0-runtime node22
 *
 * Adds `https://recoverysky.app/tier` to the access token, copied from
 * `app_metadata.tier`. The agent reads it to pick a chat budget, and the Daily
 * Dash API reads it to decide who has Sky; the namespace string must match
 * their AUTH0_TIER_CLAIM and ASSISTANT_TIER_CLAIM.
 *
 * This Action decides nothing. The API's RevenueCat webhook owns the value
 * (api repo: docs/superpowers/specs/2026-11-06-revenuecat-tier-webhook-design.md),
 * so a login never depends on RevenueCat being up. No secrets and no network
 * here, on purpose.
 *
 * Access token only, never the ID token: its readers are APIs, and the app
 * reads the subscription from RevenueCat directly.
 *
 * No tier means no claim. Both readers treat a missing claim as "no tier", so
 * this is safe to deploy before anything has written `app_metadata.tier`.
 *
 * Runs after "Link passwordless identity" and reads the event as it arrived, so
 * on the one login where that Action links a new `email|` user, this sees that
 * empty user and issues no claim. The next refresh carries the primary's tier.
 */
exports.onExecutePostLogin = async (event, api) => {
  const tier = event.user.app_metadata && event.user.app_metadata.tier
  if (typeof tier === "string" && tier) {
    api.accessToken.setCustomClaim("https://recoverysky.app/tier", tier)
  }
}
