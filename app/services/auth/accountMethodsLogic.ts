/**
 * What Settings → Account shows: the sign-in method in use now, plus any
 * other identities linked into the same Auth0 account.
 *
 * ADDED 2026-09-29. Pure and vitest-covered — no runtime `@/` imports (see
 * CLAUDE.md "Test Runner Split").
 *
 * Two facts drive the shape of this module:
 *
 * 1. The `sub` prefix is NOT the active method once an account has links.
 *    Auth0 returns the PRIMARY's sub for every linked identity (spec 2 §1),
 *    so an email-code sign-in into a Google-primary account still carries
 *    `google-oauth2|…`. The active method comes from `authStore.loginMethod`,
 *    recorded when the session was accepted; the prefix is only the fallback
 *    for sessions from before that field existed, and those are unlinked.
 *
 * 2. Linked identities are invisible to the app except through the
 *    `https://recoverysky.app/identities` ID-token claim, added by the
 *    post-login Action in `auth0/actions/identities-claim.js`. A missing
 *    claim (tenant without the Action, or a token minted before it) is
 *    normal: the screen shows just the active row.
 */
import { decodeJwtPayload } from "./jwtUtils"
import { ownerProofMethod } from "./ownerLogic"

/** Namespace must match `auth0/actions/identities-claim.js`. */
export const IDENTITIES_CLAIM = "https://recoverysky.app/identities"

/**
 * What the user recognises. `auth0` (password) and `email` (code) are both "Email".
 * Same union as the store's LoginMethod, declared here so services/auth does not
 * depend on models/ (the store already depends on this layer's neighbours).
 */
export type AccountMethod = "email" | "apple" | "google"

export interface AccountIdentity {
  method: AccountMethod
  /** Undefined when the provider gave none, or when it is an Apple relay address. */
  email?: string
  /** Apple "Hide My Email": the relay address means nothing to the user, so we say so instead. */
  hiddenByApple: boolean
}

export interface AccountDescription {
  active: AccountIdentity | null
  linked: AccountIdentity[]
}

export interface DescribeAccountInput {
  loginMethod: AccountMethod | undefined
  sub: string | undefined
  /** The ID token's `email` — for a linked account, the PRIMARY's email. */
  authEmail: string
  idToken: string | undefined
}

export function providerToMethod(provider: string | undefined): AccountMethod | null {
  switch (provider) {
    case "google-oauth2":
      return "google"
    case "apple":
      return "apple"
    case "email":
    case "auth0":
      return "email"
    default:
      return null
  }
}

export function isApplePrivateRelay(email: string | undefined): boolean {
  return !!email && email.toLowerCase().endsWith("@privaterelay.appleid.com")
}

function toIdentity(method: AccountMethod, email: string | undefined): AccountIdentity {
  const clean = email?.trim() || undefined
  const hidden = isApplePrivateRelay(clean)
  return { method, email: hidden ? undefined : clean, hiddenByApple: hidden }
}

/** Read the claim defensively — it arrives from a tenant Action, not from our code. */
function readClaim(idToken: string | undefined): { method: AccountMethod; email?: string }[] {
  if (!idToken) return []
  const claim = decodeJwtPayload<Record<string, unknown>>(idToken)?.[IDENTITIES_CLAIM]
  if (!Array.isArray(claim)) return []
  const out: { method: AccountMethod; email?: string }[] = []
  for (const entry of claim) {
    if (!entry || typeof entry !== "object") continue
    const { provider, email } = entry as { provider?: unknown; email?: unknown }
    const method = providerToMethod(typeof provider === "string" ? provider : undefined)
    if (!method) continue
    out.push({ method, email: typeof email === "string" ? email : undefined })
  }
  return out
}

function methodFromSub(sub: string | undefined): AccountMethod | null {
  const proof = ownerProofMethod(sub)
  if (proof === "code") return "email"
  if (proof === "unknown") return null
  return proof
}

const sameEmail = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function describeAccount(input: DescribeAccountInput): AccountDescription {
  const activeMethod = input.loginMethod ?? methodFromSub(input.sub)
  if (!activeMethod) return { active: null, linked: [] }

  // Dedupe by method + email: a migrated password user carries both `auth0|`
  // and `email|` for the same address (spec 1 §3.5), which is one "Email" to them.
  const identities: { method: AccountMethod; email?: string }[] = []
  for (const id of readClaim(input.idToken)) {
    const dup = identities.some(
      (seen) =>
        seen.method === id.method &&
        (sameEmail(seen.email, id.email) || (!seen.email && !id.email)),
    )
    if (!dup) identities.push(id)
  }

  // The active identity: same method, preferring the one whose email is the
  // token's email when the account holds two of a kind.
  const sameMethod = identities.filter((id) => id.method === activeMethod)
  const activeEntry = sameMethod.find((id) => sameEmail(id.email, input.authEmail)) ?? sameMethod[0]

  const active = toIdentity(activeMethod, activeEntry?.email ?? input.authEmail)
  const linked = identities
    .filter((id) => id !== activeEntry)
    .map((id) => toIdentity(id.method, id.email))
  return { active, linked }
}
