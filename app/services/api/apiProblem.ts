import { ApiResponse } from "apisauce"

import { trackEvent } from "@/services/tracking"

export type GeneralApiProblem =
  /**
   * Times up.
   */
  | { kind: "timeout"; temporary: true }
  /**
   * Cannot connect to the server for some reason.
   */
  | { kind: "cannot-connect"; temporary: true }
  /**
   * The server experienced a problem. Any 5xx error.
   */
  | { kind: "server" }
  /**
   * We're not allowed because we haven't identified ourself. This is 401.
   */
  | { kind: "unauthorized" }
  /**
   * We don't have access to perform that request. This is 403.
   */
  | { kind: "forbidden" }
  /**
   * Unable to find that resource.  This is a 404.
   */
  | { kind: "not-found" }
  /**
   * All other 4xx series errors.
   */
  | { kind: "rejected" }
  /**
   * Something truly unexpected happened. Most likely can try again. This is a catch all.
   */
  | { kind: "unknown"; temporary: true }
  /**
   * The data we received is not in the expected format.
   */
  | { kind: "bad-data" }

/**
 * Attempts to get a common cause of problems from an api response.
 *
 * @param response The api response.
 */
export function getGeneralApiProblem(response: ApiResponse<any>): GeneralApiProblem | null {
  let problem: GeneralApiProblem | null = null

  switch (response.problem) {
    case "CONNECTION_ERROR":
      problem = { kind: "cannot-connect", temporary: true }
      break
    case "NETWORK_ERROR":
      problem = { kind: "cannot-connect", temporary: true }
      break
    case "TIMEOUT_ERROR":
      problem = { kind: "timeout", temporary: true }
      break
    case "SERVER_ERROR":
      problem = { kind: "server" }
      break
    case "UNKNOWN_ERROR":
      problem = { kind: "unknown", temporary: true }
      break
    case "CLIENT_ERROR":
      switch (response.status) {
        case 401:
          problem = { kind: "unauthorized" }
          break
        case 403:
          problem = { kind: "forbidden" }
          break
        case 404:
          problem = { kind: "not-found" }
          break
        default:
          problem = { kind: "rejected" }
          break
      }
      break
    case "CANCEL_ERROR":
      return null
  }

  if (problem) {
    trackEvent("api_error", {
      kind: problem.kind,
      endpoint: response.config?.url || "",
    })
  }

  return problem
}
