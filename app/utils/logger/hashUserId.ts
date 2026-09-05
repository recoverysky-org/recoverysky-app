/**
 * Pseudonymise a user id before it is attached to telemetry.
 *
 * Why hash at all: an Auth0 `sub` (`google-oauth2|1098…`, `apple|000123.…`)
 * embeds the identity provider AND the provider's own account id, both of
 * which are cross-referenceable with a third party. A device UUID is not.
 * Shipping the raw `sub` on every Loki line would put a Google/Apple account
 * id next to meeting names and attendance events in a recovery app — that is
 * health-adjacent personal data, and Loki retention is measured in weeks.
 *
 * What this is NOT: anonymisation. Anyone holding the raw `sub` can recompute
 * the hash — that is the point (support workflow: hash the user's id, grep
 * Loki). Treat the output as a pseudonymous identifier, still personal data
 * under GDPR, just one that can't be reversed or linked to a provider from
 * the log alone.
 *
 * Why tweetnacl's SHA-512 and not expo-crypto: this module must stay
 * importable by vitest (no native modules, no `@/` runtime imports — see
 * "Test Runner Split" in CLAUDE.md). tweetnacl is pure JS and already a
 * dependency (`app/services/auth/vault.ts`). No native change, no
 * runtimeVersion bump.
 *
 * Output is the first 8 bytes (16 hex chars) of the digest. 64 bits is far
 * more than enough to keep our user base collision-free, and the short fixed
 * width keeps it visibly distinct from a raw `sub` or a device UUID in a
 * Loki row.
 */
import nacl from "tweetnacl"

const HASH_HEX_CHARS = 16

export function hashUserId(id: string | undefined): string | undefined {
  if (!id) return undefined
  const digest = nacl.hash(new TextEncoder().encode(id))
  let hex = ""
  for (let i = 0; i < HASH_HEX_CHARS / 2; i++) {
    hex += digest[i].toString(16).padStart(2, "0")
  }
  return hex
}
