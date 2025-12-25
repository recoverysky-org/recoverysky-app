import { createContext, FC, PropsWithChildren, useCallback, useContext, useEffect, useMemo } from "react"
import { useMMKVString } from "react-native-mmkv"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "AuthContext" })

export type AuthContextType = {
  isAuthenticated: boolean
  authToken?: string
  authEmail?: string
  setAuthToken: (token?: string) => void
  setAuthEmail: (email: string) => void
  logout: () => void
  validationError: string
}

export const AuthContext = createContext<AuthContextType | null>(null)

export interface AuthProviderProps {}

export const AuthProvider: FC<PropsWithChildren<AuthProviderProps>> = ({ children }) => {
  log.debug("AuthProvider initializing")

  const [authToken, setAuthToken] = useMMKVString("AuthProvider.authToken")
  const [authEmail, setAuthEmail] = useMMKVString("AuthProvider.authEmail")

  useEffect(() => {
    log.info("AuthProvider mounted", {
      hasToken: !!authToken,
      hasEmail: !!authEmail,
      isAuthenticated: true, // Always true for now
    })
    return () => {
      log.debug("AuthProvider unmounting")
    }
  }, [])

  const logout = useCallback(() => {
    log.info("Logout called")
    setAuthToken(undefined)
    setAuthEmail("")
  }, [setAuthEmail, setAuthToken])

  const validationError = useMemo(() => {
    if (!authEmail || authEmail.length === 0) return "can't be blank"
    if (authEmail.length < 6) return "must be at least 6 characters"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) return "must be a valid email address"
    return ""
  }, [authEmail])

  const value = {
    isAuthenticated: true, // TODO: Re-enable auth when backend is ready - was: !!authToken
    authToken,
    authEmail,
    setAuthToken,
    setAuthEmail,
    logout,
    validationError,
  }

  log.debug("AuthProvider rendering children")
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
