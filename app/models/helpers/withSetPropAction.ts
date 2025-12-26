import { IStateTreeNode, SnapshotIn } from "mobx-state-tree"

/**
 * Adds a `setProp` action to the model that allows setting any property.
 * Useful for simple property updates without writing individual actions.
 *
 * @example
 * const MyModel = types.model("MyModel", {
 *   name: types.string,
 * }).actions(withSetPropAction)
 *
 * // Usage:
 * myModel.setProp("name", "John")
 */
export const withSetPropAction = <T extends IStateTreeNode>(mstInstance: T) => ({
  setProp<K extends keyof SnapshotIn<T>, V extends SnapshotIn<T>[K]>(field: K, newValue: V) {
    // @ts-expect-error - MST type complexity
    mstInstance[field] = newValue
  },
})
