/**
 * MyDayGate — the My Day tab's own gate (ADDED 2026-11-04, My Day tab spec §4.5).
 *
 * The Daily Dash client always renders its children and only *reports* its session
 * (`useSession()`) and database (`useDb()`); a blocking screen is the host's to draw. This gate
 * decides, through the pure `decideMyDayGateView` (`myDayGateLogic.ts`, vitest), whether the
 * package's screen may render, or whether the tab shows one of: getting ready, couldn't connect
 * (Try again), local data couldn't be opened (Reset), or this account was deleted (Restore while
 * the window is open).
 *
 * The gate shows; the driver acts. Signing in and releasing a wrong account belong to the sign-in
 * driver (`services/dailyDash/dailyDashDriver.ts`), so here those states are only "getting ready".
 * The only actions this file starts are the three the person taps: the driver's retry, the
 * client's local-data reset and the client's account restore.
 *
 * It wears My Day's look (`useMyDayTheme`), not RecoverySky's tokens, on purpose: the gate sits
 * inside `MyDayHost`, so the tab reads as one place whether its screen or its gate is showing.
 *
 * It must render inside the Daily Dash client (`ClientProvider`): `useSession()` and `useDb()`
 * throw outside it. `MyDayFrame` is its one mount.
 * CHANGED 2026-11-04: the client no longer mounts in `DailyDashProvider` itself. It mounts in
 * `DailyDashClient`, which `MyDayNavigator` wraps around the whole My Day stack, so every
 * `MyDayFrame`, and this gate with it, sits inside it.
 */
