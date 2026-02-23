/**
 * Toast Component
 *
 * Auto-hiding notification that slides in from the top.
 * Use with ToastProvider and useToast hook.
 */
import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Animated, Pressable, StyleSheet, ViewStyle, TextStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"

import { Text } from "./Text"

// Color constants for toast styles
const SHADOW_COLOR = "#000"
const TEXT_COLOR_WHITE = "#FFFFFF"

/** Toast configuration */
interface ToastConfig {
  /** Text message to display */
  message?: string
  /** Translation key (alternative to message) */
  tx?: TxKeyPath
  /** Duration in ms before auto-hide (default: 3000) */
  duration?: number
  /** Toast type for styling */
  type?: "success" | "info" | "error"
  /** Callback when toast is tapped */
  onPress?: () => void
}

interface ToastContextValue {
  showToast: (config: ToastConfig) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * Hook to show toast notifications
 */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
}

/**
 * Provider component that enables toast notifications
 */
export const ToastProvider: FC<ToastProviderProps> = ({ children }) => {
  const { theme } = useAppTheme()
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState<ToastConfig | null>(null)
  const translateY = useRef(new Animated.Value(-100)).current
  const opacity = useRef(new Animated.Value(0)).current
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null)
    })
  }, [translateY, opacity])

  const showToast = useCallback(
    (config: ToastConfig) => {
      // Clear any existing hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }

      setToast(config)

      // Animate in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()

      // Auto-hide after duration
      const duration = config.duration ?? 3000
      hideTimeoutRef.current = setTimeout(hideToast, duration)
    },
    [translateY, opacity, hideToast],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  // Get background color based on type
  const getBackgroundColor = () => {
    switch (toast?.type) {
      case "success":
        return theme.colors.tint
      case "error":
        return "#E53935"
      case "info":
      default:
        return theme.colors.card
    }
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.container,
            {
              top: insets.top + 8,
              backgroundColor: getBackgroundColor(),
              transform: [{ translateY }],
              opacity,
            },
          ]}
        >
          {toast.onPress ? (
            <Pressable
              onPress={() => {
                toast.onPress?.()
                hideToast()
              }}
              style={styles.pressable}
            >
              <Text
                style={[styles.text, toast.type === "info" ? { color: theme.colors.text } : null]}
                text={toast.message}
                tx={toast.tx}
              />
            </Pressable>
          ) : (
            <Text
              style={[styles.text, toast.type === "info" ? { color: theme.colors.text } : null]}
              text={toast.message}
              tx={toast.tx}
            />
          )}
        </Animated.View>
      )}
    </ToastContext.Provider>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 9999,
  } as ViewStyle,
  pressable: {
    flex: 1,
    alignItems: "center",
  } as ViewStyle,
  text: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_COLOR_WHITE,
    textAlign: "center",
  } as TextStyle,
})
