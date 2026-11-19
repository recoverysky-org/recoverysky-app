/**
 * MyDayFrame — what every My Day stack screen sits in (ADDED 2026-11-04, My Day tab spec §4.5):
 * the host provider around the gate around the package's screen.
 *
 * The provider wraps the gate, not the other way round, so the gate's own UI wears My Day's
 * theme and copy.
 *
 * ADDED 2026-11-04: the gate is the real `MyDayGate` (loading, couldn't connect, local data
 * failed, account deleted); it replaced a pass-through that rendered the package's screens
 * unconditionally while the gate was being built.
 *
 * ADDED 2026-11-18: `welcome` puts `MyDayWelcomeGate` between the provider and the gate, so the
 * first visit opens on the welcome page (spec `2026-11-18-my-day-welcome-design.md`). Only the
 * Today route passes it: the welcome is the tab's front door, not something a deeper screen
 * should ever show.
 */
import { FC, ReactNode } from "react"

import { MyDayGate } from "./MyDayGate"
import { MyDayHost, type MyDayHostProps } from "./MyDayHost"
import { MyDayWelcomeGate } from "./MyDayWelcomeGate"

export interface MyDayFrameProps {
  navigation: MyDayHostProps["navigation"]
  children: ReactNode
  /** Today only: show the welcome page in front of the gate until Get started. */
  welcome?: boolean
}

export const MyDayFrame: FC<MyDayFrameProps> = ({ navigation, children, welcome = false }) => {
  const gated = <MyDayGate>{children}</MyDayGate>
  return (
    <MyDayHost navigation={navigation}>
      {welcome ? <MyDayWelcomeGate>{gated}</MyDayWelcomeGate> : gated}
    </MyDayHost>
  )
}
