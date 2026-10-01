import { describe, expect, it } from "vitest"

import {
  SYNC_PUSH_BATCH_MAX,
  chunk,
  mergePullDecision,
  reportToLocalCreate,
  reportToLocalUpdate,
  toLocalCreate,
  toLocalUpdate,
  ownershipAction,
  toServerRecord,
  type ServerAttendanceRecord,
  type ServerReportRecord,
} from "./syncLogic"

const localRecord = {
  id: "att-1",
  iid: "iid-1",
  uid: "device-abc", // legacy anonymous-era uid — server re-stamps from Auth0 sub
  mid: "mid-1",
  zid: "123456789",
  created: 1751900000000,
  valid: true,
  events: [{ timestamp: 1751900000000, message: "joined", json: "{}" }],
  uzid: "uz-1",
  zpid: "zp-1",
  zuid: "zu-1",
  meetingHost: "Host",
  meetingName: "Morning Meeting",
  meetingTopic: "Topic",
  archived: false,
  processed: 1751900060000,
  start: 1751900000000,
  end: 1751903600000,
  credit: 3600000,
  produced: 0,
  arid: "",
}

const serverRecord: ServerAttendanceRecord = {
  ...localRecord,
  uid: "auth0|user1",
  deleted: false,
  updated: 1751999999999,
}

const serverReport: ServerReportRecord = {
  id: "rep-1",
  uid: "auth0|user1",
  name: "Jane D.",
  email: "jane@example.com",
  timezone: "America/New_York",
  generated: 1751900000000,
  confirmed: 1751900500000,
  confirmation: "msg-123",
  error: false,
  credit: 3600000,
  fid: "",
  updated: 1751999999999,
  deleted: false,
}

describe("toServerRecord", () => {
  it("maps every schema field and defaults deleted=false, updated=0", () => {
    const result = toServerRecord(localRecord)
    expect(result).toEqual({ ...localRecord, deleted: false, updated: 0 })
  })

  it("builds a tombstone when deleted=true (hard-delete snapshot path)", () => {
    expect(toServerRecord(localRecord, true).deleted).toBe(true)
  })

  it("clamps a credit that would overflow the api's int32 column (RS-034)", () => {
    const result = toServerRecord({ ...localRecord, credit: 3_207_443_155 })
    expect(result.credit).toBe(24 * 60 * 60 * 1000)
  })
})

describe("mergePullDecision", () => {
  it("skips records with a pending outbound push (local edit wins LWW later)", () => {
    expect(mergePullDecision({ deleted: false, hasPendingPush: true, existsLocally: true })).toBe(
      "skip-dirty",
    )
    // dirty-skip beats even a tombstone — our later push resurrects deliberately (LWW)
    expect(mergePullDecision({ deleted: true, hasPendingPush: true, existsLocally: true })).toBe(
      "skip-dirty",
    )
  })

  it("deletes on tombstone", () => {
    expect(mergePullDecision({ deleted: true, hasPendingPush: false, existsLocally: true })).toBe(
      "delete",
    )
  })

  it("updates existing, creates new", () => {
    expect(mergePullDecision({ deleted: false, hasPendingPush: false, existsLocally: true })).toBe(
      "update",
    )
    expect(mergePullDecision({ deleted: false, hasPendingPush: false, existsLocally: false })).toBe(
      "create",
    )
  })
})

describe("local converters", () => {
  it("toLocalCreate carries id and uid (server uid becomes local uid on create)", () => {
    const input = toLocalCreate(serverRecord)
    expect(input.id).toBe("att-1")
    expect(input.uid).toBe("auth0|user1")
    expect(input.credit).toBe(3600000)
    expect(input.events).toEqual(localRecord.events)
  })

  it("toLocalUpdate omits id/uid/created (AttendanceUpdateInput does not support them)", () => {
    const input = toLocalUpdate(serverRecord)
    expect(input).not.toHaveProperty("id")
    expect(input).not.toHaveProperty("uid")
    expect(input).not.toHaveProperty("created")
    expect(input.valid).toBe(true)
    expect(input.arid).toBe("")
  })

  it("reportToLocalUpdate NEVER touches html/text/messageId/retry (server omits bodies; local copies must survive)", () => {
    const input = reportToLocalUpdate(serverReport)
    expect(input).not.toHaveProperty("html")
    expect(input).not.toHaveProperty("text")
    expect(input).not.toHaveProperty("messageId")
    expect(input).not.toHaveProperty("retry")
    expect(input.confirmed).toBe(1751900500000)
    expect(input.email).toBe("jane@example.com")
  })

  it("reportToLocalCreate maps required uid/email and metadata", () => {
    const input = reportToLocalCreate(serverReport)
    expect(input.id).toBe("rep-1")
    expect(input.uid).toBe("auth0|user1")
    expect(input.email).toBe("jane@example.com")
    expect(input.generated).toBe(1751900000000)
  })
})

describe("chunk", () => {
  it("splits at the batch max", () => {
    const items = Array.from({ length: SYNC_PUSH_BATCH_MAX + 1 }, (_, i) => i)
    const batches = chunk(items, SYNC_PUSH_BATCH_MAX)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(200)
    expect(batches[1]).toHaveLength(1)
  })

  it("handles empty and exact-size inputs", () => {
    expect(chunk([], 200)).toEqual([])
    expect(
      chunk(
        Array.from({ length: 200 }, (_, i) => i),
        200,
      ),
    ).toHaveLength(1)
  })
})

describe("ownershipAction", () => {
  // ADDED 2026-09-30 (spec 2 §7): the owner's identity was linked into another
  // account, so the SAME person now arrives with the primary's sub.
  it("restamps, keeping unpushed edits, when the previous owner was relinked into this account", () => {
    expect(ownershipAction("email|jm", "google-oauth2|mm", ["email|jm"])).toBe("restamp")
  })

  it("still clears for a different account when aliases name someone else", () => {
    expect(ownershipAction("auth0|alice", "auth0|bob", ["email|jm"])).toBe("clear-then-stamp")
  })

  it("aliases never change the same-owner or fresh-install answers", () => {
    expect(ownershipAction("auth0|alice", "auth0|alice", ["auth0|alice"])).toBe("noop")
    expect(ownershipAction(null, "auth0|alice", ["email|jm"])).toBe("stamp")
  })

  it("clears when a DIFFERENT account signs in — the cross-account leak guard", () => {
    expect(ownershipAction("auth0|alice", "auth0|bob")).toBe("clear-then-stamp")
  })

  it("keeps the queue when the SAME user signs back in (offline edits survive a sign-out)", () => {
    expect(ownershipAction("auth0|alice", "auth0|alice")).toBe("noop")
  })

  it("stamps, never clears, when nothing has ever owned the queue (fresh install)", () => {
    expect(ownershipAction(null, "auth0|alice")).toBe("stamp")
    expect(ownershipAction(undefined, "auth0|alice")).toBe("stamp")
    expect(ownershipAction("", "auth0|alice")).toBe("stamp")
  })

  it("does nothing while signed out — the gate blocks pushes, so the rows are safe", () => {
    // Regression: clearing here discarded every unpushed edit on an ordinary
    // sign-out, since AuthenticationStore.logout() sets userId = undefined.
    expect(ownershipAction("auth0|alice", "")).toBe("noop")
  })
})
