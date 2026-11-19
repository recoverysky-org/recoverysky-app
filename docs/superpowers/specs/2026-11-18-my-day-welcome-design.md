# My Day welcome page — design

2026-11-18. Short design (small change). Owner: Jenova.

## Intent

The first time someone opens the My Day tab, a single welcome page explains what My Day is and why a
daily routine matters in recovery, then hands them to Today. Production shows it once; dev builds
show it every time so it can be worked on.

## Goals, non-goals, anti-goals

- **Goal:** a calm, readable first visit that sets up why My Day is worth using.
- **Non-goal:** a tour of each control (the manual and Sky cover "how do I"). No way to reopen it
  later in this change.
- **Anti-goal:** blocking or nagging. It shows once, has one button, and never stacks with another
  popup.

## Approaches

- **A, one welcome page in My Day's look (picked by Jenova).** Drawn inside the tab, in front of
  Today. Simple to read; needs no popup slot.
- B, two or three swipeable cards like onboarding. More taps for the same words.
- C, a popup over Today. Has to queue behind AnnouncementGate / VerifyEmailGate in `overlayGate`,
  since two iOS modals presenting together fail.

## Design

- **Where:** the `MyDayToday` route only, inside `MyDayHost` (so it wears My Day's theme) and
  *outside* `MyDayGate`. While it shows, it renders in place of the gate and Today. Sign-in does
  not wait on it: the Daily Dash driver in `DailyDashProvider` starts the session whatever the tab
  draws, so Today is usually ready by "Get started". If it isn't, the gate's loading or error
  screen follows as it does today.
- **Look:** My Day's, like `MyDayGate`: `useMyDayTheme()` colours and fonts, this launch's photo
  (`coldStartMyDayPhoto()`) behind a `MyDayBlur` glass panel, padded by the top inset. The package
  exports no screen shell, so this is ours.
- **Layout:** one scrolling page. A heading, two short sections ("What My Day is", "Why a
  routine helps"), then a full-width **Get started** button. It's a page, not a dialog, so there
  is no close X.
- **Once:** MMKV `myDay.welcomeSeen` (per install, like `guestOnboardingCompleted`), written when
  **Get started** is tapped, not when the page shows, so someone who leaves mid-read sees it again.
  The device has one owner, so per install is per person here. (Builder's call.)
- **Dev:** `__DEV__` shows it on every mount of the Today route (each cold start, since the tab
  stays mounted). Get started hides it until then. TestFlight has `__DEV__` false, so it behaves
  as production. (Builder's call.)
- **Decision in pure logic:** `shouldShowMyDayWelcome({ isDev, seen, dismissedThisMount })` in a
  `myDayWelcomeLogic.ts` with no `@/` imports, vitest-covered. I/O (MMKV) stays in the component
  or a small hook.
- **Words:** a new `myDayWelcome` namespace (not under `myDay`, which mirrors the package's copy
  leaf for leaf and has a parity test). en.ts carries the text below; the other eight locales get
  English placeholders and an entry in `docs/translation-review-2026-08-03.md`.
- **Accessibility:** the heading and section titles have `accessibilityRole="header"`; the button
  is a real button with its label; it scrolls at large text sizes.
- **Docs:** a short section in `docs/manual/my-day/today.md` (same-commit rule), a CHANGELOG
  `Added` entry, and a line in CLAUDE.md's My Day section.
- **Release:** JS only, an OTA on 4.13.0. No `runtimeVersion` bump.

## Draft words (for Jenova to edit)

**Welcome to My Day**

**What My Day is**
My Day is a quiet place to shape your day. Build your own daily routine and tick things off as you
go, morning to night. At the end of the day, rate your day and write down what you're grateful for.
Past nights let you look back and see how far you've come.

**Why a routine helps**
Early recovery can leave a lot of empty hours, and empty hours are where old habits wait. A simple
routine gives each day a shape: when you wake, when you eat, when you go to a meeting, when you
call someone, when you rest. Small things done every day add up. They take decisions off your plate
on hard days and give you something to come back to when you slip.

My Day doesn't replace your meetings, your sponsor or your support people. It helps you make room
for them.

**[ Get started ]**

## Left to the builder

Exact spacing and type sizes within My Day's theme; whether the hook lives beside the component or
in `app/hooks/`; the jest test's scope (render, tap, persists).
