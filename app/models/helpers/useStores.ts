import { createContext, useContext } from "react"
import { RootStore } from "../RootStore"

/**
 * Create a context for the RootStore
 */
const RootStoreContext = createContext<RootStore | undefined>(undefined)

/**
 * The provider component to wrap your app with to provide the RootStore
 */
export const RootStoreProvider = RootStoreContext.Provider

/**
 * A hook that returns the RootStore from the context
 */
export function useStores(): RootStore {
  const store = useContext(RootStoreContext)
  if (store === undefined) {
    throw new Error("useStores must be used within a RootStoreProvider")
  }
  return store
}

/**
 * Shortcut hooks for accessing individual stores
 */
export function useAuthenticationStore() {
  return useStores().authenticationStore
}

export function useProfileStore() {
  return useStores().profileStore
}

export function useNetworkStore() {
  return useStores().networkStore
}
