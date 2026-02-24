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
import { useAuthenticationStore } from "@/models"
import { api, type SendReportResponse, type GeneralApiProblem } from "@/services/api"
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
// Constants
// ============================================================================

/** Poll intervals for delivery confirmation: 15s first, then 60s repeating */
const POLL_INTERVALS = [15000, 60000, 60000, 60000, 60000]

/** Extended update input (retry exists in source but missing from stale compiled .d.ts) */
type UpdateInput = AttendanceReportUpdateInput & { retry?: number }

/** Toast labels per operation type */
const TOAST_LABELS: Record<SendOperation["type"], string> = {
  initial: "Report sent",
  resend: "Report resent",
  replace: "Report sent",
  forward: "Report forwarded",
}

// ============================================================================
// Polling
// ============================================================================

/**
 * Fire-and-forget polling for report delivery confirmation.
 * Polls POST /reports/status at increasing intervals until confirmed !== 0.
 * Updates SQLite and emits delivery_resolved event when status resolves.
 */
function pollForConfirmation(reportId: string) {
  let attempt = 0
  logger.info("Poll started", { reportId, intervals: POLL_INTERVALS.length })

  const poll = async () => {
    logger.debug("Poll attempt", {
      reportId,
      attempt: attempt + 1,
      delayMs: POLL_INTERVALS[attempt],
    })
    try {
      const result = await api.getReportStatus({ id: reportId })
      if (result.kind === "ok") {
        const { confirmed, error, confirmation, html, retry } = result.data
        logger.debug("Poll response", {
          reportId,
          confirmed,
          error,
          retry,
          hasConfirmation: !!confirmation,
          hasHtml: !!html,
        })
        if (confirmed !== 0 || error) {
          logger.info("Poll resolved", {
            reportId,
            confirmed,
            error,
            retry,
            confirmation: confirmation || "none",
          })
          await attendanceReportRepo.update(reportId, {
            confirmed,
            error,
            confirmation,
            html,
            retry,
          } as UpdateInput)
          logger.debug("Poll: DB updated", { reportId })
          attendanceEvents.emit({ type: "produced", id: reportId, reportId })
          attendanceEvents.emit({
            type: "delivery_resolved",
            id: reportId,
            reportId,
            deliveryError: !!error,
          })
          return
        }
        logger.debug("Poll: not yet resolved, scheduling next", { reportId })
      } else {
        logger.warn("Poll: API returned non-ok", { reportId, kind: result.kind })
      }
    } catch (err) {
      logger.error("Poll: exception", { reportId, attempt: attempt + 1, error: String(err) })
    }

    if (attempt < POLL_INTERVALS.length - 1) {
      attempt++
    }
    logger.debug("Poll: next attempt scheduled", {
      reportId,
      attempt: attempt + 1,
      delayMs: POLL_INTERVALS[attempt],
    })
    setTimeout(poll, POLL_INTERVALS[attempt])
  }

  setTimeout(poll, POLL_INTERVALS[0])
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
): Promise<boolean> {
  if (apiResult.kind === "ok") {
    const { data } = apiResult
    await attendanceReportRepo.update(reportId, {
      html: data.html,
      confirmed: data.confirmed,
      confirmation: data.confirmation,
      error: data.error,
      retry: data.retry,
    } as UpdateInput)
    attendanceEvents.emit({ type: "produced", id: reportId, reportId })

    if (data.error) {
      showToast({ message: "Failed to send report", type: "error" })
      return false
    }

    showToast({ message: TOAST_LABELS[operationType], type: "success" })

    if (data.confirmed === 0) {
      pollForConfirmation(reportId)
    }
    return true
  }

  logger.warn("Report API failed", { reportId, kind: apiResult.kind })
  await attendanceReportRepo.update(reportId, { error: true })
  attendanceEvents.emit({ type: "produced", id: reportId, reportId })
  showToast({ message: "Failed to send report", type: "error" })
  return false
}

// ============================================================================
// Operation handlers
// ============================================================================

