/**
 * MyDayWelcome — the one-page welcome in front of Today on the first visit to My Day (ADDED
 * 2026-11-18, spec `docs/superpowers/specs/2026-11-18-my-day-welcome-design.md`): what My Day is,
 * why a routine helps in recovery, and Get started.
 *
 * Presentational: `MyDayWelcomeGate` decides when it shows and owns the flag.
 *
 * It wears My Day's look, like `MyDayGate`, because it sits inside the tab. Everything comes from
 * `useMyDayTheme()`: the theme's colours, fonts and spacing, and the host's `surfaces` (this
 * launch's photo, the blur, the top inset) that `MyDayHost` hands the package, so the page cannot
 * drift from the package's screens if the host's surfaces change. The package exports no screen
 * shell, so the layout is ours, built to match its `Screen` and `Card`:
 * - the root is painted `colors.background` under the photo, so no frame of the navigator's
 *   background shows while the JPEG decodes, and the photo ignores iOS Smart Invert;
 * - the card has the package's glass, hairline border and shadow; the blur sits in its own
 *   clipped layer, as the package's does, because clipping the card itself would cut the shadow;
 * - a glass strip covers the status bar, so text scrolling up passes under glass, not under the
 *   clock.
 *
 * A `ScrollView` holds everything, the button included, so large text sizes still reach Get
 * started. Its top padding is the window's top inset (the stack hides the native header and the
 * window runs edge to edge). No bottom inset: the tab bar below already clears the home
 * indicator (`MainNavigator`'s `tabBarStyle`), and the package's screens add none either.
 */
import { FC, useMemo } from "react"
import { ImageBackground, ScrollView, StyleSheet, View } from "react-native"
import { useMyDayTheme } from "@daily-dash/my-day"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"

export interface MyDayWelcomeProps {
  onGetStarted: () => void
}

export const MyDayWelcome: FC<MyDayWelcomeProps> = ({ onGetStarted }) => {
  const { theme, surfaces } = useMyDayTheme()
  const { Blur, photo } = surfaces
  const top = surfaces.insets?.top ?? 0

  const s = useMemo(() => {
    const { colors, spacing, surface, typography } = theme
    return {
      root: { backgroundColor: colors.background },
      scroll: {
        paddingTop: top + spacing.lg,
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.md,
      },
      statusBar: { height: top, backgroundColor: colors.headerGlass },
      card: {
        backgroundColor: colors.cardGlass,
        borderColor: colors.border,
        borderWidth: surface.hairline,
        borderRadius: surface.cardRadius,
        boxShadow: surface.cardShadow,
        padding: surface.cardPadding,
      },
      blurClip: { borderRadius: surface.cardRadius },
      title: {
        color: colors.text,
        fontFamily: typography.secondary.semiBold,
        fontSize: 28,
        lineHeight: 34,
        marginBottom: spacing.md,
      },
      sectionTitle: {
        color: colors.text,
        fontFamily: typography.primary.semiBold,
        marginTop: spacing.md,
        marginBottom: spacing.xs,
      },
      body: {
        color: colors.text,
        fontFamily: typography.primary.normal,
        marginBottom: spacing.sm,
      },
      // The app's "filled" preset paints RecoverySky's palette (Button.tsx), including its pressed
      // grey; in the My Day tab the button wears My Day's tint and type, as MyDayGate's do, and
      // dims by the package's pressed opacity instead.
      button: {
        alignSelf: "stretch" as const,
        backgroundColor: colors.tint,
        borderRadius: surface.buttonRadius,
        marginTop: spacing.lg,
        minHeight: surface.buttonHeight,
      },
      buttonPressed: { backgroundColor: colors.tint, opacity: surface.pressedOpacity },
      buttonText: { color: colors.onTint, fontFamily: typography.primary.semiBold },
    }
  }, [theme, top])

  return (
    <View style={[styles.fill, s.root]}>
      {photo === undefined ? null : (
        <ImageBackground
          source={photo}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      )}
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.card}>
          {Blur ? (
            <View style={[styles.blurClip, s.blurClip]} pointerEvents="none">
              <Blur surface="card" />
            </View>
          ) : null}
          <Text tx="myDayWelcome:title" style={s.title} accessibilityRole="header" />
          <Text tx="myDayWelcome:whatTitle" style={s.sectionTitle} accessibilityRole="header" />
          <Text tx="myDayWelcome:whatBody" style={s.body} />
          <Text tx="myDayWelcome:whyTitle" style={s.sectionTitle} accessibilityRole="header" />
          <Text tx="myDayWelcome:whyBody" style={s.body} />
          <Text tx="myDayWelcome:supportBody" style={s.body} />
          <Button
            tx="myDayWelcome:getStarted"
            preset="filled"
            onPress={onGetStarted}
            style={s.button}
            pressedStyle={s.buttonPressed}
            textStyle={s.buttonText}
            accessibilityRole="button"
            accessibilityLabel={translate("myDayWelcome:getStarted")}
          />
        </View>
      </ScrollView>
      {top > 0 ? (
        <View style={[styles.statusBar, s.statusBar]} pointerEvents="none">
          {Blur ? <Blur surface="header" /> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // The package's `$blurClip`: the blur rounds its own corners so the card can keep its shadow.
  blurClip: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  fill: { flex: 1 },
  statusBar: { left: 0, position: "absolute", right: 0, top: 0 },
})
