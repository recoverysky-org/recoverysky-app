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
 * It must render inside the `ClientProvider` (`DailyDashProvider`): `useSession()` and `useDb()`
 * throw outside it. `MyDayFrame` is its one mount, inside the provider tree.
 */
import { FC, ReactNode, useCallback } from "react"
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native"
import { useDb, useSession } from "@daily-dash/client"
import { useMyDayTheme } from "@daily-dash/my-day"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { useDailyDashDriver } from "@/context/DailyDashProvider"
import { translate } from "@/i18n"
import { useLogger } from "@/utils/logger"

import { decideMyDayGateView } from "./myDayGateLogic"

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
        onPress: () => void db.reset(),
      },
    ])
  }, [db])

  const restore = useCallback(async () => {
    // The handle's restoreAccount resolves void and the client logs its own failure; the catch is
    // for a throw that slips past it. Only the error's `code` is logged: the object and its
    // `cause` can carry the person's account details, which never go in our logs.
    try {
      await session.restoreAccount()
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code
      log.warn("My Day account restore threw", {
        code: typeof code === "string" ? code : undefined,
      })
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
  const buttonStyle = { marginTop: theme.spacing.md, alignSelf: "stretch" as const }

  switch (view.kind) {
    case "loading":
      return (
        <View style={containerStyle}>
          <ActivityIndicator
            color={theme.colors.text}
            accessibilityLabel={translate("myDayGate:loading")}
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
                accessibilityRole="button"
                accessibilityLabel={translate("myDayGate:restore")}
              />
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
