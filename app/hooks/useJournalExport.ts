import { useCallback, useState } from "react"

import { useToast } from "@/components/Toast"
import { exportJournalPdf, JournalExportError } from "@/services/journal"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useJournalExport" })

export function useJournalExport() {
  const [isExporting, setIsExporting] = useState(false)
  const toast = useToast()

  const exportPdf = useCallback(async () => {
    setIsExporting(true)
    try {
      await exportJournalPdf()
    } catch (error) {
      if (error instanceof JournalExportError) {
        switch (error.code) {
          case "empty":
            toast.showToast({ message: "No journal entries found", type: "info" })
            break
          case "not_found":
            toast.showToast({ message: "Journal database not found", type: "error" })
            break
          default:
            toast.showToast({ message: "Failed to export journal", type: "error" })
        }
      } else {
        log.error("Journal export failed", { error: String(error) })
        toast.showToast({ message: "Failed to export journal", type: "error" })
      }
    } finally {
      setIsExporting(false)
    }
  }, [toast])

  return { exportPdf, isExporting }
}
