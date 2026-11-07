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
    // Every mutation replaces the array (volatile, so MobX sees the new
    // reference) and persists it without awaiting: storage never throws, and a
    // slow keychain must not stall a tap.
    const commit = (next: SupportContact[]) => {
      self.contacts = next
      void saveSupportContacts(next)
    }

    return {
      /** Never rejects: a storage failure still marks the store hydrated. */
      hydrate: flow(function* () {
        try {
          self.contacts = yield loadSupportContacts()
        } catch {
          // Storage already never throws; defended anyway (no error logged,
          // the error text could echo stored data).
          self.contacts = []
        }
        self.hydrated = true
      }),

      /**
       * ADDED 2026-11-06 (Task 8, spec D4): empties the list and the keychain. The
       * list goes first and synchronously, so nothing can read or re-save the old
       * contacts while the keychain call is pending. Used by the database overlay's
       * Reset, which reopens the database in place with no app reload: a
       * keychain-only clear would leave the previous owner's sponsor on Home and
       * the next edit would write them back. Never rejects. `hydrated` is left
       * alone: the store did hydrate, it is simply empty now.
       */
      clear: flow(function* () {
        self.contacts = []
        try {
          yield clearSupportContacts()
        } catch {
          // Storage already never throws; defended anyway (no error logged).
        }
      }),

      add(picked: PickedPhoneContact, role: SupportRole): AddResult["kind"] {
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
