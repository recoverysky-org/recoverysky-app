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
 *    post-login Action in `auth0/actions/<tenant>/identities-claim.js`. A missing
 *    claim (tenant without the Action, a token minted before it, or an
 *    unlinked account — the Action omits the claim for a single identity)
 *    is normal: the screen shows just the active row.
 */
import type { LoginMethod } from "@/models"

import { decodeJwtPayload } from "./jwtUtils"
import { ownerProofMethod } from "./ownerLogic"

/** Namespace must match `auth0/actions/<tenant>/identities-claim.js`. */
export const IDENTITIES_CLAIM = "https://recoverysky.app/identities"

/**
 * What the user recognises. `auth0` (password) and `email` (code) are both "Email".
 * CHANGED 2026-09-30: an alias of the store's LoginMethod (type-only `@/`
 * import, erased for vitest) instead of a re-declared union, so a new login
 * method cannot compile here without also getting an icon and label.
 */
export type AccountMethod = LoginMethod

export interface AccountIdentity {
  method: AccountMethod
  /** Undefined when the provider gave none, when it is an Apple relay address, or when we can't tell. */
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
  /**
   * The ID token's `email` — for a linked account, ALWAYS the PRIMARY's email,
   * whichever identity signed in. So it only describes the active identity
   * when the active identity is the primary; see describeAccount.
   */
  authEmail: string
  idToken: string | undefined
  /**
   * ADDED 2026-09-30: the address the user typed for an email-code session
   * (the store's ownerEmail — see ownerEmailAfterLogin). Undefined for
   * Apple/Google sessions. Only ever used to pick among claim entries, never
   * shown on its own.
   */
  codeEmail?: string
}

interface ClaimEntry {
  method: AccountMethod
  email?: string
  /** Set by the Action on the identity whose connection this login used. */
  current: boolean
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
function readClaim(idToken: string | undefined): ClaimEntry[] {
  if (!idToken) return []
  const claim = decodeJwtPayload<Record<string, unknown>>(idToken)?.[IDENTITIES_CLAIM]
  if (!Array.isArray(claim)) return []
  const out: ClaimEntry[] = []
  for (const entry of claim) {
    if (!entry || typeof entry !== "object") continue
    const { provider, email, current } = entry as {
      provider?: unknown
      email?: unknown
      current?: unknown
    }
    const method = providerToMethod(typeof provider === "string" ? provider : undefined)
    if (!method) continue
    out.push({
      method,
      email: typeof email === "string" ? email : undefined,
      current: current === true,
    })
  }
  return out
}

/**
 * Every identity's standalone sub (`provider|user_id`) from the identities
 * claim — the ids those identities had before they were linked in.
 *
 * ADDED 2026-09-30 (spec 2 §7). The ownership gate uses it to recognise a
 * device owner whose identity was linked into another account from a
 * different device. Entries without a `sub` (the Action before this field)
 * are skipped, which leaves the gate at its old answer, `mismatch`.
 */
export function linkedSubsFromIdToken(idToken: string | undefined): string[] {
  if (!idToken) return []
  const claim = decodeJwtPayload<Record<string, unknown>>(idToken)?.[IDENTITIES_CLAIM]
  if (!Array.isArray(claim)) return []
  const out: string[] = []
  for (const entry of claim) {
    const sub = entry && typeof entry === "object" ? (entry as { sub?: unknown }).sub : undefined
    if (typeof sub === "string" && sub.includes("|")) out.push(sub)
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
  // CHANGED 2026-09-30: only a MATCHING email is a duplicate. Two same-method
  // identities that both lack an email used to collapse into one row, hiding
  // a second linked Apple/Google account — the thing this screen exists to show.
  const identities: ClaimEntry[] = []
  for (const id of readClaim(input.idToken)) {
    const dup = identities.find(
      (seen) => seen.method === id.method && sameEmail(seen.email, id.email),
    )
    if (dup) dup.current = dup.current || id.current
    else identities.push(id)
  }

  // Which claim entry is the active identity.
  // CHANGED 2026-09-30: this used to prefer the entry whose email matched
  // authEmail — but authEmail is the PRIMARY's email on every linked
  // session, so with two Googles it always picked the primary, even when the
  // user signed in with the other one. Now: the one entry the Action tagged
  // `current`, else the only entry of the active method, else nobody (ambiguous).
  //
  // CHANGED 2026-09-30: an email-code session first matches on the address the
  // user typed. Every code identity shares Auth0's one `email` connection, so
  // the Action tags ALL of them `current` and the rules below find nobody — a
  // proton code sign-in into an account with a gmail code identity showed an
  // address-less active row with proton listed as merely "linked".
  const sameMethod = identities.filter((id) => id.method === activeMethod)
  const typed =
    activeMethod === "email" ? sameMethod.filter((id) => sameEmail(id.email, input.codeEmail)) : []
  const tagged = sameMethod.filter((id) => id.current)
  const activeEntry =
    typed.length === 1
      ? typed[0]
      : tagged.length === 1
        ? tagged[0]
        : sameMethod.length === 1
          ? sameMethod[0]
          : undefined

  // Email for the active row.
  // CHANGED 2026-09-30: authEmail used to be the blanket fallback, which put
  // the Google primary's address on an Email-code row whenever the claim was
  // missing or stale (Action not deployed, or a link made during this login).
  // It is now trusted only when no claim entry could be matched AND the active
  // method is the primary's (the sub prefix) — the unlinked case, where it is
  // exact. Otherwise the row shows the method without an address: honest
  // beats wrong on a screen whose whole job is "which account am I in?".
  const email = activeEntry
    ? activeEntry.email
    : sameMethod.length === 0 && activeMethod === methodFromSub(input.sub)
      ? input.authEmail
      : undefined

  const active = toIdentity(activeMethod, email)
  const linked = identities
    .filter((id) => id !== activeEntry)
    .map((id) => toIdentity(id.method, id.email))
  return { active, linked }
}
