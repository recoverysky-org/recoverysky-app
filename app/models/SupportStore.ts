/**
 * SupportStore: the person's support contacts (sponsor, friends, family).
 * ADDED 2026-11-06 (support contacts spec D1, D4).
 *
 * NO PROPS, on purpose. Every field is volatile, so `getSnapshot(store)` is
 * `{}` and nothing here can reach the MMKV root snapshot. The contacts live in
 * the keychain alone (supportContactsStorage.ts) and are read back by
 * `hydrate()` at cold start. Do not add a prop to "cache" them: MMKV survives
 * differently from the keychain and the snapshot is persisted wholesale.
 *
 * Imports the logic and storage modules directly, not the `@/services/support`
 * barrel, so this store does not pull the native contact picker into its graph.
 * The logic functions `moveUp` / `setRole` share names with this store's actions,
 * hence the aliases.
 *
 * CHANGED 2026-11-06 (final review I-3): `hydrated` now means "we know what the
 * keychain holds". While it is false the list is UNKNOWN, not empty: edits are
 * refused and the UI hides the contacts, so nothing built on an unknown list can
 * overwrite the real one. `createSupportLoader` retries on foreground.
 */
import { flow, Instance, SnapshotIn, SnapshotOut, types } from "mobx-state-tree"

import {
  addContact,
  canAddContact,
  moveUp as moveContactUp,
  removeContact,
  setRole as setContactRole,
  type AddResult,
  type PickedPhoneContact,
  type SupportContact,
  type SupportRole,
} from "@/services/support/supportContactsLogic"
import {
  clearSupportContacts,
  loadSupportContacts,
  saveSupportContacts,
} from "@/services/support/supportContactsStorage"

export const SupportStoreModel = types
  .model("SupportStore")
  .volatile(() => ({
    contacts: [] as SupportContact[],
    hydrated: false,
  }))
  .views((self) => ({
    /** The first contact, the one a one-tap "call my person" goes to. */
    get primary(): SupportContact | null {
      return self.contacts[0] ?? null
    },
    get canAdd(): boolean {
      return canAddContact(self.contacts)
    },
  }))
  .actions((self) => {
    // ADDED 2026-11-06 (final review I-3, M-7): every keychain call runs on this one chain, in
    // order, so two quick edits cannot land out of order and a save started before clear() cannot
    // land after its delete. A failure never breaks the chain for the next call.
    let keychainChain: Promise<unknown> = Promise.resolve()
    const onKeychainChain = <T>(call: () => Promise<T>): Promise<T> => {
      const result = keychainChain.then(call)
      keychainChain = result.catch(() => undefined)
      return result
    }

    // One read at a time (init and the foreground retry can both ask).
    let hydrating = false
    // Bumped by clear(), so a read that began before it cannot bring the old list back.
    let clearCount = 0

    // Every mutation replaces the array (volatile, so MobX sees the new
    // reference) and persists it without awaiting: storage never throws, and a
    // slow keychain must not stall a tap.
    // CHANGED 2026-11-06 (final review I-3): refuses while un-hydrated, with no state change and no
    // save. A list built on an unknown one would overwrite the real contacts for good.
    const commit = (next: SupportContact[]) => {
      if (!self.hydrated) return
      self.contacts = next
      void onKeychainChain(() => saveSupportContacts(next))
    }

    return {
      /** Never rejects. */
      // CHANGED 2026-11-06 (final review I-3): a storage failure used to mark the store hydrated
      // and empty. Now a failed read leaves `hydrated` false and the list untouched, and a later
      // call retries. A call while one runs, or once hydrated, starts nothing. The read goes on the
      // chain so it sees any clear ahead of it.
      hydrate: flow(function* () {
        if (hydrating || self.hydrated) return
        hydrating = true
        const clearCountAtStart = clearCount
        try {
          const loaded: SupportContact[] | null = yield onKeychainChain(loadSupportContacts)
          if (loaded !== null && clearCountAtStart === clearCount) {
            self.contacts = loaded
            self.hydrated = true
          }
        } catch {
          // Storage already never throws; defended anyway (no error logged,
          // the error text could echo stored data).
        } finally {
          hydrating = false
        }
      }),

      /**
       * ADDED 2026-11-06 (Task 8, spec D4): empties the list and the keychain. The
       * list goes first and synchronously, so nothing can read or re-save the old
       * contacts while the keychain call is pending. Used by the database overlay's
       * Reset, which reopens the database in place with no app reload: a
       * keychain-only clear would leave the previous owner's sponsor on Home and
       * the next edit would write them back. Never rejects. `hydrated` is left
       * alone: the store did hydrate, it is simply empty now.
       * CHANGED 2026-11-06 (final review I-3): the delete runs on the save chain, and a confirmed
       * delete sets `hydrated`, because an un-hydrated store now knows the answer: empty. A failed
       * delete leaves `hydrated` as it was, so an unread list stays unknown.
       */
      clear: flow(function* () {
        clearCount += 1
        self.contacts = []
        try {
          const deleted: boolean = yield onKeychainChain(clearSupportContacts)
          if (deleted) self.hydrated = true
        } catch {
          // Storage already never throws; defended anyway (no error logged).
        }
      }),

      // CHANGED 2026-11-06 (final review I-3): "invalid" while un-hydrated. The duplicate and full
      // checks would be judged against a list we have not read, and commit would refuse anyway.
      add(picked: PickedPhoneContact, role: SupportRole): AddResult["kind"] {
        if (!self.hydrated) return "invalid"
        const result = addContact(self.contacts, picked, role)
        if (result.kind === "ok") commit(result.contacts)
        return result.kind
      },

      remove(index: number) {
        commit(removeContact(self.contacts, index))
      },

      moveUp(index: number) {
        commit(moveContactUp(self.contacts, index))
      },

      setRole(index: number, role: SupportRole) {
        commit(setContactRole(self.contacts, index, role))
      },
    }
  })

export interface SupportStore extends Instance<typeof SupportStoreModel> {}
export interface SupportStoreSnapshotOut extends SnapshotOut<typeof SupportStoreModel> {}
export interface SupportStoreSnapshotIn extends SnapshotIn<typeof SupportStoreModel> {}
