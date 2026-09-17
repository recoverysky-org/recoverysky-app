/**
 * The options used to configure apisauce.
 */
export interface ApiConfig {
  /**
   * The URL of the api.
   */
  url: string

  /**
   * Milliseconds before we timeout the request.
   */
  timeout: number
}

/**
 * POST /auth0/link response (spec 2 §3.4). `moved` is per-table counts of
 * rows reassigned from the foreign identity to the caller; all zero in the
 * accidental-login case.
 */
export interface LinkIdentityResponse {
  linked: boolean
  reason?: "same_user" | "already_linked"
  moved: Record<string, number>
}
