/**
 * MyDayFrame — what every My Day stack screen sits in (ADDED 2026-11-04, My Day tab spec §4.5):
 * the host provider around the gate around the package's screen.
 *
 * The provider wraps the gate, not the other way round, so the gate's own UI wears My Day's
 * theme and copy.
 */
import { FC, ReactNode } from "react"

import { MyDayHost, type MyDayHostProps } from "./MyDayHost"

/**
 * TODO(Task 10): replace with the real `MyDayGate`. A pass-through until then, so the stack
 * renders the package's screens unconditionally; nothing registers the tab before Task 11.
 */
const MyDayGate: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>

export interface MyDayFrameProps {
  navigation: MyDayHostProps["navigation"]
  children: ReactNode
}

export const MyDayFrame: FC<MyDayFrameProps> = ({ navigation, children }) => (
  <MyDayHost navigation={navigation}>
    <MyDayGate>{children}</MyDayGate>
  </MyDayHost>
)
