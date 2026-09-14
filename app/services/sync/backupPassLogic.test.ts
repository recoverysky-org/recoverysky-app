import { describe, expect, it } from "vitest"

import { BACKUP_PASS_ID, decideBackupPass, type BackupPassInput } from "./backupPassLogic"

/** A launch where every precondition is met and backup is already on. */
const ready: BackupPassInput = {
  donePassId: null,
  signedIn: true,
  anonymous: false,
  entitled: true,
  syncEnabled: true,
  offline: false,
  maintenanceMode: false,
}

describe("decideBackupPass", () => {
  it("runs a backup when the user is entitled and backup is already on", () => {
    expect(decideBackupPass(ready)).toBe("backup")
  })

  it("prompts when the user is entitled but backup is off", () => {
    expect(decideBackupPass({ ...ready, syncEnabled: false })).toBe("prompt")
  })

  it("skips once this pass has been recorded as done", () => {
    expect(decideBackupPass({ ...ready, donePassId: BACKUP_PASS_ID })).toBe("skip")
    expect(decideBackupPass({ ...ready, syncEnabled: false, donePassId: BACKUP_PASS_ID })).toBe(
      "skip",
    )
  })

  it("re-runs when the recorded pass id is from an older pass", () => {
    expect(decideBackupPass({ ...ready, donePassId: "2020-01-01" })).toBe("backup")
  })

  it("skips a signed-out or anonymous user without consuming the pass", () => {
    expect(decideBackupPass({ ...ready, signedIn: false })).toBe("skip")
    expect(decideBackupPass({ ...ready, anonymous: true })).toBe("skip")
  })

  it("skips a user without the attendance entitlement", () => {
    expect(decideBackupPass({ ...ready, entitled: false })).toBe("skip")
    expect(decideBackupPass({ ...ready, entitled: false, syncEnabled: false })).toBe("skip")
  })

  it("defers while offline or in maintenance so the pass retries next launch", () => {
    expect(decideBackupPass({ ...ready, offline: true })).toBe("skip")
    expect(decideBackupPass({ ...ready, maintenanceMode: true })).toBe("skip")
    expect(decideBackupPass({ ...ready, syncEnabled: false, offline: true })).toBe("skip")
  })
})
