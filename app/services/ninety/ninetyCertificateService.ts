/**
 * 90-in-90 Certificate Service
 *
 * Generates a styled PDF certificate for completing the 90 meetings
 * in 90 days challenge. Uses expo-print for HTML→PDF conversion
 * and stores the result in the local filesystem.
 */

import { Directory, Paths, File } from "expo-file-system"
import { printToFileAsync } from "expo-print"
import { shareAsync } from "expo-sharing"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "NinetyCertificate" })

export class NinetyCertificateError extends Error {
  constructor(
    message: string,
    public readonly code: "generation" | "storage",
  ) {
    super(message)
    this.name = "NinetyCertificateError"
  }
}

export interface CertificateParams {
  name: string
  startDate: string
  completionDate: string
  meetingsAttended: number
  totalCreditMs: number
  strictMode: boolean
}

/**
 * Format milliseconds as "X hours, Y minutes"
 */
function formatDurationLong(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} minutes`
  if (minutes === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`
  return `${hours} hour${hours !== 1 ? "s" : ""}, ${minutes} minute${minutes !== 1 ? "s" : ""}`
}

/**
 * Format an ISO date string as a readable date
 */
function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
}

/**
 * Build styled HTML for the completion certificate
 */
function buildNinetyCertificateHtml(params: CertificateParams): string {
  const { name, startDate, completionDate, meetingsAttended, totalCreditMs, strictMode } = params

  const totalTime = formatDurationLong(totalCreditMs)
  const startFormatted = formatDate(startDate)
  const completionFormatted = formatDate(completionDate)
  const modeText = strictMode
    ? "Strict Mode — at least one 60-minute meeting every day"
    : "Standard Mode — 90 meetings within 90 days"

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: letter landscape; margin: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #FAFAF8;
    }
    .certificate {
      width: 90%;
      max-width: 800px;
      border: 3px double #2C5F7C;
      border-radius: 12px;
      padding: 48px 64px;
      text-align: center;
      background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .ornament {
      font-size: 28px;
      color: #2C5F7C;
      letter-spacing: 8px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 4px;
      color: #666;
      margin: 0 0 4px;
      font-weight: 400;
    }
    h2 {
      font-size: 36px;
      color: #2C5F7C;
      margin: 0 0 24px;
      font-weight: 700;
    }
    .presented {
      font-size: 14px;
      color: #888;
      margin-bottom: 4px;
    }
    .name {
      font-size: 28px;
      font-style: italic;
      color: #333;
      margin-bottom: 24px;
      border-bottom: 1px solid #ccc;
      padding-bottom: 8px;
      display: inline-block;
      min-width: 300px;
    }
    .description {
      font-size: 15px;
      color: #555;
      line-height: 1.8;
      margin-bottom: 24px;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }
    .stats {
      display: flex;
      justify-content: center;
      gap: 40px;
      margin-bottom: 24px;
    }
    .stat {
      text-align: center;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #2C5F7C;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #999;
      margin-top: 2px;
    }
    .mode {
      font-size: 12px;
      color: #999;
      font-style: italic;
      margin-bottom: 16px;
    }
    .dates {
      font-size: 12px;
      color: #aaa;
    }
    .footer {
      margin-top: 24px;
      font-size: 11px;
      color: #bbb;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="ornament">&#10022; &#10022; &#10022;</div>
    <h1>Certificate of Achievement</h1>
    <h2>90 in 90</h2>
    <p class="presented">This certifies that</p>
    <p class="name">${escapeHtml(name)}</p>
    <p class="description">
      has successfully completed the <strong>90 in 90 Challenge</strong>,
      attending ${meetingsAttended} recovery meetings
      totaling ${escapeHtml(totalTime)} of participation.
    </p>
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${meetingsAttended}</div>
        <div class="stat-label">Meetings</div>
      </div>
      <div class="stat">
        <div class="stat-value">${escapeHtml(totalTime)}</div>
        <div class="stat-label">Total Time</div>
      </div>
    </div>
    <p class="mode">${escapeHtml(modeText)}</p>
    <p class="dates">${escapeHtml(startFormatted)} — ${escapeHtml(completionFormatted)}</p>
    <p class="footer">RECOVERYSKY</p>
  </div>
</body>
</html>`
}

/** Escape HTML entities */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Generate a PDF certificate and store it permanently.
 * Returns the local file path to the stored PDF.
 */
export async function generateAndStoreCertificate(params: CertificateParams): Promise<string> {
  log.info("Generating 90/90 certificate", {
    name: params.name,
    startDate: params.startDate,
    meetings: params.meetingsAttended,
  })

  const html = buildNinetyCertificateHtml(params)

  let uri: string
  try {
    const result = await printToFileAsync({ html })
    uri = result.uri
    log.info("PDF generated", { uri })
  } catch (error) {
    log.error("PDF generation failed", { error: String(error) })
    throw new NinetyCertificateError("Failed to generate certificate PDF", "generation")
  }

  // Move to permanent storage
  try {
    const certDir = new Directory(Paths.document, "certificates")
    if (!certDir.exists) certDir.create()

    const fileName = `ninety-certificate-${params.startDate}.pdf`
    const destFile = new File(certDir, fileName)

    // Remove existing if regenerating
    if (destFile.exists) destFile.delete()

    const tempFile = new File(uri)
    tempFile.move(destFile)

    const permanentPath = destFile.uri
    log.info("Certificate stored", { path: permanentPath })
    return permanentPath
  } catch (error) {
    log.error("Certificate storage failed", { error: String(error) })
    throw new NinetyCertificateError("Failed to store certificate", "storage")
  }
}

/**
 * Open the native share sheet for a stored certificate PDF.
 */
export async function shareNinetyCertificate(filePath: string): Promise<void> {
  log.info("Sharing certificate", { path: filePath })
  await shareAsync(filePath, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "90 in 90 Certificate",
  })
}
