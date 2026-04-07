/**
 * useReportSender - Unified hook for all 4 attendance report send operations.
 *
 * Handles: initial send, resend, error-replace, and forward.
 * All operations produce consistent toast-only notifications (no Alert.alert).
 */

import { useCallback, useState } from "react"
import * as Crypto from "expo-crypto"

import { useToast } from "@/components/Toast"
import {
  attendanceRepo,
  attendanceReportRepo,
  attendanceEvents,
  type AttendanceReportRecord,
  type AttendanceReportUpdateInput,
} from "@/db"
import { useAuthenticationStore, useProfileStore } from "@/models"
import { api, type SendReportResponse, type GeneralApiProblem } from "@/services/api"
import { pollForConfirmation } from "@/services/polling"
import { trackEvent } from "@/services/tracking"
import { logger } from "@/utils/logger"

// ============================================================================
// Types
// ============================================================================

export type SendOperation =
  | { type: "initial"; attendanceIds: string[]; email: string }
  | { type: "resend"; report: AttendanceReportRecord }
  | { type: "replace"; report: AttendanceReportRecord; email: string }
  | { type: "forward"; report: AttendanceReportRecord; email: string }

export interface SendResult {
  reportId: string
  success: boolean
}

// ============================================================================
// Helpers
// ============================================================================

