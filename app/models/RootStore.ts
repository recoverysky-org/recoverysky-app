import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { AuthenticationStoreModel } from "./AuthenticationStore"
import { ConfigStoreModel } from "./ConfigStore"
import { ConversationStoreModel } from "./ConversationStore"
import { NetworkStoreModel } from "./NetworkStore"
import { ProfileStoreModel } from "./ProfileStore"

/**
 * A RootStore model.
 */
export const RootStoreModel = types.model("RootStore").props({
  authenticationStore: types.optional(AuthenticationStoreModel, {}),
  configStore: types.optional(ConfigStoreModel, {}),
  conversationStore: types.optional(ConversationStoreModel, {}),
  profileStore: types.optional(ProfileStoreModel, {}),
  networkStore: types.optional(NetworkStoreModel, {}),
})

/**
 * The RootStore instance.
 */
export interface RootStore extends Instance<typeof RootStoreModel> {}

/**
 * The data of a RootStore.
 */
export interface RootStoreSnapshot extends SnapshotOut<typeof RootStoreModel> {}
