# My Day Welcome Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a one-page welcome in front of My Day's Today screen on the first visit (every
cold start in dev builds), ending in Get started.

**Architecture:** A pure decision (`shouldShowMyDayWelcome`) plus a small wrapper
(`MyDayWelcomeGate`) that reads and writes one MMKV flag and renders either the presentational
`MyDayWelcome` page or its children. `MyDayFrame` gains a `welcome` prop that places the wrapper
inside `MyDayHost` and outside `MyDayGate`; only the `MyDayToday` route passes it.

**Tech Stack:** React Native / Expo 54, `@daily-dash/my-day` (`useMyDayTheme`), MMKV via
`@/utils/storage`, i18next, Vitest (`.test.ts`), jest-expo (`.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-11-18-my-day-welcome-design.md`

## Global Constraints

- MMKV key exactly `myDay.welcomeSeen`, value `"1"`, written on Get started only, never on show.
- Dev: `__DEV__` shows it on every mount of the Today route; TestFlight/production once.
- Words live in a new top-level `myDayWelcome` namespace, never under `myDay` (package parity test).
- All nine locale files get every key; non-English carry the English text.
- Look is My Day's: `useMyDayTheme()` colours/fonts/spacing, `coldStartMyDayPhoto()` behind
  `<MyDayBlur surface="card" />`, top padded by `useSafeAreaInsets().top`.
- Logic module has no runtime `@/` imports (vitest has no alias).
- Never run the repo-wide lint; `npx eslint <files you touched>`.
- Shared checkout: stage only named paths. JS only: no `runtimeVersion` bump.
- Comments follow CLAUDE.md "Comments": say why, with ADDED 2026-11-18.

## Review Focus

- Get started tapped while the Daily Dash session is still connecting: Today's gate shows its
  loading screen, never a blank page (welcome sits outside `MyDayGate`; Task 2 test renders the
  children after the tap).
- Leaving the tab mid-read, then a cold start: the welcome shows again (flag unwritten; Task 1
  `seen: false` case + Task 2 "does not write on show" test).
- Large text sizes: the page scrolls and the button stays reachable (a `ScrollView`, button
  inside it; checked on device).
- Screen reader: title and both section titles announce as headings; button is a button with its
  label (Task 2 asserts `accessibilityRole="header"` on the three titles).
- Dev build after Get started: hidden until the next mount, not re-shown on the next render
  (`dismissedThisMount`; Task 1 case).

---

### Task 1: The decision

**Files:**
- Create: `app/screens/myDay/myDayWelcomeLogic.ts`
- Test: `app/screens/myDay/myDayWelcomeLogic.test.ts`

**Interfaces:**
- Produces: `MY_DAY_WELCOME_SEEN_KEY = "myDay.welcomeSeen"`;
  `shouldShowMyDayWelcome(input: { isDev: boolean; seen: boolean; dismissedThisMount: boolean }): boolean`

- [ ] **Step 1: Write the failing test** (`describe("shouldShowMyDayWelcome")`)

```ts
expect(shouldShowMyDayWelcome({ isDev: false, seen: false, dismissedThisMount: false })).toBe(true)
expect(shouldShowMyDayWelcome({ isDev: false, seen: true, dismissedThisMount: false })).toBe(false)
expect(shouldShowMyDayWelcome({ isDev: true, seen: true, dismissedThisMount: false })).toBe(true)
expect(shouldShowMyDayWelcome({ isDev: true, seen: true, dismissedThisMount: true })).toBe(false)
expect(shouldShowMyDayWelcome({ isDev: false, seen: false, dismissedThisMount: true })).toBe(false)
expect(MY_DAY_WELCOME_SEEN_KEY).toBe("myDay.welcomeSeen")
```

- [ ] **Step 2:** `npm run test:unit -- app/screens/myDay/myDayWelcomeLogic.test.ts` → FAIL (module missing)
- [ ] **Step 3:** Implement: `!dismissedThisMount && (isDev || !seen)`, with a header comment.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `✨ feat(my-day): decide when the welcome page shows`

### Task 2: The page, the wrapper, the route, the words

**Files:**
- Create: `app/screens/myDay/MyDayWelcome.tsx`, `app/screens/myDay/MyDayWelcomeGate.tsx`
- Modify: `app/screens/myDay/MyDayFrame.tsx`, `app/navigators/MyDayNavigator.tsx` (`MyDayTodayRoute`)
- Modify: `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts` (new `myDayWelcome` block after `myDayGate`)
- Test: `app/screens/myDay/MyDayWelcomeGate.test.tsx`

**Interfaces:**
- Consumes: Task 1's key and `shouldShowMyDayWelcome`.
- Produces: `MyDayWelcome: FC<{ onGetStarted: () => void }>`;
  `MyDayWelcomeGate: FC<{ children: ReactNode }>`;
  `MyDayFrameProps.welcome?: boolean` (true → `MyDayHost > MyDayWelcomeGate > MyDayGate > children`).

Words (en.ts; the other eight get the same English):

```ts
myDayWelcome: {
  title: "Welcome to My Day",
  whatTitle: "What My Day is",
  whatBody:
    "My Day is a quiet place to shape your day. Build your own daily routine and tick things off as you go, morning to night. At the end of the day, rate your day and write down what you're grateful for. Past nights let you look back and see how far you've come.",
  whyTitle: "Why a routine helps",
  whyBody:
    "Early recovery can leave a lot of empty hours, and empty hours are where old habits wait. A simple routine gives each day a shape: when you wake, when you eat, when you go to a meeting, when you call someone, when you rest. Small things done every day add up. They take decisions off your plate on hard days and give you something to come back to when you slip.",
  supportBody:
    "My Day doesn't replace your meetings, your sponsor or your support people. It helps you make room for them.",
  getStarted: "Get started",
},
```

- [ ] **Step 1: Write the failing jest test.** Mock `@/utils/storage` (`loadString`, `saveString`
  as `jest.fn`), `@/components/myDay/MyDayBlur` (renders null), and `@daily-dash/my-day`'s
  `useMyDayTheme` to return `{ theme: dailyDashLight }` from the real module. Wrap in a
  `SafeAreaProvider` with `initialMetrics`. Cases:
  - `loadString` → null: shows `myDayWelcome:title` text; child `<Text text="TODAY" />` absent;
    `saveString` not called.
  - Pressing Get started: `saveString` called with `("myDay.welcomeSeen", "1")`; "TODAY" shows.
  - `loadString` → `"1"` with `__DEV__` forced false (`global.__DEV__ = false`, restored after):
    "TODAY" shows, no title.
  - The three titles carry `accessibilityRole="header"`.
- [ ] **Step 2:** `npm run test:component -- app/screens/myDay/MyDayWelcomeGate.test.tsx` → FAIL
- [ ] **Step 3: Implement.**
  - `MyDayWelcomeGate`: read `loadString(MY_DAY_WELCOME_SEEN_KEY) === "1"` once in a `useState`
    initializer; `dismissed` state; on Get started `saveString(key, "1")` then dismiss; render
    `<MyDayWelcome>` when `shouldShowMyDayWelcome({ isDev: __DEV__, seen, dismissedThisMount })`,
    else children.
  - `MyDayWelcome`: full-bleed `ImageBackground` of `coldStartMyDayPhoto()`; a `ScrollView`
    padded by the top inset + `theme.spacing.lg`; one glass card (`borderRadius:
    theme.surface.cardRadius`, `overflow: "hidden"`, `<MyDayBlur surface="card" />`,
    `backgroundColor: theme.colors.cardGlass`, `padding: theme.surface.cardPadding`); title in
    `typography.secondary`, section titles and body in `typography.primary`, `colors.text`;
    Get started is `@/components/Button` with MyDayGate's `buttonLook` (tint background,
    `onTint` semiBold text), full width, `minHeight: theme.surface.buttonHeight`.
  - `MyDayFrame` + `MyDayTodayRoute` as in Interfaces. Append ADDED notes to both headers.
  - Nine locale files; `npm run compile` catches a missing key.
