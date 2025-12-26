import { Instance, SnapshotOut, types } from "mobx-state-tree"

/**
 * Network connection types
 */
const ConnectionTypeEnum = types.enumeration("ConnectionType", [
  "wifi",
  "cellular",
  "ethernet",
  "unknown",
  "none",
])

export const NetworkStoreModel = types
  .model("NetworkStore")
  .props({
    isConnected: true,
    connectionType: types.optional(ConnectionTypeEnum, "unknown"),
    isInternetReachable: types.maybeNull(types.boolean),
  })
  .volatile(() => ({
    // Volatile state is not persisted
    lastChecked: new Date(),
  }))
  .views((self) => ({
    /**
     * Returns true if the device is offline
     */
    get isOffline(): boolean {
      return !self.isConnected
    },

    /**
     * Returns true if we have confirmed internet access
     */
    get hasInternet(): boolean {
      return self.isConnected && self.isInternetReachable === true
    },

    /**
     * Returns true if on WiFi
     */
    get isWifi(): boolean {
      return self.connectionType === "wifi"
    },

    /**
     * Returns true if on cellular data
     */
    get isCellular(): boolean {
      return self.connectionType === "cellular"
    },
  }))
  .actions((self) => ({
    /**
     * Update network status (called from NetInfo listener)
     */
    setNetworkStatus(
      isConnected: boolean,
      connectionType: "wifi" | "cellular" | "ethernet" | "unknown" | "none",
      isInternetReachable: boolean | null
    ) {
      self.isConnected = isConnected
      self.connectionType = connectionType
      self.isInternetReachable = isInternetReachable
      self.lastChecked = new Date()
    },

    /**
     * Mark as offline
     */
    setOffline() {
      self.isConnected = false
      self.connectionType = "none"
      self.isInternetReachable = false
      self.lastChecked = new Date()
    },

    /**
     * Mark as online (with unknown connection type)
     */
    setOnline() {
      self.isConnected = true
      self.connectionType = "unknown"
      self.isInternetReachable = true
      self.lastChecked = new Date()
    },
  }))

export interface NetworkStore extends Instance<typeof NetworkStoreModel> {}
export interface NetworkStoreSnapshot extends SnapshotOut<typeof NetworkStoreModel> {}