/** Generate an 8-char hex report ID formatted as "####-####" */
function generateReportId(): string {
  const bytes = Crypto.getRandomBytes(4)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`
}

// ============================================================================
// Constants
// ============================================================================

/** Extended update input (retry exists in source but missing from stale compiled .d.ts) */
type UpdateInput = AttendanceReportUpdateInput & { retry?: number }

/** Default values for all status fields — reset before every send */
const STATUS_DEFAULTS = {
  confirmed: 0,
  confirmation: "",
  error: false,
  retry: 0,
  html: "",
} as UpdateInput

/** Toast labels per operation type */
const TOAST_LABELS: Record<SendOperation["type"], string> = {
  initial: "Report sent",
  resend: "Report resent",
  replace: "Report sent",
  forward: "Report forwarded",
}

// ============================================================================
// Shared API result processor
// ============================================================================

type ApiResult = { kind: "ok"; data: SendReportResponse } | GeneralApiProblem

async function processApiResult(
  reportId: string,
  apiResult: ApiResult,
  operationType: SendOperation["type"],
  showToast: (config: { message: string; type: "success" | "error"; duration?: number }) => void,
  preserveReset = false,
): Promise<boolean> {
  if (apiResult.kind === "ok") {
    const { data } = apiResult

    if (data.error) {
      // Errors are always authoritative — write to DB
      await attendanceReportRepo.update(reportId, {
        error: data.error,
        retry: data.retry,
      } as UpdateInput)
      attendanceEvents.emit({ type: "produced", id: reportId, reportId })
      showToast({ message: "Failed to send report", type: "error" })
      return false
    }

    if (preserveReset) {
      // Resend/replace: API may return stale confirmed state from previous
      // delivery. Keep our reset values in SQLite and always poll for fresh
      // confirmation. Only trust error (handled above).
      logger.debug("processApiResult: preserving reset, skipping DB write", {
        reportId,
        apiConfirmed: data.confirmed,
      })
    } else {
      // Initial/forward: API response is authoritative for a new report
      await attendanceReportRepo.update(reportId, {
        html: data.html,
        confirmed: data.confirmed,
        confirmation: data.confirmation,
        error: data.error,
        retry: data.retry,
      } as UpdateInput)
      attendanceEvents.emit({ type: "produced", id: reportId, reportId })

      // If already confirmed, no need to poll
      if (data.confirmed !== 0) {
        trackEvent("report_confirmed")
        showToast({ message: TOAST_LABELS[operationType], type: "success" })
        return true
      }
    }

    showToast({ message: TOAST_LABELS[operationType], type: "success" })
    pollForConfirmation(reportId)
    return true
  }

  trackEvent("report_delivery_failed")
  logger.warn("Report API failed", { reportId, kind: apiResult.kind })
  await attendanceReportRepo.update(reportId, { error: true })
  attendanceEvents.emit({ type: "produced", id: reportId, reportId })
  showToast({ message: "Failed to send report", type: "error" })
  return false
}

// ============================================================================
// Operation handlers
// ============================================================================

type ShowToast = (config: { message: string; type: "success" | "error"; duration?: number }) => void

/**
 * Roll back a failed initial send: un-produce attendance records and delete the report.
 */
async function rollbackInitialSend(reportId: string, attendanceIds: string[]): Promise<void> {
  try {
    for (const id of attendanceIds) {
      await attendanceRepo.update(id, { produced: 0, arid: "", archived: 0 })
    }
    await attendanceReportRepo.delete(reportId)
    logger.info("Rolled back failed report", { reportId, count: attendanceIds.length })
    for (const id of attendanceIds) {
      attendanceEvents.emit({ type: "processed", id })
      attendanceEvents.emit({ type: "archived", id })
    }
  } catch (e) {
    logger.error("Rollback failed", { reportId, error: String(e) })
  }
}

/**
 * Unified handler for initial send, resend, and error-replace.
 * All three follow the same pattern: ensure record exists → reset status → call API.
 */
async function handleSend(
  uid: string,
  name: string,
  userEmail: string,
  userIdNum: string,
  timezone: string,
  op: Extract<SendOperation, { type: "initial" | "resend" | "replace" }>,
  showToast: ShowToast,
): Promise<SendResult> {
  let reportId: string
  const email = op.type === "resend" ? op.report.email : op.email

  // 1. Ensure report record exists (initial creates, others already exist)
  if (op.type === "initial") {
    reportId = generateReportId()
    logger.info("Initial send started", { reportId, email, count: op.attendanceIds.length })

    const createResult = await attendanceReportRepo.create({
      id: reportId,
      uid,
      email,
      name,
      userEmail,
      userIdNum: userIdNum || undefined,
      timezone,
      generated: Date.now(),
    })
    if (!createResult.ok) {
      logger.error("Failed to create attendance report in DB", {
        reportId,
        error: String(createResult.error),
      })
      showToast({ message: "Failed to create report", type: "error" })
      return { reportId, success: false }
    }

    for (const id of op.attendanceIds) {
      await attendanceRepo.markProduced(id, reportId)
    }
    for (const id of op.attendanceIds) {
      attendanceEvents.emit({ type: "archived", id })
    }
  } else {
    reportId = op.report.id
    logger.info(`${op.type === "resend" ? "Resend" : "Replace"} started`, { reportId, email })
  }

  // 2. Reset ALL status fields to defaults + set email
  await attendanceReportRepo.update(reportId, { email, ...STATUS_DEFAULTS })
  attendanceEvents.emit({ type: "produced", id: reportId, reportId })

  // 3. Call API (initial sends attendance payload, resend is minimal, replace sends new email)
  let apiResult: ApiResult
  if (op.type === "initial") {
    const attendanceResult = await attendanceRepo.findByReportId(reportId)
    if (!attendanceResult.ok) {
      logger.warn("Failed to fetch attendance for API, rolling back report", {
        reportId,
        error: String(attendanceResult.error),
      })
      await rollbackInitialSend(reportId, op.attendanceIds)
      showToast({ message: "Failed to create report", type: "error" })
      return { reportId, success: false }
    }
    apiResult = await api.sendReport({
      id: reportId,
      uid,
      email,
      name,
      userEmail,
      userIdNum: userIdNum || undefined,
      timezone,
      attendance: attendanceResult.value,
    })
  } else if (op.type === "resend") {
    apiResult = await api.resendReport({ id: reportId, uid })
  } else {
    apiResult = await api.sendReport({
      id: reportId,
      uid,
      email,
      name,
      userEmail,
      userIdNum: userIdNum || undefined,
      timezone,
    })
  }

  // 4. Process result (update DB, toast, poll if needed)
  // Resend/replace: API may return stale confirmed state — preserve our reset
  const preserveReset = op.type === "resend" || op.type === "replace"
  const success = await processApiResult(reportId, apiResult, op.type, showToast, preserveReset)

  // Roll back initial send on API failure — restore attendance to New tab
  if (!success && op.type === "initial") {
    await rollbackInitialSend(reportId, op.attendanceIds)
  }

  if (success) trackEvent("report_sent", { type: op.type })
  logger.info("Send complete", { reportId, type: op.type, success })
  return { reportId, success }
}

async function handleForward(
  uid: string,
  name: string,
  userEmail: string,
  userIdNum: string,
  timezone: string,
  op: Extract<SendOperation, { type: "forward" }>,
  showToast: ShowToast,
): Promise<SendResult> {
  const originId = op.report.fid || op.report.id
  const newId = generateReportId()
  logger.info("Resend: forward path", {
    sourceReportId: op.report.id,
    sourceFid: op.report.fid || "none",
    originId,
    newReportId: newId,
    email: op.email,
  })

  await attendanceReportRepo.create({
    id: newId,
    uid,
    email: op.email,
    name,
    userEmail,
    userIdNum: userIdNum || undefined,
    timezone,
    fid: originId,
    generated: Date.now(),
  })
  logger.debug("Forward report created in DB", { newReportId: newId, fid: originId })
  attendanceEvents.emit({ type: "produced", id: newId, reportId: newId })

  const apiResult = await api.sendReport({
    id: newId,
    uid,
    email: op.email,
    name,
    userEmail,
    userIdNum: userIdNum || undefined,
    timezone,
    fid: originId,
  })
  const success = await processApiResult(newId, apiResult, "forward", showToast)
  if (success) trackEvent("report_sent", { type: "forward" })
  return { reportId: newId, success }
}

// ============================================================================
// Hook
// ============================================================================

export function useReportSender() {
  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const toast = useToast()
  const [isSending, setIsSending] = useState(false)

  const send = useCallback(
    async (op: SendOperation): Promise<SendResult | null> => {
      setIsSending(true)
      try {
        const uid = authStore.userId ?? ""
        const name = profileStore.shortName
        const userEmail = authStore.authEmail ?? ""
        const userIdNum = profileStore.userIdNum
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const { showToast } = toast

        switch (op.type) {
          case "initial":
          case "resend":
          case "replace":
            return await handleSend(uid, name, userEmail, userIdNum, timezone, op, showToast)
          case "forward":
            return await handleForward(uid, name, userEmail, userIdNum, timezone, op, showToast)
        }
      } catch (error) {
        logger.error("Report send exception", { type: op.type, error: String(error) })
        toast.showToast({ message: "Failed to send report", type: "error" })
        return null
      } finally {
        setIsSending(false)
      }
    },
    [authStore.userId, toast],
  )

  return { send, isSending }
}
