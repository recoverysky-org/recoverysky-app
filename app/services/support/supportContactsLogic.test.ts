import { describe, expect, it } from "vitest"

import {
  addContact,
  decideCrisisLine,
  defaultRoleFor,
  dialableNumber,
  dialUrl,
  digitsOf,
  moveUp,
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
  it("dialUrl builds tel: and sms: links from the dialable number", () => {
    expect(dialUrl("call", "+1 (555) 010-0001")).toBe("tel:+15550100001")
    expect(dialUrl("text", "555 010 0003")).toBe("sms:5550100003")
  })
})

// ADDED 2026-11-06 (final review I-2): the old normalizeNumber kept only digits, so a saved pause
// or extension merged into a longer number and the phone rang a stranger with no error at all.
describe("dialableNumber", () => {
  it("strips formatting: spaces, NBSP, ( ) . - /", () => {
    expect(dialableNumber(" +1 (555) 010-0001 ")).toBe("+15550100001")
    expect(dialableNumber("555.010.0002")).toBe("5550100002")
    expect(dialableNumber("555/010\u00A00003")).toBe("5550100003")
  })
  it("strips the invisible bidi marks address books embed", () => {
    const marks = "\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069"
    expect(dialableNumber(`${marks}+1 555 010 0001${marks}`)).toBe("+15550100001")
    expect(dialableNumber("\u202A+1 555 010 0001\u202C")).toBe("+15550100001")
  })
  it("keeps a saved pause or wait", () => {
    expect(dialableNumber("555-010-0001,,23")).toBe("5550100001,,23")
    expect(dialableNumber("555-010-0001;23")).toBe("5550100001;23")
  })
  it("turns an extension marker followed by digits into one pause", () => {
    for (const raw of [
      "555-010-0001 x23",
      "555-010-0001x23",
      "555-010-0001 X 23",
      "555-010-0001 ext 23",
      "555-010-0001 ext. 23",
      "555-010-0001 EXT.23",
      "555-010-0001 extension 23",
      "555-010-0001 Extension 23",
    ]) {
      expect(dialableNumber(raw)).toBe("5550100001,23")
    }
  })
  it("keeps * and #", () => {
    expect(dialableNumber("*67 555 010 0001")).toBe("*675550100001")
    expect(dialableNumber("555-010-0001#")).toBe("5550100001#")
  })
  it("returns null for anything else, rather than a guess", () => {
    expect(dialableNumber("")).toBeNull()
    expect(dialableNumber("   ")).toBeNull()
    expect(dialableNumber("()-")).toBeNull()
    expect(dialableNumber("+")).toBeNull()
    expect(dialableNumber("1-800-FLOWERS")).toBeNull()
    expect(dialableNumber("1+555")).toBeNull()
    expect(dialableNumber("++1555")).toBeNull()
    expect(dialableNumber("\u0661\u0662\u0663")).toBeNull() // Arabic-Indic digits
    expect(dialableNumber("555 x")).toBeNull()
    expect(dialableNumber("x23")).toBeNull()
    expect(dialableNumber("555 x1 x2")).toBeNull()
  })
  it("needs a digit before the first pause, so a text always has somewhere to go", () => {
    expect(dialableNumber(",,23")).toBeNull()
    expect(dialableNumber(";23")).toBeNull()
    expect(dialableNumber("*#,23")).toBeNull()
  })
})

