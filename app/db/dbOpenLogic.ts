/**
 * Pure decisions for opening the encrypted SQLite database.
 *
 * Extracted from DatabaseProvider / earlyOpen so vitest can cover them (the
 * orchestrators import `@/`, which vitest cannot resolve — see CLAUDE.md
 * "Test Runner Split"). Keep this module free of runtime `@/` and native
 * imports.
 *
 * Background (RS-024, 2026-09-14): "SQLiteErrorException: Error code 7: out
 * of memory" from expo-sqlite on the FIRST statement after `PRAGMA key` is
 * not a memory problem. In this SQLCipher build a codec failure — key
 * derivation, or a page whose HMAC does not verify — makes `sqlite3Codec`
 * return NULL, and SQLite's pager maps a NULL codec result to SQLITE_NOMEM.
 * It means "this key cannot unlock this file", and the codec latches the
 * error for the life of the connection (retrying on the same handle can
 * never succeed). Two real-world causes were found in Loki:
 *   - the keychain item was gone while the encrypted file remained (Settings →
 *     Delete User Data clears the key and left the file; two devices lost the
 *     item with no app-side clear), and getSqliteEncryptionKey() treated "no
 *     key" as "first launch", minted a fresh key, and bricked the install;
 *   - SecureStore threw errSecInteractionNotAllowed (-25308) because the app
 *     was launched in the background while the phone was locked. That one
 *     heals as soon as the user unlocks and opens the app.
 */

export type KeyAcquisition = "use-stored" | "generate-first-launch" | "key-missing"

export type DbOpenFailureKind =
  /** SecureStore could not be read right now (device locked); retry later. */
  | "keychain-unavailable"
  /** A key exists but SQLCipher cannot unlock the file with it. */
  | "key-mismatch"
  /** No key in the keychain, yet an encrypted database is on disk. */
  | "key-missing"
  | "unknown"

/**
 * Marker embedded in the error thrown by the key-acquisition step when it
 * refuses to mint a key over an existing encrypted database. Matched by
 * `classifyDbOpenFailure`; never shown to users verbatim.
 */
export const SQLITE_KEY_MISSING_MARKER = "SQLITE_KEY_MISSING"

/**
 * Decide how to obtain the SQLCipher key for this launch.
 *
 * `encryptedFileBytes` is the on-disk size of the database file (0 when it is
 * absent). A zero-byte file is treated like no file: SQLite creates the file
 * lazily on open and SQLCipher treats an empty file as a brand-new database,
 * so any key works — and a launch killed between open and first write leaves
 * exactly that behind.
 */
export function decideKeyAcquisition(input: {
  storedKey: string | null
  encryptedFileBytes: number
}): KeyAcquisition {
  if (input.storedKey) return "use-stored"
  if (input.encryptedFileBytes > 0) return "key-missing"
  return "generate-first-launch"
}

/**
 * Classify a database-open failure from its stringified error. Patterns are
 * the exact strings expo-sqlite / expo-secure-store produce on iOS and
 * Android; keep them loose (substring) because the message arrives wrapped in
 * DrizzleError / FunctionCallException text.
 */
export function classifyDbOpenFailure(message: string): DbOpenFailureKind {
  if (message.includes(SQLITE_KEY_MISSING_MARKER)) return "key-missing"
  if (
    message.includes("User interaction is not allowed") ||
    message.includes("errSecInteractionNotAllowed") ||
    message.includes("-25308")
  ) {
    return "keychain-unavailable"
  }
  if (
    message.includes("Error code 7:") ||
    message.includes("out of memory") ||
    message.includes("Error code 26:") ||
    message.includes("file is not a database")
  ) {
    return "key-mismatch"
  }
  return "unknown"
}

/**
 * Automatic retry schedule. `attempt` is the number of attempts made so far
 * (1 after the first failure). Returns the delay before the next attempt, or
 * null to stop and wait for the user (Retry / Reset button, or a foreground
 * transition — DatabaseProvider retries on AppState "active" for the
 * transient kinds regardless of this budget).
 *
 * The budget is deliberately short: the old provider retried ~29 times a
 * second forever and one device produced 320 ERROR lines in 20 seconds.
 */
const TRANSIENT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 60_000]

export function nextAutoRetryDelayMs(kind: DbOpenFailureKind, attempt: number): number | null {
  if (kind === "key-mismatch" || kind === "key-missing") return null
  return TRANSIENT_RETRY_DELAYS_MS[attempt - 1] ?? null
}

/** True for the kinds a later attempt can plausibly fix without user action. */
export function isTransientFailure(kind: DbOpenFailureKind): boolean {
  return kind === "keychain-unavailable" || kind === "unknown"
}
