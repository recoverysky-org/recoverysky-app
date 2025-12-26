import { getRoot, IStateTreeNode } from "mobx-state-tree"
import { RootStore, RootStoreModel } from "../RootStore"

/**
 * Returns a RootStore object from any MST node.
 * Useful when you need to access the root store from a nested model.
 */
export const getRootStore = (self: IStateTreeNode): RootStore => {
  return getRoot<typeof RootStoreModel>(self)
}
