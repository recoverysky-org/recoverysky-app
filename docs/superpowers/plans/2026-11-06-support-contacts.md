# Support Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to three support contacts (sponsor first), picked once from the phone's own contact picker, callable and textable from a Home card and from a Support screen that My Day's crisis path now opens, with names only ever shown and the numbers kept in the keychain.

**Architecture:** A tiny local Expo module (`modules/phone-contact-picker`) wraps the permission-free OS pickers. Pure decisions live in `app/services/support/supportContactsLogic.ts` (vitest); SecureStore I/O in `supportContactsStorage.ts`; a volatile-only MST `SupportStore` holds the list in memory so nothing reaches an MMKV snapshot. Presentational `SupportCard` / `SupportContactRow` / `OptionSheet` components never receive a number; the observer container, the `useAddSupportContact` hook and `SupportScreen` are the only code that touches one, and only to hand it to `Linking`.

**Tech Stack:** Expo SDK 54 (Expo Modules API, Kotlin + Swift), React Native 0.81, MobX-State-Tree, React Navigation v7, expo-secure-store, expo-localization, i18next (nine locales), vitest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-11-06-support-contacts-design.md` (read it first; D1 to D10 are the decisions this plan argues from).

## Global Constraints

- **Names only (spec D1).** No component, label, accessibility string, toast, alert, log line, analytics event or error message ever carries a contact's number. Presentational components take `{ roleTx, name }`, never a `SupportContact`.
- **Storage (D4):** one SecureStore key, `support_contacts_v1`, JSON array of at most 3 `{ role, name, number }`. Never in an MST prop, MMKV, SQLite, cloud backup, logs or analytics. `SupportStore` has **no props**; `getSnapshot(store)` is `{}`.
- **No contacts permission (D2):** no `READ_CONTACTS`, `WRITE_CONTACTS` or `NSContactsUsageDescription` anywhere in `app.json`, `modules/` or `plugins/`. A policy test enforces it.
- **Picker contract (D2):** `null` means cancel; every failure rejects with `ERR_NO_PICKER`, `ERR_NO_NUMBER` or `ERR_IN_PROGRESS`.
- **Crisis line (D5):** `decideCrisisLine(regionCode)` is `{ number: "988" }` for `US` / `CA` (any case), else `null`.
- **Vitest cannot resolve `@/`:** `supportContactsLogic.ts`, `myDayNavigation.ts` and the policy test keep zero runtime `@/` imports (type-only imports are fine).
- **Nine locale files:** every new key goes in `en.ts` and the eight others (English placeholders), or `npm run compile` fails.
- **House rules (CLAUDE.md):** liberal comments with `ADDED 2026-11-xx` / `CHANGED` notes; never `npm run lint` repo-wide (use `npx eslint --fix <files you touched>`); never `git add -A`, never `git stash`; stage only the paths you touched; end every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Release:** native. The `version` / `runtimeVersion` / `versionCode` bump is a release-time step (spec Status), not a task here. Nothing in this plan ships as an OTA.
- **Workspace:** branch `feat/support-contacts` cut from `root`, in the worktree `.claude/worktrees/support-contacts`. Every subagent dispatch starts with `cd` into that worktree and a `git branch --show-current` check (subagents launch in the main checkout otherwise).
- Tests: `npm run test:unit -- <file>` (vitest, `*.test.ts`), `npm run test:component -- <file>` (jest, `*.test.tsx`); `npm test` runs both.

## Review Focus

1. **A picked Android row with a number but a null display name** → the contact is kept with `name: ""` and the row shows the role alone (Task 1 `addContact` test, Task 5 row test).
2. **SecureStore throws on load** (locked keychain on a background launch) → `hydrate()` resolves with an empty list, the card shows its empty state, nothing crashes (Task 3 store test).
3. **`Linking.openURL` rejects** (simulator, web, no phone app) → `openDial` returns `false`, the caller shows "Couldn't open the phone app" (Task 5 dial test).
4. **Corrupt or future-shaped JSON in the keychain** → `parseStoredContacts` returns `[]` and the app behaves as if nothing was saved (Task 1 test).
5. **Two taps on Choose before the picker opens** → the hook ignores the second tap while one pick is in flight; the native module would otherwise reject with `ERR_IN_PROGRESS` (Task 6 hook test).

---

## File structure

Create:
- `modules/phone-contact-picker/` — `expo-module.config.json`, `package.json`, `index.ts`, `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/java/live/meetingmaker/phonecontactpicker/PhoneContactPickerModule.kt`, `ios/PhoneContactPicker.podspec`, `ios/PhoneContactPickerModule.swift`
- `app/services/support/supportContactsLogic.ts` (+ `.test.ts`) — pure decisions
- `app/services/support/supportContactsStorage.ts` — SecureStore I/O
- `app/services/support/phoneContactPicker.ts` — wrapper over the native module
- `app/services/support/dial.ts` (+ `dial.test.tsx`) — `Linking` I/O
- `app/services/support/deviceRegion.ts` — expo-localization read
- `app/services/support/supportPolicy.test.ts` — permission grep
- `app/services/support/index.ts` — barrel
- `app/models/SupportStore.ts` (+ `SupportStore.test.tsx`)
- `app/components/OptionSheet.tsx` (+ test), `app/components/SupportContactRow.tsx` (+ test), `app/components/SupportCard.tsx` (+ test), `app/components/SupportCardContainer.tsx`
- `app/hooks/useAddSupportContact.ts` (+ `.test.tsx`)
- `app/screens/SupportScreen.tsx` (+ test)
- `app/navigators/myDayNavigation.test.ts`
- `docs/manual/home/support.md`

Modify: `app.json`, `app/app.tsx`, `app/models/RootStore.ts`, `app/models/index.ts`, `app/models/helpers/useStores.ts`, `app/i18n/*.ts` (nine), `app/screens/HomeScreen.tsx`, `app/screens/SettingsScreen.tsx`, `app/utils/devPurge.ts`, `app/db/DatabaseProvider.tsx`, `app/navigators/navigationTypes.ts`, `app/navigators/AppNavigator.tsx`, `app/navigators/myDayNavigation.ts`, `docs/manual/map.md`, `docs/manual/questions.yml`, `docs/superpowers/specs/2026-10-25-my-day-tab-design.md`, `docs/translation-review-2026-08-03.md`, `CHANGELOG.md`, `CLAUDE.md`.

---

### Task 0: Branch, worktree, and the two documents

**Files:** none of the app's; commits the spec and this plan.

- [ ] **Step 1: Create the worktree** (superpowers:using-git-worktrees): branch `feat/support-contacts` from `root`, at `.claude/worktrees/support-contacts`. Copy `docs/superpowers/specs/2026-11-06-support-contacts-design.md` and `docs/superpowers/plans/2026-11-06-support-contacts.md` into it if they are uncommitted in the main checkout (they were written there).
- [ ] **Step 2: Install and prove the tree is green**

Run (in the worktree): `npm install && npm run compile && npm test`
Expected: both runners pass before any change.

- [ ] **Step 3: Commit the documents**

```bash
git add docs/superpowers/specs/2026-11-06-support-contacts-design.md docs/superpowers/plans/2026-11-06-support-contacts.md
git commit -m "📝 docs(support): support contacts design and plan"
```

---

### Task 1: Pure decisions — `supportContactsLogic.ts`

**Files:**
- Create: `app/services/support/supportContactsLogic.ts`
- Test: `app/services/support/supportContactsLogic.test.ts`

**Interfaces:**
- Produces (all exported):
  - `MAX_SUPPORT_CONTACTS = 3`
  - `SUPPORT_ROLES = ["sponsor", "support", "friend", "family"] as const`; `type SupportRole`
  - `interface SupportContact { role: SupportRole; name: string; number: string }`
  - `interface PickedPhoneContact { name: string; number: string }`
  - `type AddResult = { kind: "ok"; contacts: SupportContact[] } | { kind: "full" } | { kind: "duplicate" } | { kind: "invalid" }`
  - `digitsOf(number: string): string` — every non-digit removed; the duplicate key
  - `normalizeNumber(number: string): string` — a leading `+` if present, then digits only; what `tel:` / `sms:` get
  - `defaultRoleFor(contacts: readonly SupportContact[]): SupportRole` — `"sponsor"` when empty, else `"support"`
  - `canAddContact(contacts: readonly SupportContact[]): boolean`
  - `addContact(contacts: readonly SupportContact[], picked: PickedPhoneContact, role: SupportRole): AddResult` — trims name and number; `invalid` when `digitsOf(number)` is empty; `full` at 3; `duplicate` when `digitsOf` matches an existing row; stores the trimmed number verbatim
  - `removeContact(contacts, index: number): SupportContact[]`, `moveUp(contacts, index: number): SupportContact[]`, `setRole(contacts, index: number, role: SupportRole): SupportContact[]` — all return new arrays; an out-of-range index returns a copy unchanged
  - `serializeContacts(contacts: readonly SupportContact[]): string`
  - `parseStoredContacts(json: string | null): SupportContact[]` — fail closed: any non-array, bad JSON, element missing a string `name` / `number` or with a role outside `SUPPORT_ROLES` → `[]`; at most 3 kept
  - `decideCrisisLine(regionCode: string | null | undefined): { number: string } | null`
  - `type DialKind = "call" | "text"`; `dialUrl(kind: DialKind, number: string): string` — `tel:` / `sms:` + `normalizeNumber(number)`
  - `type PhoneContactPickerErrorCode = "no_picker" | "no_number" | "in_progress" | "unknown"`; `pickerErrorCodeFrom(nativeCode: unknown): PhoneContactPickerErrorCode` — `ERR_NO_PICKER` → `no_picker`, `ERR_NO_NUMBER` → `no_number`, `ERR_IN_PROGRESS` → `in_progress`, anything else → `unknown`
  - `SUPPORT_ROLE_TX: Record<SupportRole, TxKeyPath>` — `sponsor → "support:roleSponsor"`, `support → "support:roleSupport"`, `friend → "support:roleFriend"`, `family → "support:roleFamily"` (`import type { TxKeyPath } from "@/i18n"` is type-only and allowed; the keys land in Task 4, so until then type this constant's values as `string` and tighten it in Task 4)

- [ ] **Step 1: Write the failing tests**

```ts
// app/services/support/supportContactsLogic.test.ts
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
    expect(parseStoredContacts(JSON.stringify([{ role: "boss", name: "x", number: "1" }]))).toEqual([])
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- app/services/support/supportContactsLogic.test.ts`
Expected: FAIL, "Failed to resolve import ./supportContactsLogic".

- [ ] **Step 3: Implement `app/services/support/supportContactsLogic.ts`** with the exported names above. Header comment: spec D1/D3/D4/D5 and the vitest rule (no runtime `@/` imports). `parseStoredContacts` validates every element with a type guard; `addContact` compares `digitsOf` against every row.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- app/services/support/supportContactsLogic.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add app/services/support/supportContactsLogic.ts app/services/support/supportContactsLogic.test.ts
git commit -m "✨ feat(support): pure support-contact decisions (add, order, roles, crisis line, parsing)"
```

---

### Task 2: The local Expo module `phone-contact-picker`, its wrapper, and the permission policy test

**Files:**
- Create: everything under `modules/phone-contact-picker/` (listed below)
- Create: `app/services/support/phoneContactPicker.ts`
- Test: `app/services/support/supportPolicy.test.ts`
- Modify: `app.json` (remove the `NSContactsUsageDescription` line under `ios.infoPlist`)

**Interfaces:**
- Consumes: `PickedPhoneContact`, `pickerErrorCodeFrom`, `PhoneContactPickerErrorCode` (Task 1).
- Produces:
  - `modules/phone-contact-picker/index.ts` default export: `PhoneContactPickerNativeModule | null` (`null` on web and on any build without the module)
  - `app/services/support/phoneContactPicker.ts`: `class PhoneContactPickerError extends Error { readonly code: PhoneContactPickerErrorCode }`, `isPhoneContactPickerAvailable(): boolean`, `pickPhoneContact(): Promise<PickedPhoneContact | null>` (rejects only with `PhoneContactPickerError`)

- [ ] **Step 1: Write the failing policy test**

```ts
// app/services/support/supportPolicy.test.ts
// Spec D2: the picker needs no contacts permission, so none may exist in the app's native
// config or in the module. Spans files no unit test can see, so it greps them (the pattern
// dailyDashPolicy.test.ts set).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repo = path.join(__dirname, "..", "..", "..")
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const FORBIDDEN = /READ_CONTACTS|WRITE_CONTACTS|NSContactsUsageDescription/

describe("support contacts permission policy (spec D2)", () => {
  it("the module exists and declares no contacts permission", () => {
    const dir = path.join(repo, "modules", "phone-contact-picker")
    expect(existsSync(dir)).toBe(true)
    const hits = files(dir).filter((p) => FORBIDDEN.test(readFileSync(p, "utf8")))
    expect(hits).toEqual([])
  })
  it("app.json and plugins/ carry no contacts permission or usage string", () => {
    const targets = [path.join(repo, "app.json"), ...files(path.join(repo, "plugins"))]
    const hits = targets.filter((p) => FORBIDDEN.test(readFileSync(p, "utf8")))
    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- app/services/support/supportPolicy.test.ts`
Expected: FAIL on both: the module directory does not exist, and `app.json` carries `NSContactsUsageDescription`.

- [ ] **Step 3: Remove the stale key from `app.json`**: delete the `"NSContactsUsageDescription": "Contacts access enables inviting friends to meetings"` line under `ios.infoPlist` (spec D10). Keep the JSON valid (the previous line loses its trailing comma).

- [ ] **Step 4: Create the module files.** The layout is Expo's `expo-module-template-local` (SDK 54) minus the view and web parts.

`modules/phone-contact-picker/expo-module.config.json`
```json
{
  "platforms": ["apple", "android"],
  "apple": { "modules": ["PhoneContactPickerModule"] },
  "android": { "modules": ["live.meetingmaker.phonecontactpicker.PhoneContactPickerModule"] }
}
```

`modules/phone-contact-picker/package.json`
```json
{
  "name": "phone-contact-picker",
  "version": "1.0.0",
  "private": true,
  "description": "RecoverySky's permission-free phone-number picker (spec 2026-11-06-support-contacts-design.md D2)"
}
```

`modules/phone-contact-picker/index.ts`
```ts
/**
 * The phone's own contact picker, limited to one phone number, with no contacts permission
 * on either platform (support contacts spec D2). `null` on web and on any build that does not
 * link the module, so callers can hide the feature instead of crashing.
 */