async function handleInitialSend(
  uid: string,
  op: Extract<SendOperation, { type: "initial" }>,
  showToast: (config: { message: string; type: "success" | "error"; duration?: number }) => void,
): Promise<SendResult> {
  const reportId = Crypto.randomUUID()
  logger.info("Initial send started", { reportId, email: op.email, count: op.attendanceIds.length })

  const createResult = await attendanceReportRepo.create({
    id: reportId,
    uid,
    email: op.email,
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
  logger.debug("Report record created in DB", { reportId })

  logger.debug("Marking attendance records as produced", {
    reportId,
    count: op.attendanceIds.length,
  })
  for (const id of op.attendanceIds) {
    await attendanceRepo.markProduced(id, reportId)
  }

  attendanceEvents.emit({ type: "produced", id: reportId, reportId })
  for (const id of op.attendanceIds) {
    attendanceEvents.emit({ type: "archived", id })
  }

  const attendanceResult = await attendanceRepo.findByReportId(reportId)
  if (!attendanceResult.ok) {
    logger.warn("Failed to fetch attendance records for API", {
      reportId,
      error: String(attendanceResult.error),
    })
    showToast({ message: "Report saved locally", type: "success" })
    return { reportId, success: true }
  }

  logger.debug("Sending report to API", {
    reportId,
    email: op.email,
    attendanceCount: attendanceResult.value.length,
  })
  const apiResult = await api.sendReport({
    id: reportId,
    uid,
    email: op.email,
    attendance: attendanceResult.value,
  })
  const success = await processApiResult(reportId, apiResult, "initial", showToast)
  logger.info("Initial send complete", { reportId, success })
  return { reportId, success }
}

async function handleResend(
  uid: string,
  op: Extract<SendOperation, { type: "resend" }>,
  showToast: (config: { message: string; type: "success" | "error"; duration?: number }) => void,
): Promise<SendResult> {
  const reportId = op.report.id
  logger.info("Resend: same email path", { reportId, email: op.report.email })

  await attendanceReportRepo.update(reportId, {
    error: false,
    retry: 0,
    confirmed: 0,
    confirmation: "",
  } as UpdateInput)
  attendanceEvents.emit({ type: "produced", id: reportId, reportId })

  const apiResult = await api.resendReport({ id: reportId, uid })
  const success = await processApiResult(reportId, apiResult, "resend", showToast)
  return { reportId, success }
}

async function handleReplace(
  uid: string,
  op: Extract<SendOperation, { type: "replace" }>,
  showToast: (config: { message: string; type: "success" | "error"; duration?: number }) => void,
): Promise<SendResult> {
  const reportId = op.report.id
  logger.info("Resend: error replace path", {
    reportId,
    oldEmail: op.report.email,
    newEmail: op.email,
  })

  await attendanceReportRepo.update(reportId, {
    email: op.email,
    error: false,
    retry: 0,
    confirmed: 0,
    confirmation: "",
  } as UpdateInput)

  const apiResult = await api.sendReport({ id: reportId, uid, email: op.email })
  const success = await processApiResult(reportId, apiResult, "replace", showToast)
  return { reportId, success }
}

async function handleForward(
  uid: string,
  op: Extract<SendOperation, { type: "forward" }>,
  showToast: (config: { message: string; type: "success" | "error"; duration?: number }) => void,
): Promise<SendResult> {
  const originId = op.report.fid || op.report.id
  const newId = Crypto.randomUUID()
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
    fid: originId,
    generated: Date.now(),
  })
  logger.debug("Forward report created in DB", { newReportId: newId, fid: originId })
  attendanceEvents.emit({ type: "produced", id: newId, reportId: newId })

  const apiResult = await api.sendReport({
    id: newId,
    uid,
    email: op.email,
    fid: originId,
  })
  const success = await processApiResult(newId, apiResult, "forward", showToast)
  return { reportId: newId, success }
}

// ============================================================================
// Hook
// ============================================================================

export function useReportSender() {
  const authStore = useAuthenticationStore()
  const toast = useToast()
  const [isSending, setIsSending] = useState(false)

  const send = useCallback(
    async (op: SendOperation): Promise<SendResult | null> => {
      setIsSending(true)
      try {
        const uid = authStore.userId ?? ""
        const { showToast } = toast

        switch (op.type) {
          case "initial":
            return await handleInitialSend(uid, op, showToast)
          case "resend":
            return await handleResend(uid, op, showToast)
          case "replace":
            return await handleReplace(uid, op, showToast)
          case "forward":
            return await handleForward(uid, op, showToast)
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