- [ ] **Step 4:** jest command → PASS; `npm run compile` → no errors;
  `npx eslint` on every touched file → clean.
- [ ] **Step 5: Commit** `✨ feat(my-day): a welcome page on the first visit`

### Task 3: Docs

**Files:**
- Modify: `docs/manual/my-day/today.md` (a **First visit.** paragraph at the top of "Good to know";
  `MyDayWelcome.tsx` added to its sources line)
- Modify: `docs/translation-review-2026-08-03.md` (a "2026-11-18 My Day welcome (English
  placeholders)" entry: 8 locales × 7 keys, `myDayWelcome.*`)
- Modify: `CHANGELOG.md` `[Unreleased]` → Added entry + Docs `(manual)` line
- Modify: `CLAUDE.md` "My Day (Daily Dash)" → one ADDED 2026-11-18 paragraph (where it renders,
  the MMKV key, dev behaviour, the namespace and why it isn't under `myDay`)

Manual paragraph (quotes the labels verbatim):

> **First visit.** The first time you open My Day, it opens on "Welcome to My Day", a page about what My Day is and why a routine helps. Tap "Get started" to go on to My Day. It shows once on this phone.

- [ ] **Step 1:** Make the four edits.
- [ ] **Step 2:** `pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run` → exit 0, no problems listed.
- [ ] **Step 3: Commit** `📝 docs(my-day): the welcome page in the manual, changelog and CLAUDE.md`

Final check: `npm run test:unit` and `npm run test:component -- app/screens/myDay` all pass; a
device pass on iOS and Android (dev build: shows every cold start; Get started → Today).