import { requireOptionalNativeModule } from "expo"

export interface PickedPhoneContactPayload {
  name: string
  number: string
}

export interface PhoneContactPickerNativeModule {
  /** Resolves `null` when the person cancels. Rejects with code ERR_NO_PICKER, ERR_NO_NUMBER or ERR_IN_PROGRESS. */
  pickPhoneContact(): Promise<PickedPhoneContactPayload | null>
}

const PhoneContactPicker = requireOptionalNativeModule<PhoneContactPickerNativeModule>("PhoneContactPicker")

export default PhoneContactPicker
```

`modules/phone-contact-picker/android/build.gradle`
```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'live.meetingmaker.phonecontactpicker'
version = '1.0.0'

android {
  namespace "live.meetingmaker.phonecontactpicker"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
  lintOptions {
    abortOnError false
  }
}
```

`modules/phone-contact-picker/android/src/main/AndroidManifest.xml`
```xml
<manifest>
</manifest>
```

`modules/phone-contact-picker/android/src/main/java/live/meetingmaker/phonecontactpicker/PhoneContactPickerModule.kt`
```kotlin
package live.meetingmaker.phonecontactpicker

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract.CommonDataKinds.Phone
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Support contacts spec D2: ACTION_PICK with the Phone content type returns a URI the app may
// read without READ_CONTACTS (Android's own guidance), unlike expo-contacts, which re-queries
// the contacts provider by id and so needs the permission. The request code only has to be
// unique within this app's activity results.
private const val REQUEST_PICK_PHONE = 0x5CAF

class NoPickerException : CodedException("ERR_NO_PICKER", "No app on this phone can pick a contact", null)
class NoNumberException : CodedException("ERR_NO_NUMBER", "The picked contact has no readable number", null)
class InProgressException : CodedException("ERR_IN_PROGRESS", "A contact pick is already open", null)

class PhoneContactPickerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("PhoneContactPicker")

    AsyncFunction("pickPhoneContact") { promise: Promise ->
      if (pending != null) throw InProgressException()
      val activity = appContext.throwingActivity
      val intent = Intent(Intent.ACTION_PICK).apply { type = Phone.CONTENT_TYPE }
      // No resolveActivity() first: on Android 11+ that needs a <queries> entry to see the
      // contacts app, while starting the implicit intent does not. A missing handler throws here.
      try {
        activity.startActivityForResult(intent, REQUEST_PICK_PHONE)
      } catch (e: ActivityNotFoundException) {
        throw NoPickerException()
      }
      pending = promise
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_PICK_PHONE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val picked = readPhoneRow(uri)
      if (picked == null) promise.reject(NoNumberException()) else promise.resolve(picked)
    }
  }

  /** Reads name and number from the one Data row the picker returned. Null when unreadable or empty. */
  private fun readPhoneRow(uri: Uri): Map<String, String>? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    val projection = arrayOf(Phone.NUMBER, Phone.DISPLAY_NAME)
    return try {
      resolver.query(uri, projection, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return null
        val number = cursor.getString(cursor.getColumnIndexOrThrow(Phone.NUMBER))?.trim().orEmpty()
        val name = cursor.getString(cursor.getColumnIndexOrThrow(Phone.DISPLAY_NAME))?.trim().orEmpty()
        if (number.isEmpty()) null else mapOf("name" to name, "number" to number)
      }
    } catch (e: SecurityException) {
      null
    }
  }
}
```

`modules/phone-contact-picker/ios/PhoneContactPicker.podspec`
```ruby
Pod::Spec.new do |s|
  s.name           = 'PhoneContactPicker'
  s.version        = '1.0.0'
  s.summary        = "RecoverySky's permission-free phone-number picker"
  s.description    = 'Presents CNContactPickerViewController limited to phone numbers; no contacts authorization is needed.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
```

`modules/phone-contact-picker/ios/PhoneContactPickerModule.swift`
```swift
import ContactsUI
import ExpoModulesCore

// Support contacts spec D2: Apple's picker runs out of process; "the app using contact picker
// view does not need access to the user's contacts and the user will not be prompted". Limiting
// the displayed keys to phone numbers and selecting a property makes the person tap the exact
// number, so a contact with three numbers never has to be disambiguated by us.
// Expo derives the JS error code from the class name: NoPickerException → ERR_NO_PICKER.
internal final class NoPickerException: Exception {
  override var reason: String { "No view controller to present the contact picker from" }
}
internal final class NoNumberException: Exception {
  override var reason: String { "The picked contact has no readable number" }
}
internal final class InProgressException: Exception {
  override var reason: String { "A contact pick is already open" }
}

public class PhoneContactPickerModule: Module {
  private var pending: Promise?
  private var pickerDelegate: PhonePickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("PhoneContactPicker")

    AsyncFunction("pickPhoneContact") { (promise: Promise) in
      if self.pending != nil {
        throw InProgressException()
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw NoPickerException()
      }
      let picker = CNContactPickerViewController()
      picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
      picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
      picker.predicateForSelectionOfProperty = NSPredicate(format: "key == 'phoneNumbers'")
      let delegate = PhonePickerDelegate(
        onPick: { [weak self] property in self?.finish(with: property) },
        onCancel: { [weak self] in self?.finish(with: nil) }
      )
      self.pickerDelegate = delegate
      picker.delegate = delegate
      self.pending = promise
      presenter.present(picker, animated: true)
    }.runOnQueue(.main)
  }

  private func finish(with property: CNContactProperty?) {
    guard let promise = pending else { return }
    pending = nil
    pickerDelegate = nil
    guard let property = property else {
      promise.resolve(nil)
      return
    }
    guard let phone = property.value as? CNPhoneNumber, !phone.stringValue.isEmpty else {
      promise.reject(NoNumberException())
      return
    }
    promise.resolve(["name": displayName(of: property.contact), "number": phone.stringValue])
  }

  /// The picker returns the keys it displayed plus what it needed for the name; reading an
  /// unfetched key throws an ObjC exception, so every read is guarded by isKeyAvailable.
  private func displayName(of contact: CNContact) -> String {
    let descriptor = CNContactFormatter.descriptorForRequiredKeys(for: .fullName)
    if contact.areKeysAvailable([descriptor]),
       let full = CNContactFormatter.string(from: contact, style: .fullName),
       !full.isEmpty {
      return full
    }
    var parts: [String] = []
    if contact.isKeyAvailable(CNContactGivenNameKey) { parts.append(contact.givenName) }
    if contact.isKeyAvailable(CNContactFamilyNameKey) { parts.append(contact.familyName) }
    let joined = parts.filter { !$0.isEmpty }.joined(separator: " ")
    if !joined.isEmpty { return joined }
    if contact.isKeyAvailable(CNContactOrganizationNameKey) { return contact.organizationName }
    return ""
  }
}

private final class PhonePickerDelegate: NSObject, CNContactPickerDelegate {
  private let onPick: (CNContactProperty) -> Void
  private let onCancel: () -> Void

  init(onPick: @escaping (CNContactProperty) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
  }