describe("dialUrl", () => {
  it("a pause or wait stays in the call and leaves the text", () => {
    expect(dialUrl("call", "555-010-0001,,23")).toBe("tel:5550100001,,23")
    expect(dialUrl("text", "555-010-0001,,23")).toBe("sms:5550100001")
    expect(dialUrl("call", "555-010-0001;23")).toBe("tel:5550100001;23")
    expect(dialUrl("text", "555-010-0001;23")).toBe("sms:5550100001")
  })
  it("an extension dials after one pause", () => {
    expect(dialUrl("call", "555-010-0001 x23")).toBe("tel:5550100001,23")
    expect(dialUrl("call", "555-010-0001 ext. 23")).toBe("tel:5550100001,23")
    expect(dialUrl("text", "555-010-0001 ext. 23")).toBe("sms:5550100001")
  })
  it("keeps a leading + and *", () => {
    expect(dialUrl("call", "+1 (555) 010-0001")).toBe("tel:+15550100001")
    expect(dialUrl("call", "*67 555 010 0001")).toBe("tel:*675550100001")
  })
  it("percent-encodes #, which would otherwise start a URL fragment", () => {
    expect(dialUrl("call", "555-010-0001#")).toBe("tel:5550100001%23")
    expect(dialUrl("call", "*43#555")).toBe("tel:*43%23555")
    expect(dialUrl("text", "555#1")).toBe("sms:555%231")
  })
  it("is null when the number cannot be dialled", () => {
    expect(dialUrl("call", "1-800-FLOWERS")).toBeNull()
    expect(dialUrl("text", "1-800-FLOWERS")).toBeNull()
    expect(dialUrl("call", "")).toBeNull()
  })
  it("988 still works both ways", () => {
    expect(dialUrl("call", "988")).toBe("tel:988")
    expect(dialUrl("text", "988")).toBe("sms:988")
  })
  it("a bidi-wrapped number is clean", () => {
    expect(dialUrl("call", "\u202A+1 555 010 0001\u202C")).toBe("tel:+15550100001")
  })
})

describe("defaultRoleFor", () => {
  it("is sponsor for the first contact and support person after", () => {
    expect(defaultRoleFor([])).toBe("sponsor")
    expect(defaultRoleFor([julie])).toBe("support")
  })
})

describe("addContact, number-as-name (spec D1)", () => {
  const added = (name: string) => {
    const r = addContact([], { name, number: "+1 (555) 010-0001" }, "friend")
    if (r.kind !== "ok") throw new Error("expected ok")
    return r.contacts[0]
  }
  it("stores an empty name when the name is a formatted phone number, keeping the number", () => {
    expect(added("+1 (555) 010-0001")).toEqual({
      role: "friend",
      name: "",
      number: "+1 (555) 010-0001",
    })
  })
  it("stores an empty name for a bare digit string", () => {
    expect(added("5550100001").name).toBe("")
  })
  // ADDED 2026-11-06 (final review I-2): every form dialableNumber accepts is a number, so none
  // may reach a row as a name. Bidi marks and an extension both got past the character class.
  it("stores an empty name for a bidi-wrapped number or one with an extension", () => {
    expect(added("\u202A+1 555 010 0001\u202C").name).toBe("")
    expect(added("555-010-0001 x23").name).toBe("")
    expect(added("555-010-0001 ext. 23").name).toBe("")
  })
  it("keeps a real name that contains digits", () => {
    expect(added("12 Step Dave").name).toBe("12 Step Dave")
  })
  it("leaves an empty name empty", () => {
    expect(added("").name).toBe("")
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
  // CHANGED 2026-11-08: was "refuses a fourth contact"; the three-contact cap is gone.
  it("adds a fourth contact and beyond", () => {
    const r = addContact([julie, marco, sam], { name: "Ada", number: "5550100004" }, "family")
    expect(r).toEqual({
      kind: "ok",
      contacts: [julie, marco, sam, { role: "family", name: "Ada", number: "5550100004" }],
    })
  })
  it("refuses a pick with no digits", () => {
    expect(addContact([], { name: "Nobody", number: " " }, "sponsor")).toEqual({ kind: "invalid" })
  })
  it("refuses a number that cannot be dialled", () => {
    expect(addContact([], { name: "Flowers", number: "1-800-FLOWERS" }, "friend")).toEqual({
      kind: "invalid",
    })
  })
  it("stores a dialable number trimmed and otherwise verbatim", () => {
    const r = addContact([], { name: "Julie", number: " 555-010-0001 ext. 23 " }, "sponsor")
    expect(r).toEqual({
      kind: "ok",
      contacts: [{ role: "sponsor", name: "Julie", number: "555-010-0001 ext. 23" }],
    })
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
  // CHANGED 2026-11-08: was "keeps at most three"; every stored contact is kept now.
  it("keeps every stored contact", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      role: "friend" as const,
      name: `Friend ${i}`,
      number: `55501000${String(i).padStart(2, "0")}`,
    }))
    expect(parseStoredContacts(JSON.stringify(many))).toEqual(many)
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
