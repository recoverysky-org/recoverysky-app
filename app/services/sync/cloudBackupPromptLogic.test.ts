import { describe, expect, it } from "vitest"

import { decideCloudBackupPrompt } from "./cloudBackupPromptLogic"

const ready = { web: false, entitled: true, syncEnabled: false }

describe("decideCloudBackupPrompt", () => {
  it("prompts an entitled user whose backup is still off", () => {
    expect(decideCloudBackupPrompt(ready)).toBe("prompt")
  })

  it("skips when backup is already on — nothing to ask", () => {
    expect(decideCloudBackupPrompt({ ...ready, syncEnabled: true })).toBe("skip")
  })

  it("skips without the attendance entitlement — the Cloud Backup section never renders", () => {
    expect(decideCloudBackupPrompt({ ...ready, entitled: false })).toBe("skip")
  })

  it("skips on web — react-native-web's Alert is a no-op and the dialog would never settle", () => {
    expect(decideCloudBackupPrompt({ ...ready, web: true })).toBe("skip")
  })
})