import { FC, ReactNode, useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native"
import { appErrorOf, useDb, useSession } from "@daily-dash/client"
import { useMyDayTheme } from "@daily-dash/my-day"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { useDailyDashDriver } from "@/context/DailyDashProvider"
import { translate } from "@/i18n"
import { useLogger } from "@/utils/logger"

import { decideMyDayGateView } from "./myDayGateLogic"

/**
 * The code of a failed client call, and nothing else. A failure arrives as the SDK's
 * `ResultError`, whose domain error sits at `e.error`; the error object and its `cause` can carry
 * the person's account details, so only the code ever reaches our logs.
 * `appErrorOf` is the client's own `isResultError(e) ? e.error : null`, typed to the client's
 * `AppError` (which has `code`); the SDK's bare guard narrows only to a code-less `DomainError`.
 */
const codeOf = (e: unknown): string | undefined => appErrorOf(e)?.code

export interface MyDayGateProps {
  children: ReactNode
}

export const MyDayGate: FC<MyDayGateProps> = ({ children }) => {
  // Every hook at the top, unconditionally: the callbacks below close over these results rather
  // than calling a hook themselves, and the `ready` early return comes after all of them.
  const session = useSession()
  const db = useDb()
  const driver = useDailyDashDriver()
  const { theme } = useMyDayTheme()
  const log = useLogger("MyDayGate")
  // Set by a failed restore, cleared when the next one starts, so the person sees that the tap
  // did something. The Restore button stays enabled: trying again is the only remedy.
  const [restoreFailed, setRestoreFailed] = useState(false)

  // The app's "filled" preset paints RecoverySky's palette (Button.tsx), and the gate must read as
  // part of the My Day tab, so its buttons wear My Day's tint and type instead.
  // CHANGED 2026-11-18: and its pressed state. The filled preset's pressed grey (neutral400) used
  // to flash RecoverySky's palette on every tap; the button now dims by My Day's pressed opacity.
  const buttonLook = useMemo(
    () => ({
      button: { backgroundColor: theme.colors.tint },
      pressed: { backgroundColor: theme.colors.tint, opacity: theme.surface.pressedOpacity },
      text: { color: theme.colors.onTint, fontFamily: theme.typography.primary.semiBold },
    }),
    [theme],
  )

  const view = decideMyDayGateView({
    session: session.state,
    db: db.state,
    attempt: driver.attempt,
  })

  const confirmReset = useCallback(() => {
    // A reset deletes this phone's My Day data, and anything not yet sent with it, so it is never
    // one tap: the destructive choice sits behind the system confirm.
    // NOTE: the client implements `db.reset()` as its session's `signOut("reset_local_data")`.
    // That is the client's own reset path, not a host sign-out: this file never calls
    // `signOut()` itself, and the driver signs the now signed-out session back in.
    Alert.alert(translate("myDayGate:resetConfirmTitle"), translate("myDayGate:resetConfirmBody"), [
      { text: translate("common:cancel"), style: "cancel" },
      {
        text: translate("common:ok"),
        style: "destructive",
        // A rejected reset is logged by its code alone, like a failed restore, rather than left
        // as an unhandled rejection.
        onPress: () => {
          db.reset().catch((e: unknown) =>
            log.warn("My Day local data reset failed", { code: codeOf(e) }),
          )
        },
      },
    ])
  }, [db, log])

  const restore = useCallback(async () => {
    // The `useSession()` handle unwraps the session's result, so EVERY failed restore arrives
    // here as a thrown `ResultError` (`@daily-dash/sdk`). The client logs only a success, which
    // makes this catch the gate's ONLY failure path: do not remove it. Only the code is logged,
    // because the error and its `cause` can carry the person's account details.
    setRestoreFailed(false)
    try {
      await session.restoreAccount()
    } catch (e) {
      log.warn("My Day account restore failed", { code: codeOf(e) })
      setRestoreFailed(true)
    }
  }, [session, log])

  if (view.kind === "ready") return <>{children}</>

  const containerStyle = [
    styles.container,
    { backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  ]
  const titleStyle = [
    styles.centered,
    {
      color: theme.colors.text,
      fontFamily: theme.typography.secondary.semiBold,
      marginBottom: theme.spacing.sm,
    },
  ]
  const bodyStyle = [
    styles.centered,
    {
      color: theme.colors.textDim,
      fontFamily: theme.typography.primary.normal,
      marginBottom: theme.spacing.sm,
    },
  ]
  const buttonStyle = [
    { marginTop: theme.spacing.md, alignSelf: "stretch" as const },
    buttonLook.button,
  ]

  switch (view.kind) {
    case "loading":
      return (
        <View style={containerStyle}>
          {/* Hidden from assistive tech: the text below carries the announcement, and a label
              here too made screen readers say "Getting My Day ready" twice. */}
          <ActivityIndicator
            color={theme.colors.text}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text tx="myDayGate:loading" style={[bodyStyle, { marginTop: theme.spacing.md }]} />
        </View>
      )
    case "connectFailed":
      return (
        <View style={containerStyle}>
          <Text tx="myDayGate:connectFailedTitle" style={titleStyle} />
          <Text tx="myDayGate:connectFailedBody" style={bodyStyle} />
          <Button
            tx="myDayGate:tryAgain"
            preset="filled"
            onPress={driver.retry}
            style={buttonStyle}
            pressedStyle={buttonLook.pressed}
            textStyle={buttonLook.text}
            accessibilityRole="button"
            accessibilityLabel={translate("myDayGate:tryAgain")}
          />
        </View>
      )
    case "dbFailed":
      return (
        <View style={containerStyle}>
          <Text tx="myDayGate:dbFailedTitle" style={titleStyle} />
          {/* The client's own message for the failed open, its own line between title and body,
              so support can match what the person reads to the client's failure. */}
          <Text text={view.message} style={bodyStyle} />
          <Text tx="myDayGate:dbFailedBody" style={bodyStyle} />
          <Button
            tx="myDayGate:resetData"
            preset="filled"
            onPress={confirmReset}
            style={buttonStyle}
            pressedStyle={buttonLook.pressed}
            textStyle={buttonLook.text}
            accessibilityRole="button"
            accessibilityLabel={translate("myDayGate:resetData")}
          />
        </View>
      )
    case "deleted":
      return (
        <View style={containerStyle}>
          <Text tx="myDayGate:deletedTitle" style={titleStyle} />
          {view.recoverable ? (
            <>
              <Text tx="myDayGate:deletedBody" style={bodyStyle} />
              <Button
                tx="myDayGate:restore"
                preset="filled"
                onPress={() => void restore()}
                style={buttonStyle}
                pressedStyle={buttonLook.pressed}
                textStyle={buttonLook.text}
                accessibilityRole="button"
                accessibilityLabel={translate("myDayGate:restore")}
              />
              {restoreFailed && (
                <Text
                  tx="myDayGate:restoreFailed"
                  // Appears after the Restore press, so a screen reader announces it.
                  accessibilityLiveRegion="polite"
                  style={[bodyStyle, { color: theme.colors.error, marginTop: theme.spacing.sm }]}
                />
              )}
            </>
          ) : (
            // The recovery window has closed: there is nothing to restore, so no button at all
            // rather than one that can only fail.
            <Text tx="myDayGate:deletedClosedBody" style={bodyStyle} />
          )}
        </View>
      )
  }
}

const styles = StyleSheet.create({
  centered: {
    textAlign: "center",
  },
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
})
