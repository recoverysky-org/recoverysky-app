/**
 * Obtain the SQLCipher key for this launch — the I/O half of the decision in
 * `dbOpenLogic.ts` (`decideKeyAcquisition`).
 *
 * Three outcomes:
 *   - a key is stored → use it;
 *   - no key and no encrypted database on disk → genuine first launch, mint
 *     and store one;
 *   - no key but an encrypted database exists → throw `SqliteKeyMissingError`.
 *     Minting a key here would be fatal (RS-024): it can never open the
 *     existing file and it overwrites the slot the real key could still be
 *     restored into. DatabaseProvider turns this into the "can't unlock your
 *     local data" state with an explicit, user-confirmed reset.
 *
 * A SecureStore *failure* (device locked → errSecInteractionNotAllowed)
 * propagates as-is so the provider can classify it as transient.
 */

import {
  generateAndStoreSqliteEncryptionKey,
  loadSqliteEncryptionKey,
} from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { decideKeyAcquisition, SQLITE_KEY_MISSING_MARKER } from "./dbOpenLogic"
import { encryptedDatabaseBytes } from "./provider"

const log = logger.child({ module: "DatabaseProvider" })

export class SqliteKeyMissingError extends Error {
  readonly encryptedFileBytes: number
  constructor(encryptedFileBytes: number) {
    super(`${SQLITE_KEY_MISSING_MARKER}: no key in SecureStore but an encrypted database exists`)
    this.name = "SqliteKeyMissingError"
    this.encryptedFileBytes = encryptedFileBytes
  }
}

export async function acquireSqliteEncryptionKey(): Promise<string> {
  const storedKey = await loadSqliteEncryptionKey()
  const encryptedFileBytes = encryptedDatabaseBytes()
  const decision = decideKeyAcquisition({ storedKey, encryptedFileBytes })

  switch (decision) {
    case "use-stored":
      return storedKey as string
    case "generate-first-launch":
      return generateAndStoreSqliteEncryptionKey()
    case "key-missing":
      log.error("SQLite encryption key missing but encrypted database exists", {
        encryptedFileBytes,
      })
      throw new SqliteKeyMissingError(encryptedFileBytes)
  }
}
