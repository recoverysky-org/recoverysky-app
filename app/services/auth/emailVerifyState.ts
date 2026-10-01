/**
 * Where the verify-email gate keeps its per-account record (spec §4): how many
 * times it has been shown, on which local day, and whether this install has
 * seen a successful verification. MMKV, so it survives restarts and is wiped
 * by Delete User Data / the DEV purge with everything else.
 *
 * The key is the HASHED sub: MMKV is not encrypted, and a raw Auth0 sub embeds
 * the identity provider's account id.
 */
import { hashUserId } from "@/utils/logger"
import { load, save } from "@/utils/storage"

import { EMPTY_VERIFY_STATE, type VerifyState } from "./emailVerifyLogic"

const keyFor = (sub: string) => `emailVerify.${hashUserId(sub)}`

export function loadVerifyState(sub: string): VerifyState {
  const stored = load<Partial<VerifyState>>(keyFor(sub))
  // Field by field: a record written by an older build may lack a field.
  return {
    count: typeof stored?.count === "number" ? stored.count : EMPTY_VERIFY_STATE.count,
    lastDay: typeof stored?.lastDay === "string" ? stored.lastDay : EMPTY_VERIFY_STATE.lastDay,
    verified: stored?.verified === true,
  }
}

export function saveVerifyState(sub: string, state: VerifyState): void {
  save(keyFor(sub), state)
}
