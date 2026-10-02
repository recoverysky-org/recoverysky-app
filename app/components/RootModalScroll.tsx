/**
 * RootModalScroll
 *
 * A safe-area, keyboard-aware, scrolling frame for content rendered OUTSIDE a
 * navigator. Today that is one thing: the body of VerifyEmailGate's <Modal>,
 * which app.tsx mounts beside <AppNavigator />, not inside a screen.
 *
 * ADDED 2026-10-01. Why not <Screen preset="scroll">: that preset calls React
 * Navigation's useScrollToTop(), which throws "Couldn't find a route object.
 * Is your component inside a screen in a navigator?" when no screen is above
 * it. VerifyEmailGate used Screen for one afternoon (final review I3, to get
 * scrolling and keyboard avoidance) and crashed on its first real showing —
 * jest had never mounted the gate, so nothing caught it before the device pass.
 *
 * This is Screen's scroll preset minus the navigation hook: the same safe-area
 * padding, the same KeyboardAvoidingView + KeyboardAwareScrollView pair, the
 * same bottom offset, so the verify screen moves with the keyboard exactly as
 * LoginScreen does. Left out on purpose: useScrollToTop (no tab to press),
 * SystemBars (the screen underneath already set them for this theme) and the
 * "auto" preset's measuring.
 *
 * Do NOT "simplify" this back to <Screen>, and do not add any hook from
 * @react-navigation here. RootModalScroll.test.tsx mounts it with no navigator
 * to keep that true.
 */
import { ReactNode } from "react"
import { KeyboardAvoidingView, Platform, StyleProp, View, ViewStyle } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"

import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import { useSafeAreaInsetsStyle } from "@/utils/useSafeAreaInsetsStyle"

import { DEFAULT_BOTTOM_OFFSET } from "./Screen"

export interface RootModalScrollProps {
  children?: ReactNode
  /** Style for the scroll view's content container (padding, flexGrow). */
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function RootModalScroll({ children, contentContainerStyle }: RootModalScrollProps) {
  const {
    theme: { colors },
  } = useAppTheme()
  // The root SafeAreaProvider's insets. A full-screen Modal covers the same
  // window, so they are the right ones.
  const $insets = useSafeAreaInsetsStyle(["top", "bottom"])

  return (
    <View
      testID="root-modal-frame"
      style={[$styles.flex1, { backgroundColor: colors.background }, $insets]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={$styles.flex1}
      >
        <KeyboardAwareScrollView
          testID="root-modal-scroll"
          bottomOffset={DEFAULT_BOTTOM_OFFSET}
          // "handled": a tap on Send / Verify with the keyboard up must press
          // the button, not just dismiss the keyboard.
          keyboardShouldPersistTaps="handled"
          style={$styles.flex1}
          contentContainerStyle={[$inner, contentContainerStyle]}
        >
          {children}
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

// Screen's $innerStyle, so content lays out the same as on a scroll screen.
const $inner: ViewStyle = {
  justifyContent: "flex-start",
  alignItems: "stretch",
}
