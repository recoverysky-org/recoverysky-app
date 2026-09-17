/**
 * After the owner signs back in on WrongAccountScreen, hand the foreign
 * session's ID token to the API so the two identities are linked and the same
 * mistake next time resolves to the owner (spec 2 §2.5, §3.5).
 *
 * Fire-and-forget from the caller's point of view. Retries ride the content
 * retry ladder (500 / 1500 / 4000 ms) on TRANSPORT failures only — a 4xx is an
 * answer (bad token, already linked) and ends it. Nothing is persisted: on
 * final failure the next mismatch produces a fresh token and a fresh attempt.
 */
import { api } from "@/services/api"
import { fetchWithContentRetry } from "@/services/api/contentRetryLogic"
import { delay } from "@/utils/delay"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "linkForeignIdentity" })

export async function linkForeignIdentity(idToken: string): Promise<boolean> {
  const result = await fetchWithContentRetry(
    () => api.linkIdentity(idToken),
    delay,
    (notice) =>
      log.warn("Link identity retry", { problem: notice.problem, attempt: notice.attempt }),
  )
  if (result.kind === "ok") {
    log.info("Foreign identity linked", {
      linked: result.data.linked,
      reason: result.data.reason,
      moved: JSON.stringify(result.data.moved),
    })
    return true
  }
  log.error("Foreign identity link failed", { problem: result.kind })
  return false
}