  func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
    onPick(contactProperty)
  }

  func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
    onCancel()
  }
}
```

- [ ] **Step 5: Write `app/services/support/phoneContactPicker.ts`**

Signature and behaviour:
```ts
import PhoneContactPicker from "../../../modules/phone-contact-picker"
export class PhoneContactPickerError extends Error { constructor(readonly code: PhoneContactPickerErrorCode) }
export function isPhoneContactPickerAvailable(): boolean   // PhoneContactPicker !== null
export async function pickPhoneContact(): Promise<PickedPhoneContact | null>
```
`pickPhoneContact` throws `PhoneContactPickerError("no_picker")` when the module is null, otherwise awaits the native call and rethrows any rejection as `new PhoneContactPickerError(pickerErrorCodeFrom((e as { code?: unknown })?.code))`. Logs (module `"Support"`) one `warn` line with `{ code }` on failure and nothing on success: no name, no number. Relative import on purpose: `@/*` maps to `app/*` and `modules/` sits beside it; this file is the one place the module is imported.

- [ ] **Step 6: Run the policy test and the type check**

Run: `npm run test:unit -- app/services/support/supportPolicy.test.ts && npm run compile`
Expected: PASS; tsc clean.

- [ ] **Step 7: Prove autolinking sees the module, then prebuild**

Run: `npx expo-modules-autolinking search --platform android | grep -i phone-contact-picker && npx expo-modules-autolinking search --platform apple | grep -i phone-contact-picker`
Expected: one line each naming `modules/phone-contact-picker`.

Run: `npm run prebuild:clean`
Expected: completes; `grep -c PhoneContactPicker ios/Podfile.lock` prints at least 1.

- [ ] **Step 8: Compile both native sides once** (the only check that catches a Swift or Kotlin error)

Run: `npx expo run:ios --no-bundler` (a simulator must be available) and `npm run build:android:sim:debug`
Expected: both builds succeed. Fix compile errors in the native files until they do; the JS contract above does not change.

- [ ] **Step 9: Commit**

```bash
git add app.json modules/phone-contact-picker app/services/support/phoneContactPicker.ts app/services/support/supportPolicy.test.ts
git commit -m "✨ feat(support): permission-free phone-number picker module; drop the stale contacts usage string"
```

---

### Task 3: Storage, the volatile `SupportStore`, and the cold-start hydrate

**Files:**
- Create: `app/services/support/supportContactsStorage.ts`, `app/services/support/index.ts`, `app/models/SupportStore.ts`
- Modify: `app/models/RootStore.ts`, `app/models/index.ts`, `app/models/helpers/useStores.ts`, `app/app.tsx` (around the `await setupRootStore(_rootStore)` line, ~514)
- Test: `app/models/SupportStore.test.tsx`

**Interfaces:**
- Consumes: Task 1's logic; `getItemAsync` / `setItemAsync` / `deleteItemAsync` from `@/services/auth/secureStorage`.
- Produces:
  - `SUPPORT_CONTACTS_KEY = "support_contacts_v1"`
  - `loadSupportContacts(): Promise<SupportContact[]>` — `parseStoredContacts(await getItemAsync(KEY))`; a throw logs `warn` `{ step: "load", error: e.name }` and resolves `[]`
  - `saveSupportContacts(contacts: readonly SupportContact[]): Promise<boolean>` — `setItemAsync(KEY, serializeContacts(contacts))`; never throws
  - `clearSupportContacts(): Promise<void>` — `deleteItemAsync(KEY)`; never throws
  - `SupportStoreModel` with volatile `contacts: SupportContact[]`, `hydrated: boolean`; views `primary: SupportContact | null`, `canAdd: boolean`; actions `hydrate(): Promise<void>` (flow), `add(picked: PickedPhoneContact, role: SupportRole): AddResult["kind"]`, `remove(index: number): void`, `moveUp(index: number): void`, `setRole(index: number, role: SupportRole): void`; every mutation sets the new array and fires `saveSupportContacts` (not awaited)
  - `useSupportStore()` in `useStores.ts`; `supportStore: types.optional(SupportStoreModel, {})` on `RootStore`
  - `app/services/support/index.ts` re-exports logic, storage, picker (and later `dial.ts`, `deviceRegion.ts`)

- [ ] **Step 1: Write the failing store test**

```tsx
// app/models/SupportStore.test.tsx
// Jest, not vitest: the store imports @/ modules. The storage layer is mocked; what matters
// here is the store's contract: hydrate never throws, mutations persist, and NOTHING reaches a
// snapshot (spec D4).
import { getSnapshot } from "mobx-state-tree"

import { SupportStoreModel } from "./SupportStore"

jest.mock("@/services/support/supportContactsStorage", () => ({
  SUPPORT_CONTACTS_KEY: "support_contacts_v1",
  loadSupportContacts: jest.fn(),
  saveSupportContacts: jest.fn(async () => true),
  clearSupportContacts: jest.fn(async () => undefined),
}))

const storage = jest.requireMock<{
  loadSupportContacts: jest.Mock
  saveSupportContacts: jest.Mock
}>("@/services/support/supportContactsStorage")

const julie = { role: "sponsor" as const, name: "Julie J.", number: "+15550100001" }

describe("SupportStore (spec D4)", () => {
  beforeEach(() => jest.clearAllMocks())

  it("hydrates from storage and exposes the primary contact", async () => {
    storage.loadSupportContacts.mockResolvedValue([julie])
    const store = SupportStoreModel.create({})
    await store.hydrate()
    expect(store.hydrated).toBe(true)
    expect(store.primary).toEqual(julie)
  })

  it("hydrates to an empty list when storage rejects", async () => {
    storage.loadSupportContacts.mockRejectedValue(new Error("keychain locked"))
    const store = SupportStoreModel.create({})
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.contacts).toEqual([])
    expect(store.hydrated).toBe(true)
  })

  it("adds, persists and reports duplicates without persisting", () => {
    const store = SupportStoreModel.create({})
    expect(store.add({ name: "Julie J.", number: "+1 555 010 0001" }, "sponsor")).toBe("ok")
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.add({ name: "J", number: "15550100001" }, "friend")).toBe("duplicate")
    expect(storage.saveSupportContacts).toHaveBeenCalledTimes(1)
    expect(store.contacts).toHaveLength(1)
  })

  it("keeps every contact out of the snapshot", () => {
    const store = SupportStoreModel.create({})
    store.add(julie, "sponsor")
    expect(getSnapshot(store)).toEqual({})
    expect(JSON.stringify(getSnapshot(store))).not.toContain("555")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:component -- app/models/SupportStore.test.tsx`
Expected: FAIL, cannot find module `./SupportStore`.

- [ ] **Step 3: Write `supportContactsStorage.ts`, `SupportStore.ts`, the barrel, and wire the store** (`RootStore`, `models/index.ts`, `useSupportStore`). `hydrate` wraps `loadSupportContacts()` in try/catch so a storage throw still marks `hydrated` (storage already never throws; the store defends anyway). Header comments cite spec D4 and the "no props" rule.

- [ ] **Step 4: Run the store test**

Run: `npm run test:component -- app/models/SupportStore.test.tsx`
Expected: PASS, four tests.

- [ ] **Step 5: Hydrate at cold start, clearing on a fresh install** (`app/app.tsx`, replacing the bare `await setupRootStore(_rootStore)`):

```ts
const { restoredState } = await setupRootStore(_rootStore)
// ADDED 2026-11-xx (support contacts spec D4): the keychain outlives an uninstall on iOS, MMKV
// does not. No persisted root snapshot means a fresh install (or a Delete User Data reload),
// so a previous installer's sponsor must not greet whoever opens the app next. A rare MMKV read
// failure also lands here; clearing is the safe direction. Runs BEFORE hydrate.
if (!restoredState) await clearSupportContacts()
await _rootStore.supportStore.hydrate()
```
Import `clearSupportContacts` from `@/services/support`.

- [ ] **Step 6: Type check and run both runners**

Run: `npm run compile && npm test`
Expected: clean; all green (the new jest file included).

- [ ] **Step 7: Commit**

```bash
git add app/services/support/supportContactsStorage.ts app/services/support/index.ts app/models/SupportStore.ts app/models/SupportStore.test.tsx app/models/RootStore.ts app/models/index.ts app/models/helpers/useStores.ts app/app.tsx
git commit -m "✨ feat(support): keychain-backed SupportStore with volatile state only; fresh-install clear"
```

---

### Task 4: Words — the `support` namespace in nine locales

**Files:**
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts`, `app/i18n/ar.ts`, `app/i18n/de.ts`, `app/i18n/fr.ts`, `app/i18n/pt.ts`, `app/i18n/ru.ts`, `app/i18n/th.ts`, `app/i18n/uk.ts`
- Modify: `app/services/support/supportContactsLogic.ts` (tighten `SUPPORT_ROLE_TX` to `Record<SupportRole, TxKeyPath>`)
- Modify: `docs/translation-review-2026-08-03.md`

**Interfaces:**
- Produces the keys below, used by Tasks 5 to 9 exactly as named.

- [ ] **Step 1: Add the namespace to `en.ts`** (a new top-level block before the closing `}`; copy from spec "Copy"):

```ts
  // ADDED 2026-11-xx: support contacts (spec 2026-11-06-support-contacts-design.md).
  // Names are interpolated, numbers never are (spec D1).
  support: {
    cardTitle: "Support",
    emptyTitle: "Add your sponsor or support person",
    choose: "Choose",
    call: "Call",
    text: "Text",
    roleAndName: "{{role}} · {{name}}",
    screenTitle: "Support",
    addContact: "Add a support contact",
    findLiveMeeting: "Find a live meeting now",
    crisisLine: "988 Suicide & Crisis Lifeline",
    moveUp: "Move up",
    changeRole: "Change role",
    remove: "Remove",
    removeConfirmTitle: "Remove contact",
    removeConfirmMessage: "Remove {{name}} from your support contacts?",
    roleSheetTitle: "Who is this?",
    roleSponsor: "Sponsor",
    roleSupport: "Support person",
    roleFriend: "Friend",
    roleFamily: "Family",
    duplicate: "That contact is already in your list",
    couldntOpenPicker: "Couldn't open the contacts picker",
    couldntOpenPhone: "Couldn't open the phone app",
    callA11y: "Call {{name}}",
    textA11y: "Text {{name}}",
    moreA11y: "More options for {{name}}",
    openSupportA11y: "Open Support",
    crisisCallA11y: "Call 988",
    crisisTextA11y: "Text 988",
  },
```

- [ ] **Step 2: Run the type check to see it fail**

Run: `npm run compile`
Expected: eight errors, one per other locale file, "Property 'support' is missing".

- [ ] **Step 3: Add the same block, English text, to the other eight files** at the same position. Use plain `perl` without `-C` or Python for the non-Latin files (a `-CSD` perl double-encodes them). Then tighten `SUPPORT_ROLE_TX`'s type in `supportContactsLogic.ts` to `Record<SupportRole, TxKeyPath>` with `import type { TxKeyPath } from "@/i18n"`.

- [ ] **Step 4: Run the type check and the logic tests**

Run: `npm run compile && npm run test:unit -- app/services/support/supportContactsLogic.test.ts`
Expected: clean; PASS.

- [ ] **Step 5: Add the review-queue entry** to `docs/translation-review-2026-08-03.md`: a bullet under the "Still English placeholders" list, `support.*`, 29 keys, with the note that `{{name}}` and `{{role}}` placeholders must be kept and that the role words (Sponsor, Support person, Friend, Family) are the ones to get right first.

- [ ] **Step 6: Commit**

```bash
git add app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts app/services/support/supportContactsLogic.ts docs/translation-review-2026-08-03.md
git commit -m "🌐 i18n(support): the support namespace in nine locales"
```

---

### Task 5: Dialing, `OptionSheet`, and `SupportContactRow`

**Files:**
- Create: `app/services/support/dial.ts`, `app/services/support/deviceRegion.ts`, `app/components/OptionSheet.tsx`, `app/components/SupportContactRow.tsx`
- Modify: `app/services/support/index.ts` (export the two new files)
- Test: `app/services/support/dial.test.tsx`, `app/components/OptionSheet.test.tsx`, `app/components/SupportContactRow.test.tsx`

**Interfaces:**
- Consumes: `dialUrl`, `DialKind` (Task 1); keys from Task 4.
- Produces:
  - `openDial(kind: DialKind, number: string): Promise<boolean>` — `Linking.openURL(dialUrl(kind, number))`; `true` on success; a rejection logs `warn` `{ kind }` (never the URL or number) and returns `false`
  - `getDeviceRegion(): string | null` — `getLocales()[0]?.regionCode ?? null` from `expo-localization`
  - `OptionSheet` props: `{ visible: boolean; titleTx?: TxKeyPath; options: ReadonlyArray<{ key: string; tx: TxKeyPath; destructive?: boolean }>; onSelect: (key: string) => void; onClose: () => void }`. A transparent RN `Modal` (the `DaySelectorModal` pattern), options as `Pressable`s with `accessibilityRole="button"`, a Cancel row (`common:cancel`), backdrop tap → `onClose`. It exists because Android `Alert.alert` allows three buttons and the row overflow and the role sheet need four or more.
  - `SupportContactRow` props: `{ roleTx: TxKeyPath; name: string; onCall: () => void; onText: () => void; onMore: () => void; testID?: string }`. Renders `support:roleAndName` with `{ role: translate(roleTx), name }`, or the role alone when `name.trim()` is empty; `numberOfLines={1}`; Call / Text / More buttons with `accessibilityLabel`s from `support:callA11y` / `textA11y` / `moreA11y` (`{ name }`). The props type carries no number by design: write that in the header comment.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/services/support/dial.test.tsx
import { Linking } from "react-native"

import { openDial } from "./dial"

describe("openDial (spec D7)", () => {
  afterEach(() => jest.restoreAllMocks())

  it("opens a tel: link built from the normalized number and reports success", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
    await expect(openDial("call", "+1 (555) 010-0001")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith("tel:+15550100001")
  })

  it("returns false, without throwing, when the phone app cannot open", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("Unable to open URL"))
    await expect(openDial("text", "5550100002")).resolves.toBe(false)
  })
})
```

```tsx
// app/components/OptionSheet.test.tsx
import { fireEvent, render } from "@testing-library/react-native"

import { OptionSheet } from "./OptionSheet"

const options = [
  { key: "moveUp", tx: "support:moveUp" as const },
  { key: "remove", tx: "support:remove" as const, destructive: true },
]

describe("OptionSheet", () => {
  it("renders every option and reports the tapped key", () => {
    const onSelect = jest.fn()
    const { getByText } = render(
      <OptionSheet visible options={options} onSelect={onSelect} onClose={() => {}} />,
    )
    fireEvent.press(getByText(/support:remove/))
    expect(onSelect).toHaveBeenCalledWith("remove")
  })

  it("closes from the Cancel row", () => {
    const onClose = jest.fn()
    const { getByText } = render(
      <OptionSheet visible options={options} onSelect={() => {}} onClose={onClose} />,
    )
    fireEvent.press(getByText(/common:cancel/))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

```tsx
// app/components/SupportContactRow.test.tsx
import { fireEvent, render } from "@testing-library/react-native"

import { SupportContactRow } from "./SupportContactRow"

describe("SupportContactRow (spec D1: names only)", () => {
  it("shows role and name and wires the three actions with labelled buttons", () => {
    const onCall = jest.fn()
    const onText = jest.fn()
    const onMore = jest.fn()
    const { getByText, getByLabelText } = render(
      <SupportContactRow roleTx="support:roleSponsor" name="Julie J." onCall={onCall} onText={onText} onMore={onMore} />,
    )
    expect(getByText(/support:roleAndName/)).toBeTruthy()
    fireEvent.press(getByLabelText(/support:callA11y/))
    fireEvent.press(getByLabelText(/support:textA11y/))
    fireEvent.press(getByLabelText(/support:moreA11y/))
    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it("shows the role alone when the name is empty", () => {
    const { queryByText, getByText } = render(
      <SupportContactRow roleTx="support:roleSupport" name="  " onCall={() => {}} onText={() => {}} onMore={() => {}} />,
    )
    expect(queryByText(/support:roleAndName/)).toBeNull()
    expect(getByText(/support:roleSupport/)).toBeTruthy()
  })
})
```
(test/setup.ts's i18n mock renders a `tx` as `"<key> <json>"`, which is why the assertions match on the key.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:component -- app/services/support/dial.test.tsx app/components/OptionSheet.test.tsx app/components/SupportContactRow.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the four files** per the interfaces, then export `dial.ts` and `deviceRegion.ts` from the barrel. Theme through `useAppTheme()` / `themed()`; tint for Call, `card` for the row surface; 48 dp touch targets.

- [ ] **Step 4: Run the tests**

Run: `npm run test:component -- app/services/support/dial.test.tsx app/components/OptionSheet.test.tsx app/components/SupportContactRow.test.tsx`
Expected: PASS, six tests.

- [ ] **Step 5: Lint the touched files and commit**

```bash
npx eslint --fix app/services/support/dial.ts app/services/support/deviceRegion.ts app/components/OptionSheet.tsx app/components/SupportContactRow.tsx app/services/support/dial.test.tsx app/components/OptionSheet.test.tsx app/components/SupportContactRow.test.tsx
git add app/services/support/dial.ts app/services/support/deviceRegion.ts app/services/support/index.ts app/components/OptionSheet.tsx app/components/SupportContactRow.tsx app/services/support/dial.test.tsx app/components/OptionSheet.test.tsx app/components/SupportContactRow.test.tsx
git commit -m "✨ feat(support): dialing, the OptionSheet, and the names-only contact row"
```

---

### Task 6: The add flow hook, the Home `SupportCard`, and its container

**Files:**
- Create: `app/hooks/useAddSupportContact.ts`, `app/components/SupportCard.tsx`, `app/components/SupportCardContainer.tsx`
- Modify: `app/screens/HomeScreen.tsx` (render `<SupportCardContainer />` directly under the News card block, above `<CleanTimeCard />`; spec D8)
- Test: `app/hooks/useAddSupportContact.test.tsx`, `app/components/SupportCard.test.tsx`

**Interfaces:**
- Consumes: `useSupportStore` (Task 3), `pickPhoneContact` / `isPhoneContactPickerAvailable` / `PhoneContactPickerError` (Task 2), `openDial` (Task 5), `OptionSheet` (Task 5), `defaultRoleFor`, `SUPPORT_ROLES`, `SUPPORT_ROLE_TX` (Tasks 1/4), `useToast`, `trackEvent` from `@/services/tracking`.
- Produces:
  - `useAddSupportContact(): { choose: () => Promise<void>; roleSheet: { visible: boolean; options: Array<{ key: SupportRole; tx: TxKeyPath }>; onSelect: (key: string) => void; onClose: () => void } }`
    - `choose`: single-flight (a ref; a second call while one is pending returns at once); `pickPhoneContact()`; `null` → nothing; `PhoneContactPickerError` → toast `support:couldntOpenPicker` (error type); a pick → hold it in state and open the role sheet with `SUPPORT_ROLES` as options (the row for `defaultRoleFor(store.contacts)` first).
    - `onSelect(role)`: `store.add(picked, role)`; `"ok"` → `trackEvent("support_contact_added")`; `"duplicate"` → toast `support:duplicate`; `"full"` / `"invalid"` → toast `support:couldntOpenPicker`; then close and drop the held pick. `onClose` drops it.
  - `SupportCard` (presentational) props: `{ primary: { roleTx: TxKeyPath; name: string } | null; onChoose: () => void; onCall: () => void; onText: () => void; onOpenSupport: () => void }`. Title `support:cardTitle` as a `Pressable` (`accessibilityRole="button"`, label `support:openSupportA11y`) → `onOpenSupport`. Empty: `support:emptyTitle` + a `Button` `support:choose`. Set: `support:roleAndName` line (role alone when the name is empty) + `Button`s `support:call` / `support:text` with `callA11y` / `textA11y`.
  - `SupportCardContainer` (observer): returns `null` when `!isPhoneContactPickerAvailable()` (web, spec D2); otherwise maps `store.primary` to `{ roleTx: SUPPORT_ROLE_TX[role], name }`, `onCall` / `onText` → `openDial(kind, primary.number)` then `trackEvent("support_call" | "support_text")` on `true` and toast `support:couldntOpenPhone` on `false`; `onChoose` → hook's `choose`; `onOpenSupport` → `navigation.navigate("Support")`; renders `<OptionSheet titleTx="support:roleSheetTitle" {...roleSheet} />` beside the card.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/SupportCard.test.tsx
import { fireEvent, render } from "@testing-library/react-native"

import { SupportCard } from "./SupportCard"

const noop = () => {}

describe("SupportCard (spec D8, D1)", () => {
  it("offers Choose when there is no contact", () => {
    const onChoose = jest.fn()
    const { getByText } = render(
      <SupportCard primary={null} onChoose={onChoose} onCall={noop} onText={noop} onOpenSupport={noop} />,
    )
    expect(getByText(/support:emptyTitle/)).toBeTruthy()
    fireEvent.press(getByText(/support:choose/))
    expect(onChoose).toHaveBeenCalledTimes(1)
  })

  it("shows the primary by role and name with Call and Text, and opens Support from the title", () => {
    const onCall = jest.fn()
    const onText = jest.fn()
    const onOpenSupport = jest.fn()
    const { getByText, getByLabelText } = render(
      <SupportCard
        primary={{ roleTx: "support:roleSponsor", name: "Julie J." }}
        onChoose={noop}
        onCall={onCall}
        onText={onText}
        onOpenSupport={onOpenSupport}
      />,
    )
    expect(getByText(/support:roleAndName/)).toBeTruthy()
    fireEvent.press(getByLabelText(/support:callA11y/))
    fireEvent.press(getByLabelText(/support:textA11y/))
    fireEvent.press(getByLabelText(/support:openSupportA11y/))
    expect(onCall).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onOpenSupport).toHaveBeenCalledTimes(1)
  })
})
```

```tsx
// app/hooks/useAddSupportContact.test.tsx
import { act, renderHook } from "@testing-library/react-native"

import { useAddSupportContact } from "./useAddSupportContact"

const add = jest.fn()
jest.mock("@/models", () => ({ useSupportStore: () => ({ contacts: [], add }) }))
const showToast = jest.fn()
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast }) }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))

let resolvePick: (v: { name: string; number: string } | null) => void = () => {}
const pickPhoneContact = jest.fn(
  () => new Promise<{ name: string; number: string } | null>((resolve) => (resolvePick = resolve)),
)
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: () => pickPhoneContact(),
  PhoneContactPickerError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))

describe("useAddSupportContact", () => {
  beforeEach(() => jest.clearAllMocks())

  it("ignores a second Choose while a pick is in flight (Review Focus 5)", async () => {
    const { result } = renderHook(() => useAddSupportContact())
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.choose()
      void result.current.choose()
    })
    expect(pickPhoneContact).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePick(null)
      await first
    })
    expect(result.current.roleSheet.visible).toBe(false)
  })

  it("opens the role sheet after a pick and adds with the chosen role", async () => {
    add.mockReturnValue("ok")
    const { result } = renderHook(() => useAddSupportContact())
    let p: Promise<void> = Promise.resolve()
    act(() => {
      p = result.current.choose()
    })
    await act(async () => {
      resolvePick({ name: "Julie J.", number: "+15550100001" })
      await p
    })
    expect(result.current.roleSheet.visible).toBe(true)
    act(() => result.current.roleSheet.onSelect("sponsor"))
    expect(add).toHaveBeenCalledWith({ name: "Julie J.", number: "+15550100001" }, "sponsor")
    expect(result.current.roleSheet.visible).toBe(false)
  })

  it("toasts on a duplicate", async () => {
    add.mockReturnValue("duplicate")
    const { result } = renderHook(() => useAddSupportContact())
    let p: Promise<void> = Promise.resolve()
    act(() => {
      p = result.current.choose()
    })
    await act(async () => {
      resolvePick({ name: "J", number: "15550100001" })
      await p
    })
    act(() => result.current.roleSheet.onSelect("friend"))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tx: "support:duplicate" }))
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:component -- app/components/SupportCard.test.tsx app/hooks/useAddSupportContact.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the hook, the card and the container; place the container in `HomeScreen`.** The container is the only one of the three that imports the store, the picker or `openDial`. Add a CHANGED note to HomeScreen's header about the card's position (spec D8).

- [ ] **Step 4: Run the tests, then the type check**

Run: `npm run test:component -- app/components/SupportCard.test.tsx app/hooks/useAddSupportContact.test.tsx && npm run compile`
Expected: PASS, five tests; tsc clean.

- [ ] **Step 5: Lint the touched files and commit**

```bash
npx eslint --fix app/hooks/useAddSupportContact.ts app/components/SupportCard.tsx app/components/SupportCardContainer.tsx app/screens/HomeScreen.tsx app/hooks/useAddSupportContact.test.tsx app/components/SupportCard.test.tsx
git add app/hooks/useAddSupportContact.ts app/components/SupportCard.tsx app/components/SupportCardContainer.tsx app/screens/HomeScreen.tsx app/hooks/useAddSupportContact.test.tsx app/components/SupportCard.test.tsx
git commit -m "✨ feat(support): the Home Support card and the pick-then-role add flow"
```

---

### Task 7: The Support screen, its route, and My Day's crisis path

**Files:**
- Create: `app/screens/SupportScreen.tsx`
- Modify: `app/navigators/navigationTypes.ts` (`Support: undefined` in `AppStackParamList`), `app/navigators/AppNavigator.tsx` (register beside `Import`), `app/navigators/myDayNavigation.ts` (`openCrisisPath`)
- Test: `app/navigators/myDayNavigation.test.ts` (vitest), `app/screens/SupportScreen.test.tsx` (jest)

**Interfaces:**
- Consumes: Tasks 3, 5, 6 (`useSupportStore`, `SupportContactRow`, `OptionSheet`, `openDial`, `getDeviceRegion`, `useAddSupportContact`), `decideCrisisLine`, `SUPPORT_ROLE_TX`, `SUPPORT_ROLES`.
- Produces: route `Support` (app stack, `presentation: "modal"`, `headerShown: false`, registered only in the signed-in-and-onboarded fragment with `Import` / `Licenses` / `Terms`, spec D6); `createMyDayNavigation(nav).openCrisisPath()` now calls `nav.navigate("Support")`.

`SupportScreen` (observer), top to bottom: the LicensesScreen-style header (`support:screenTitle`, close button labelled `common:close`); one `SupportContactRow` per `store.contacts` (`roleTx: SUPPORT_ROLE_TX[role]`, `onCall` / `onText` → `openDial` + `trackEvent("support_call" | "support_text")` or toast `support:couldntOpenPhone`, `onMore` → row `OptionSheet` with `moveUp` / `changeRole` / `remove` (destructive)); an "Add" row (`support:addContact`, `accessibilityRole="button"`) while `store.canAdd && isPhoneContactPickerAvailable()` → hook's `choose`; the `support:findLiveMeeting` row → `navigation.navigate("Main", { screen: "Meetings", params: { segment: "live" } })` (navigating to a route already in the stack pops this modal); when `decideCrisisLine(getDeviceRegion())` is set, a `support:crisisLine` row with Call / Text (`crisisCallA11y` / `crisisTextA11y`) → `openDial(kind, "988")` + `trackEvent("support_crisis_call" | "support_crisis_text")`. `remove` → `Alert.alert(translate("support:removeConfirmTitle"), translate("support:removeConfirmMessage", { name }), [Cancel, Remove(destructive)])` → `store.remove(i)` + `trackEvent("support_contact_removed")`. `changeRole` → a second `OptionSheet` (`support:roleSheetTitle`) → `store.setRole(i, role)`. `moveUp` → `store.moveUp(i)`. The contacts section is hidden when the picker is unavailable (spec D2); the two rows below it still render.

- [ ] **Step 1: Write the failing tests**

```ts
// app/navigators/myDayNavigation.test.ts
import { describe, expect, it, vi } from "vitest"

import { createMyDayNavigation } from "./myDayNavigation"

describe("createMyDayNavigation", () => {
  it("opens the crisis path on the app's Support screen (support contacts spec D6)", () => {
    const navigate = vi.fn()
    const nav = createMyDayNavigation({ navigate, goBack: vi.fn() })
    nav.openCrisisPath()
    expect(navigate).toHaveBeenCalledWith("Support")
  })

  it("back pops the stack", () => {
    const goBack = vi.fn()
    createMyDayNavigation({ navigate: vi.fn(), goBack }).back()
    expect(goBack).toHaveBeenCalledTimes(1)
  })
})
```

```tsx
// app/screens/SupportScreen.test.tsx
import { fireEvent, render } from "@testing-library/react-native"

import { SupportScreen } from "./SupportScreen"

const navigate = jest.fn()
const goBack = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate, goBack }),
}))
const store = {
  contacts: [
    { role: "sponsor", name: "Julie J.", number: "+15550100001" },
    { role: "support", name: "Marco", number: "5550100002" },
  ],
  primary: { role: "sponsor", name: "Julie J.", number: "+15550100001" },
  canAdd: true,
  add: jest.fn(),
  remove: jest.fn(),
  moveUp: jest.fn(),
  setRole: jest.fn(),
}
jest.mock("@/models", () => ({ useSupportStore: () => store }))
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: jest.fn() }) }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: jest.fn(),
  PhoneContactPickerError: class extends Error {},
}))
let region: string | null = "US"
jest.mock("@/services/support/deviceRegion", () => ({ getDeviceRegion: () => region }))

describe("SupportScreen", () => {
  beforeEach(() => jest.clearAllMocks())

  it("lists contacts by name and never renders a number (spec D1)", () => {
    const { toJSON, getAllByText } = render(<SupportScreen />)
    expect(getAllByText(/support:roleAndName/)).toHaveLength(2)
    const tree = JSON.stringify(toJSON())
    expect(tree).not.toContain("555")
    expect(tree).not.toContain("0100001")
  })

  it("shows the 988 row for the US and hides it elsewhere (spec D5)", () => {
    region = "US"
    expect(render(<SupportScreen />).queryByText(/support:crisisLine/)).toBeTruthy()
    region = "GB"
    expect(render(<SupportScreen />).queryByText(/support:crisisLine/)).toBeNull()
    region = "US"
  })

  it("Find a live meeting goes to the Meetings tab's Online segment", () => {
    const { getByText } = render(<SupportScreen />)
    fireEvent.press(getByText(/support:findLiveMeeting/))
    expect(navigate).toHaveBeenCalledWith("Main", { screen: "Meetings", params: { segment: "live" } })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit -- app/navigators/myDayNavigation.test.ts && npm run test:component -- app/screens/SupportScreen.test.tsx`
Expected: vitest FAIL (`navigate` called with `"Meetings"`); jest FAIL (module not found).

- [ ] **Step 3: Implement.** In `myDayNavigation.ts` keep the existing D3 comment and append `CHANGED 2026-11-xx (support contacts spec D6): the crisis path is the app's Support screen, which offers Find a live meeting now itself; the route is not in the My Day stack, so the navigate bubbles up through the tab navigator to the app stack.` Register the route with an `ADDED` comment on both the param list and the screen.

- [ ] **Step 4: Run the tests and the type check**

Run: `npm run test:unit -- app/navigators/myDayNavigation.test.ts && npm run test:component -- app/screens/SupportScreen.test.tsx && npm run compile`
Expected: PASS, five tests; tsc clean.

- [ ] **Step 5: Lint the touched files and commit**

```bash
npx eslint --fix app/screens/SupportScreen.tsx app/navigators/navigationTypes.ts app/navigators/AppNavigator.tsx app/navigators/myDayNavigation.ts app/navigators/myDayNavigation.test.ts app/screens/SupportScreen.test.tsx
git add app/screens/SupportScreen.tsx app/navigators/navigationTypes.ts app/navigators/AppNavigator.tsx app/navigators/myDayNavigation.ts app/navigators/myDayNavigation.test.ts app/screens/SupportScreen.test.tsx
git commit -m "✨ feat(support): the Support screen; My Day's crisis path opens it"
```

---

### Task 8: The three resets

**Files:**
- Modify: `app/screens/SettingsScreen.tsx` (Delete User Data), `app/utils/devPurge.ts`, `app/db/DatabaseProvider.tsx`, `app/app.tsx`

**Interfaces:**
- Consumes: `clearSupportContacts` (Task 3).
- Produces: `DatabaseProvider` prop `resetSupportContacts?: () => Promise<void>`.

- [ ] **Step 1: Settings → Delete User Data.** After step 6 (`await clearAllSecureData()`), add step 6b: `await clearSupportContacts()` with a comment citing spec D4 (it never throws, so it may sit inside the try). Import from `@/services/support`.

- [ ] **Step 2: `devPurge.ts`.** Add `clearSupportContacts()` to the `secure-store` step's `Promise.all`; update the header comment's list of what SecureStore holds.

- [ ] **Step 3: `DatabaseProvider.tsx`.** Add the `resetSupportContacts` prop beside `resetDailyDash` with the same shape of comment (injected so `app/db/` imports nothing of `app/services/support`), and call `await resetSupportContacts?.()` inside `resetLocalData` right after `await resetDailyDash?.()`. In `app.tsx` pass `resetSupportContacts={clearSupportContacts}`.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run lint:deps && npm test`
Expected: clean; depcruise reports no new cycle; all green.

- [ ] **Step 5: Lint the touched files and commit**

```bash
npx eslint --fix app/screens/SettingsScreen.tsx app/utils/devPurge.ts app/db/DatabaseProvider.tsx app/app.tsx
git add app/screens/SettingsScreen.tsx app/utils/devPurge.ts app/db/DatabaseProvider.tsx app/app.tsx
git commit -m "🧹 feat(support): Delete User Data, the overlay Reset and the dev purge clear support contacts"
```

---

### Task 9: Docs — manual page, map, questions, changelog, spec amendments, CLAUDE.md

**Files:**
- Create: `docs/manual/home/support.md`
- Modify: `docs/manual/map.md`, `docs/manual/questions.yml`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-25-my-day-tab-design.md` (D3, ~line 78), `docs/superpowers/specs/2026-11-06-support-contacts-design.md` (Status), `CLAUDE.md`

- [ ] **Step 1: The manual page** (`docs/manual/README.md` rules; labels verbatim from `en.ts`; every H2 under 400 words):

Front-matter: `title: Support`, `area: home`, `screen: Home → "Support"`, `platforms: [ios, android]`, `aliases: [sponsor, "call my sponsor", "support person", "988", "crisis line", "support contacts"]`. Sources: `app/components/SupportCard.tsx, app/screens/SupportScreen.tsx, app/i18n/en.ts, app/screens/SettingsScreen.tsx, docs/superpowers/specs/2026-11-06-support-contacts-design.md`. Intro: what the card is and that it is free. H2s: "How to add your sponsor or support person" (Choose → the phone's contact picker → tap the number → "Who is this?" → Sponsor / Support person / Friend / Family), "Calling or texting" ("Call" and "Text"; the phone's own confirmation; up to three contacts on the Support screen; "Find a live meeting now"; the "988 Suicide & Crisis Lifeline" row in the US and Canada), "Good to know" (names only are shown; the number stays on this phone, never sent anywhere, not in the cloud backup, gone with "Delete User Data" and when the app is reinstalled; the app never reads your contact list; on the web the card does not appear), "If something's wrong" (the picker will not open → the phone's contacts app; "That contact is already in your list"; "Couldn't open the phone app" on a tablet; then the hand-off sentence), "Questions people ask" (three Q/A in the user's words).

- [ ] **Step 2: `map.md`**: extend the Home sentence to name the "Support" card ("call or text your sponsor or support person, up to three contacts, and the 988 line in the US and Canada") and add `app/components/SupportCard.tsx, app/screens/SupportScreen.tsx` to its sources comment. Keep the map under 600 words, no `## ` lines.

- [ ] **Step 3: `questions.yml`**: at least three entries → `home/support`: "how do I call my sponsor from the app", "is my sponsor's phone number private", "where is the crisis line".

- [ ] **Step 4: Validate the manual**

Run: `pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run`
Expected: exit 0 and no problem listed for `home/support`. (Exit 2 lists the rule broken; fix and re-run.)

- [ ] **Step 5: `CHANGELOG.md` under `[Unreleased]`**:
  - `Added`: the Home Support card and Support screen (up to three support contacts picked from the phone's contacts, Call and Text, names only; the 988 row in the US and Canada; My Day's crisis card now opens it). No tracker issue.
  - `Changed`: My Day's crisis path opens the Support screen instead of Meetings → Online.
  - `Removed`: the unused iOS contacts usage string.
  - `Build`: the local `phone-contact-picker` module, a native change: the next release is a native release (`runtimeVersion` bump at release time).
  - `Docs`: `(manual)` the new `home/support` page, map and questions.

- [ ] **Step 6: Spec amendments.** In the My Day spec's D3 paragraph append `CHANGED 2026-11-xx (support contacts spec D6): openCrisisPath() now opens the app's Support screen, which offers "Find a live meeting now" itself.` In the support contacts spec change the Status line to `implemented on feat/support-contacts (plan docs/superpowers/plans/2026-11-06-support-contacts.md); device pass pending`.

- [ ] **Step 7: `CLAUDE.md`**: a new subsection under "Smaller Subsystems", "**Support contacts** (`app/services/support/`, `modules/phone-contact-picker/`)", five to eight lines: the spec path; names only and the presentational-props rule; `support_contacts_v1` in SecureStore, no props on `SupportStore`, the four clears (Delete User Data 6b, overlay Reset via the injected prop, dev purge, fresh install in `app.tsx`); the module's error codes and why not expo-contacts; the policy test; `openCrisisPath` → `Support`. Also add `Support` to the "Modals (app-stack level)" line under Navigation.

- [ ] **Step 8: Commit**

```bash
git add docs/manual/home/support.md docs/manual/map.md docs/manual/questions.yml CHANGELOG.md docs/superpowers/specs/2026-10-25-my-day-tab-design.md docs/superpowers/specs/2026-11-06-support-contacts-design.md CLAUDE.md
git commit -m "📝 docs(support): manual page, map and questions; changelog; spec and CLAUDE.md notes"
```

---

### Task 10: Device pass on a dev build (iPhone and Android), then hand-off

**Files:** none; results go in "Execution notes" below. Needs a real iPhone and a real Android phone, so it is Jenova's or a session with the devices.

- [ ] **Step 1: Build and install** a development build with the module: `npm run prebuild:clean`, then `npm run build:ios:device` and `npm run build:android:device:debug`; start Metro with `npm run dev-log` (never `CI=1`).
- [ ] **Step 2: Checklist**, each on both phones unless noted:
  1. Home shows the Support card under News with "Add your sponsor or support person" and "Choose". **No permission prompt appears at any point.**
  2. Choose → the phone's picker → a contact with two numbers → the second number → "Who is this?" → Sponsor. The card reads "Sponsor · <name>"; no number anywhere on screen.
  3. Cancel the picker → nothing changes; no toast.
  4. Tap "Call" → iOS asks to confirm the number, Android opens the dialer filled in. Tap "Text" → the messages app opens.
  5. Tap "Support" → the screen lists the contact; add two more; the Add row disappears; the same contact again → "That contact is already in your list".
  6. Row "More" → Move up / Change role / Remove; Remove asks "Remove <name> from your support contacts?".
  7. "Find a live meeting now" → the Meetings tab's Online segment, modal gone.
  8. With the phone region set to US (Settings → General → Language & Region / Android System → Languages): the "988 Suicide & Crisis Lifeline" row shows; set to United Kingdom: it does not.
  9. My Day (Premium account) → Check in → the Support button → the Support screen opens.
  10. Kill and relaunch → contacts still there. Sign out and back in → still there.
  11. Settings → Delete User Data → relaunch → card is empty.
  12. iOS only: add a contact, delete the app, reinstall from the same build → card is empty (fresh-install clear).
  13. Web (`npm run web`): Home shows no Support card.
  14. Loki for the session (`docs/DIAGNOSTICS.md`): lines under `module: "Support"` carry codes only; grep the session's lines for the picked number's digits and the name → nothing.
- [ ] **Step 3: Record** pass/fail per line in "Execution notes" with the build ids. Any failure goes back to the owning task as a fix, test first.
- [ ] **Step 4: Hand off** with superpowers:finishing-a-development-branch (merge to `root` is Jenova's; the native release is the house procedure in CLAUDE.md "Native release").

---

## Execution notes

(Rulings and device-pass results are appended here during execution.)

#### Added 2026-11-06 from the final review (Fable): also check these

Pick and dial:
- Fast double tap on "Choose", both platforms: one picker, no toast. After a cancel, "Choose" works again on the same screen.
- iOS: open the picker, swipe it down, tap "Choose" again on the same screen. The picker opens.
- iOS: tap "Choose" while the role sheet is still closing. Tap "Choose", background the app before picking, return and pick.
- Android, developer option "Don't keep activities": a pick still returns. If it never does, "Choose" is silently dead, and that needs a stale check like the iOS one.
- Save a contact as `555-010-0001,,23`. "Call" shows the pause in the dialer on both platforms. "Text" opens Messages with `5550100001` only.
- Save one as `555-010-0001;23` and record what iOS Phone does (unverified). Save `*67 555 010 0001`: it dials with the `*`. Save one ending `#`: Android dials it, iOS refuses it (expected).
- Pick a contact saved as `1-800-FLOWERS`. Nothing is added and a toast appears (the picker's words for now).
- Device region GB: no 988 row. US: the row shows, and `sms:988` opens Messages with 988 filled in.

Errors and navigation:
- iOS, on the Support screen: add a contact already in the list. "That contact is already in your list" is visible over the screen. On an iPad or simulator, tap the text button: "Couldn't open the phone app" is visible.
- iOS edge-swipe and Android back from Support return to where it was opened: Home from Home, My Day from My Day's crisis card.
- From Support, opened from Home and then from My Day, tap "Find a live meeting now". It lands on Meetings, "Online", with Support gone. A further back press does not reveal a second Home or Meetings.
- Switch to In-Person, then My Day, crisis card, Support, "Find a live meeting now". Record whether it lands on "Online" or stays on In-Person (known follow-up).
- Sign out while Support is open: lands on Login with no crash. Sign back in: contacts intact.

Storage:
- Cold start with contacts saved: the card is there on first paint, with no empty state and no hidden-then-shown flash.
- iOS: delete the app and reinstall. The card shows its empty state and an add works on the first launch.
- Delete User Data, then relaunch: empty.
- Database overlay, "Reset local data": the card returns to empty without a reload, and the next add saves only the new contact.
- Android: a contact with no name shows the role alone, and VoiceOver or TalkBack never speaks the number on the card, the screen, the sheets or the remove alert.
- Large accessibility text and landscape: the role sheet's Cancel is reachable.
- After a full add, call, text, move, change-role and remove run, search Loki for the test number's digits and the test name: nothing. Umami shows only the fixed event names, with no payload.

At release:
- The EAS cloud build log lists the `PhoneContactPicker` pod and the `:phone-contact-picker` Gradle project. Android autolinking has not been verified from a clean build.
- Watch the first TestFlight upload for an ITMS-90683 notice.
