/**
 * MyDayWelcomeGate — shows `MyDayWelcome` in place of its children until Get started (ADDED
 * 2026-11-18, spec `docs/superpowers/specs/2026-11-18-my-day-welcome-design.md`).
 *
 * It sits inside `MyDayHost` (for My Day's theme) and OUTSIDE `MyDayGate`, on the Today route
 * only (`MyDayFrame`'s `welcome` prop). Outside the gate on purpose: the page shows at once
 * instead of after a "Getting My Day ready…" spinner, and the Daily Dash sign-in does not wait
 * on it, because the driver in `DailyDashProvider` starts the session whatever the tab draws. If
 * the session is not ready by Get started, the gate's own loading or error screen follows.
 *
 * The flag is read once per mount and written on the tap only (see `myDayWelcomeLogic.ts`).
 */
import { FC, ReactNode, useCallback, useState } from "react"

import { loadString, saveString } from "@/utils/storage"

import { MyDayWelcome } from "./MyDayWelcome"
import { MY_DAY_WELCOME_SEEN_KEY, shouldShowMyDayWelcome } from "./myDayWelcomeLogic"

export interface MyDayWelcomeGateProps {
  children: ReactNode
}

export const MyDayWelcomeGate: FC<MyDayWelcomeGateProps> = ({ children }) => {
  // A lazy initializer: MMKV is read once when the Today route mounts, not on every render.
  const [seen] = useState(() => loadString(MY_DAY_WELCOME_SEEN_KEY) === "1")
  const [dismissedThisMount, setDismissedThisMount] = useState(false)

  const getStarted = useCallback(() => {
    saveString(MY_DAY_WELCOME_SEEN_KEY, "1")
    setDismissedThisMount(true)
  }, [])

  if (shouldShowMyDayWelcome({ isDev: __DEV__, seen, dismissedThisMount })) {
    return <MyDayWelcome onGetStarted={getStarted} />
  }
  return <>{children}</>
}
