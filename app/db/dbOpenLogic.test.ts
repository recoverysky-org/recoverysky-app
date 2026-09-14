import { describe, expect, it } from "vitest"

import {
  classifyDbOpenFailure,
  decideKeyAcquisition,
  nextAutoRetryDelayMs,
  SQLITE_KEY_MISSING_MARKER,
} from "./dbOpenLogic"

describe("decideKeyAcquisition", () => {
  it("uses the stored key when one exists", () => {
    expect(decideKeyAcquisition({ storedKey: "ab".repeat(32), encryptedFileBytes: 4096 })).toBe(
      "use-stored",
    )
    expect(decideKeyAcquisition({ storedKey: "ab".repeat(32), encryptedFileBytes: 0 })).toBe(
      "use-stored",
    )
  })

  it("generates a key only when there is no encrypted data to unlock", () => {
    // Genuine first launch: nothing in the keychain, no database on disk.
    expect(decideKeyAcquisition({ storedKey: null, encryptedFileBytes: 0 })).toBe(
      "generate-first-launch",
    )
  })

  it("refuses to generate when an encrypted database already exists", () => {
    // RS-024: the keychain item vanished (Delete User Data cleared it, or the
    // OS lost it) but the SQLCipher file is still there. A fresh key can
    // never open that file, and storing it destroys the last chance of the
    // old key coming back.
    expect(decideKeyAcquisition({ storedKey: null, encryptedFileBytes: 4096 })).toBe("key-missing")
  })

  it("treats an empty string as no key", () => {
    expect(decideKeyAcquisition({ storedKey: "", encryptedFileBytes: 4096 })).toBe("key-missing")
  })
})

describe("classifyDbOpenFailure", () => {
  it("recognises the SQLCipher wrong-key signature (SQLITE_NOMEM from the codec)", () => {
    expect(
      classifyDbOpenFailure(
        "DrizzleError: Failed to run the query 'CREATE TABLE IF NOT EXISTS \"__drizzle_migrations\"' → Caused by: SQLiteErrorException: Error code 7: out of memory (at ExpoSQLite/SQLiteModule.swift:382)",
      ),
    ).toBe("key-mismatch")
  })

  it("recognises SQLITE_NOTADB as a wrong key too", () => {
    expect(classifyDbOpenFailure("Error code 26: file is not a database")).toBe("key-mismatch")
  })

  it("recognises a locked keychain as transient", () => {
    expect(
      classifyDbOpenFailure(
        "Error: Caught exception: User interaction is not allowed. → Caused by: User interaction is not allowed.",
      ),
    ).toBe("keychain-unavailable")
    expect(classifyDbOpenFailure("errSecInteractionNotAllowed (-25308)")).toBe(
      "keychain-unavailable",
    )
  })

  it("recognises the key-missing marker thrown by the key acquisition step", () => {
    expect(classifyDbOpenFailure(`Error: ${SQLITE_KEY_MISSING_MARKER}`)).toBe("key-missing")
  })

  it("falls back to unknown", () => {
    expect(classifyDbOpenFailure("Error: something else entirely")).toBe("unknown")
  })
})

describe("nextAutoRetryDelayMs", () => {
  it("backs off on transient failures and then stops", () => {
    expect(nextAutoRetryDelayMs("keychain-unavailable", 1)).toBe(1_000)
    expect(nextAutoRetryDelayMs("keychain-unavailable", 2)).toBe(5_000)
    expect(nextAutoRetryDelayMs("keychain-unavailable", 3)).toBe(30_000)
    expect(nextAutoRetryDelayMs("keychain-unavailable", 4)).toBe(60_000)
    expect(nextAutoRetryDelayMs("keychain-unavailable", 5)).toBeNull()
    expect(nextAutoRetryDelayMs("unknown", 1)).toBe(1_000)
  })

  it("never auto-retries a wrong or missing key — only the user can resolve those", () => {
    expect(nextAutoRetryDelayMs("key-mismatch", 1)).toBeNull()
    expect(nextAutoRetryDelayMs("key-missing", 1)).toBeNull()
  })
})
