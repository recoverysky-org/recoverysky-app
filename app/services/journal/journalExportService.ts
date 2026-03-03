/**
 * Journal PDF Export Service
 *
 * Reads journal entries from the old app's DataStoreSQLite.db using expo-sqlite,
 * generates a styled HTML document, converts to PDF, and shares.
 */

// TODO: re-enable for import simulation testing
// import { Asset } from "expo-asset"
import { Directory, Paths, File } from "expo-file-system"
import { printToFileAsync } from "expo-print"
import { shareAsync } from "expo-sharing"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "JournalExport" })

const OLD_DB_NAME = "DataStoreSQLite.db"

// TODO: use bundled asset for import simulation testing
// const DB_ASSET = require("@assets/content/DataStoreSQLite.db")

/** A single parsed journal entry from the old app's database */
interface JournalEntry {
  id: string
  date: string
  emoji: string
  title: string
  gratitude: string
  great: string
  affirmations: string
  highlights: string
  better: string
  accomplishments: string
}

export class JournalExportError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "empty" | "generation",
  ) {
    super(message)
    this.name = "JournalExportError"
  }
}

/**
 * Ensure the old app's database is in the SQLite/ directory so expo-sqlite can open it.
 * Checks Documents/SQLite/ first (production), falls back to bundled asset (dev).
 */
async function ensureDatabaseFile(): Promise<void> {
  const dbFile = new File(Paths.document, "SQLite", OLD_DB_NAME)
  if (dbFile.exists) {
    log.info("Journal DB already in SQLite directory")
    return
  }

  // Check Documents/ root (alternate production path)
  const rootFile = new File(Paths.document, OLD_DB_NAME)
  if (rootFile.exists) {
    log.info("Journal DB found in Documents root, copying to SQLite/")
    const sqliteDir = new Directory(Paths.document, "SQLite")
    if (!sqliteDir.exists) sqliteDir.create()
    rootFile.copy(dbFile)
    return
  }

  // No database found on device
  throw new JournalExportError("Journal database not found on device", "not_found")

  // TODO: use bundled asset for import simulation testing
  // const asset = Asset.fromModule(DB_ASSET)
  // await asset.downloadAsync()
  // if (!asset.localUri) {
  //   throw new JournalExportError("Failed to download bundled database asset", "not_found")
  // }
  // const sqliteDir = new Directory(Paths.document, "SQLite")
  // if (!sqliteDir.exists) sqliteDir.create()
  // const assetFile = new File(asset.localUri)
  // assetFile.copy(dbFile)
  // log.info("Copied bundled DB to SQLite directory")
}

/**
 * Load and parse journal entries from the old app's SQLite database.
 * Uses expo-sqlite to open the DB directly — no encryption needed.
 */
export async function loadJournalEntries(): Promise<JournalEntry[]> {
  await ensureDatabaseFile()

  const { openDatabaseSync } = await import("expo-sqlite")
  const db = openDatabaseSync(OLD_DB_NAME)

  try {
    const rows = db.getAllSync<{ value: string }>("SELECT value FROM journal ORDER BY name")

    return rows
      .map((row) => {
        try {
          return JSON.parse(row.value) as JournalEntry
        } catch {
          log.warn("Failed to parse journal entry", { raw: row.value.slice(0, 100) })
          return null
        }
      })
      .filter((entry): entry is JournalEntry => entry !== null)
      .sort((a, b) => Number(b.id) - Number(a.id))
  } finally {
    db.closeSync()
  }
}

/** Build a styled HTML document from journal entries */
function buildJournalHtml(entries: JournalEntry[]): string {
  const FIELD_LABELS: { key: keyof JournalEntry; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "gratitude", label: "Gratitude" },
    { key: "great", label: "What Would Make Today Great" },
    { key: "affirmations", label: "Affirmations" },
    { key: "highlights", label: "Highlights" },
    { key: "better", label: "What Could Be Better" },
    { key: "accomplishments", label: "Accomplishments" },
  ]

  const sections = entries
    .map((entry) => {
      const fields = FIELD_LABELS.filter((f) => entry[f.key] && entry[f.key].trim() !== "")
        .map((f) => `<div class="field"><h3>${f.label}</h3>${entry[f.key]}</div>`)
        .join("\n")

      return `
      <div class="entry">
        <div class="entry-header">
          <span class="emoji">${entry.emoji || ""}</span>
          <span class="date">${entry.date}</span>
        </div>
        ${fields}
      </div>`
    })
    .join("\n<hr/>\n")

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      font-family: -apple-system, Helvetica, Arial, sans-serif;
      padding: 40px;
      color: #333;
      max-width: 700px;
      margin: 0 auto;
    }
    h1 { text-align: center; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 40px; font-size: 14px; }
    .entry { page-break-inside: avoid; margin-bottom: 32px; }
    .entry-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .emoji { font-size: 28px; }
    .date { font-size: 14px; color: #666; font-style: italic; }
    .field h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
      margin: 12px 0 4px;
    }
    .field p { margin: 0; line-height: 1.6; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 24px 0; }
  </style>
</head>
<body>
  <h1>Recovery Journal</h1>
  <p class="subtitle">${entries.length} ${entries.length === 1 ? "entry" : "entries"}</p>
  ${sections}
</body>
</html>`
}

/**
 * Export journal entries as a PDF and open the share sheet.
 */
export async function exportJournalPdf(): Promise<void> {
  log.info("Starting journal PDF export")

  const entries = await loadJournalEntries()
  if (entries.length === 0) {
    throw new JournalExportError("No journal entries found", "empty")
  }
  log.info("Journal entries loaded", { count: entries.length })

  const html = buildJournalHtml(entries)

  const { uri } = await printToFileAsync({ html })
  log.info("PDF generated", { uri })

  await shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "Export Recovery Journal",
  })
  log.info("Journal PDF shared successfully")
}
