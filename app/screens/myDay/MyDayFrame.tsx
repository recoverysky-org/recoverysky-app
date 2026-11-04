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
 */
import { FC, ReactNode } from "react"

import { MyDayGate } from "./MyDayGate"
import { MyDayHost, type MyDayHostProps } from "./MyDayHost"

export interface MyDayFrameProps {
  navigation: MyDayHostProps["navigation"]
  children: ReactNode
}

export const MyDayFrame: FC<MyDayFrameProps> = ({ navigation, children }) => (
  <MyDayHost navigation={navigation}>
    <MyDayGate>{children}</MyDayGate>
  </MyDayHost>
)
