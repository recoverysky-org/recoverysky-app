import { describe, expect, it } from "vitest"

import {
  addContact,
  canAddContact,
  decideCrisisLine,
  defaultRoleFor,
  dialUrl,
  digitsOf,
  MAX_SUPPORT_CONTACTS,
  moveUp,
  normalizeNumber,
  parseStoredContacts,
  pickerErrorCodeFrom,
  removeContact,
  serializeContacts,
  setRole,
  type SupportContact,
} from "./supportContactsLogic"

const julie: SupportContact = { role: "sponsor", name: "Julie J.", number: "+1 (555) 010-0001" }
const marco: SupportContact = { role: "support", name: "Marco", number: "555-010-0002" }
const sam: SupportContact = { role: "friend", name: "Sam", number: "555 010 0003" }

describe("numbers", () => {
  it("digitsOf strips everything but digits", () => {
    expect(digitsOf("+1 (555) 010-0001")).toBe("15550100001")
  })
  it("normalizeNumber keeps a leading + and digits only", () => {
    expect(normalizeNumber("+1 (555) 010-0001")).toBe("+15550100001")
    expect(normalizeNumber("555.010.0002")).toBe("5550100002")
  })
  it("dialUrl builds tel: and sms: links from the normalized number", () => {
    expect(dialUrl("call", "+1 (555) 010-0001")).toBe("tel:+15550100001")
    expect(dialUrl("text", "555 010 0003")).toBe("sms:5550100003")
  })
})

describe("defaultRoleFor / canAddContact", () => {
  it("is sponsor for the first contact and support person after", () => {
    expect(defaultRoleFor([])).toBe("sponsor")
    expect(defaultRoleFor([julie])).toBe("support")
  })
  it("allows adding below three contacts only", () => {
    expect(canAddContact([julie, marco])).toBe(true)
    expect(canAddContact([julie, marco, sam])).toBe(false)
  })
})

describe("addContact", () => {
  it("appends the trimmed pick with the given role", () => {
    const r = addContact([], { name: " Julie J. ", number: " +1 (555) 010-0001 " }, "sponsor")
    expect(r).toEqual({ kind: "ok", contacts: [julie] })
  })
  it("refuses a number already in the list, however it is formatted", () => {
    expect(addContact([julie], { name: "J", number: "1-555-010-0001" }, "friend")).toEqual({
      kind: "duplicate",
    })
  })
  it("refuses a fourth contact", () => {
    expect(
      addContact([julie, marco, sam], { name: "Ada", number: "5550100004" }, "family"),
    ).toEqual({ kind: "full" })
  })
  it("refuses a pick with no digits", () => {
    expect(addContact([], { name: "Nobody", number: " " }, "sponsor")).toEqual({ kind: "invalid" })
  })
  it("keeps an empty display name as an empty string", () => {
    const r = addContact([], { name: "  ", number: "5550100004" }, "sponsor")
    expect(r.kind).toBe("ok")
    if (r.kind === "ok") expect(r.contacts[0].name).toBe("")
  })
})

describe("removeContact / moveUp / setRole", () => {
  it("removes by index and keeps the rest in order", () => {
    expect(removeContact([julie, marco, sam], 1)).toEqual([julie, sam])
  })
  it("moves a row up one place and leaves the first row and bad indexes alone", () => {
    expect(moveUp([julie, marco, sam], 2)).toEqual([julie, sam, marco])
    expect(moveUp([julie, marco], 0)).toEqual([julie, marco])
    expect(moveUp([julie], 5)).toEqual([julie])
  })
  it("changes a role in place", () => {
    expect(setRole([julie], 0, "friend")).toEqual([{ ...julie, role: "friend" }])
  })
  it("never mutates its input", () => {
    const list = [julie, marco]
    moveUp(list, 1)
    removeContact(list, 0)
    setRole(list, 0, "family")
    expect(list).toEqual([julie, marco])
  })
})

describe("parseStoredContacts (fail closed)", () => {
  it("round-trips through serializeContacts", () => {
    expect(parseStoredContacts(serializeContacts([julie, marco]))).toEqual([julie, marco])
  })
  it("returns an empty list for null, bad JSON, a non-array, an unknown role or a missing field", () => {
    expect(parseStoredContacts(null)).toEqual([])
    expect(parseStoredContacts("{")).toEqual([])
    expect(parseStoredContacts('{"a":1}')).toEqual([])
    expect(parseStoredContacts(JSON.stringify([{ role: "boss", name: "x", number: "1" }]))).toEqual(
      [],
    )
    expect(parseStoredContacts(JSON.stringify([{ role: "sponsor", name: "x" }]))).toEqual([])
  })
  it("keeps at most three", () => {
    const four = [julie, marco, sam, { ...sam, name: "Ada", number: "5550100004" }]
    expect(parseStoredContacts(JSON.stringify(four))).toHaveLength(MAX_SUPPORT_CONTACTS)
  })
})

describe("decideCrisisLine (spec D5)", () => {
  it("is 988 for the US and Canada, in any case", () => {
    expect(decideCrisisLine("US")).toEqual({ number: "988" })
    expect(decideCrisisLine("ca")).toEqual({ number: "988" })
  })
  it("is null elsewhere and when the region is unknown", () => {
    expect(decideCrisisLine("GB")).toBeNull()
    expect(decideCrisisLine(null)).toBeNull()
    expect(decideCrisisLine(undefined)).toBeNull()
  })
})

describe("pickerErrorCodeFrom", () => {
  it("maps the module's codes and defaults to unknown", () => {
    expect(pickerErrorCodeFrom("ERR_NO_PICKER")).toBe("no_picker")
    expect(pickerErrorCodeFrom("ERR_NO_NUMBER")).toBe("no_number")
    expect(pickerErrorCodeFrom("ERR_IN_PROGRESS")).toBe("in_progress")
    expect(pickerErrorCodeFrom("ERR_SOMETHING")).toBe("unknown")
    expect(pickerErrorCodeFrom(undefined)).toBe("unknown")
  })
})
