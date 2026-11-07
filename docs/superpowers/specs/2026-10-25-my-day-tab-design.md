# The My Day tab: hosting `@daily-dash/my-day` in RecoverySky — design

**Date:** 2026-10-25, builder-check answers folded in 2026-11-04 · **Status:** **approved by the product owner
2026-11-04**; brainstormed with her on 2026-10-25, her rulings are marked **[Owner]**, the implementer's
proposals **[My call]** · **Plans:** `docs/superpowers/plans/2026-11-04-my-day-tab.md` (this repository, §4 and
§7) and `docs/superpowers/plans/2026-11-04-my-day-recoverysky-host.md` in the Daily Dash repository (§5) · **Repositories:** this one
(`recoverysky-org/app`, the host; §4, §7); `jenova-marie/the-daily-dash-app` (`packages/my-day`,
`packages/client`, `apps/api` configuration; §5, a hand-off); `recoverysky-org/agent` (configuration only,
and only for §6) · **Reads first:** the app packages design
(`../the-daily-dash-app/docs/superpowers/specs/2026-10-06-app-packages-design.md`, §4 the host contract, §6
styling, §11.7 amendment A11), `packages/my-day/README.md` (the host guide, written for this repository),
`packages/client/README.md` (hosting `ClientProvider`), the Sky chat design
(`2026-10-12-sky-chat-design.md`) and the Sky moments design (`2026-10-24-sky-moments-design.md`) in that
repository · **Related here:** CLAUDE.md "Runtime Version & OTA Updates", "Navigation", "Guest mode",
"Auth, Attestation & Encryption Keys", "Database Layer", "Internationalization", "Subscription System"

## 1. Purpose and scope

My Day is The Daily Dash's first slice, built for RecoverySky from the start: a daily routine with ticks,
an any-time check-in, a gratitude list, a quote and Rate your day across the recovery pillars, for someone
in early recovery ("My Day for RecoverySky", the vision document). It ships as a feature package,
`@daily-dash/my-day`, that a host mounts; `apps/app` in that repository is the reference host today and
this app is the second. This design is the host side: how RecoverySky mounts My Day as a **new tab**, and
what My Day must grow to sit in this app without a seam.

- **In:**
  - A new **My Day** tab for premium accounts (§3 D1, D2), holding every My Day screen as a stack.
  - The host plumbing: the vendored packages, `ClientProvider` over the person's existing Auth0 session,
    the navigation, theme, copy, surfaces and lifecycle adapters (§4).
  - What My Day grows for this host, handed to the Daily Dash repository (§5): a light theme, a copy seam
    for i18n, the repacked tarballs, and the one API allow-list entry.
  - The native release this needs (expo-blur, two font families), on a separate branch (§7).
- **Out, on purpose:**
  - **Replacing or moving the Sky Agent tab.** It stays as it is. The role The Daily Dash app's Sky tab plays
    beside My Day is played here by our Agent tab (D1), and that hand-off is §6: a named follow-on, not
    this build.
  - Moving the agent's meeting cards (`MeetingResultsCard`, `SchedulePopup`) anywhere. They stay in
    `AgentScreen`. My Day never draws a chat (app packages design §3.4: My Day imports nothing of Sky).
  - My Day's `sky` capability (Sky moments design §7): not passed in v1; every capability off means My Day
    shows nothing of Sky and is complete without her. The "Sky suggests" chips on Rate your day go through
    the Daily Dash API, not the capability, so they work from day one.
  - Translating My Day's copy. The seam ships; every locale carries English until the review queue reaches
    it (D7).
  - The web build. The tab is hidden on web in v1 (§4.5); `expo-sqlite`'s OPFS worker needs cross-origin
    isolation headers our web hosting does not set.
  - Any change to the Daily Dash API's data or routes. Configuration only (§5.4).

## 2. The shape

```
RecoverySky app ──── My Day tab ──── @daily-dash/my-day screens ──── @daily-dash/client ──── GET/PUT /v1/* ───▶ Daily Dash API
   (host)              (new)          hooks over useSdk()/useDb()      session (exchange → GoTrue)            (apps/api)
                                                                        dd-<hash>.db (SQLCipher, own key)
                                                                        outbox + sync
   Auth0 session (auth.recoverysky.app, audience https://api.recoverysky.app)
     └─ reused: a SignIn adapter hands the client the tokens the app already holds ─▶ POST /v1/auth/exchange

RecoverySky app ──── Sky Agent tab (unchanged) ───────────────────────────────────────────▶ recoverysky-org/agent
                      (§6: later, My Day's sky.open(moment) lands here)
```

Three things stay true from the Daily Dash's own designs: My Day owns no session, database or router (the
host hands it those); every write leaves through the client's outbox and reads as pending until the server
confirms it; and the Daily Dash API is the only door to My Day's data (principle 10). What this design adds
is the RecoverySky host around them.

## 3. Decisions

**D1. A new tab, and the Sky tab stays.** My Day is a sixth tab, **My Day**. The Sky Agent tab continues to
exist unchanged. The chat that The Daily Dash app puts beside My Day is, in this app, our existing Agent tab;
wiring My Day's moments to it is §6, after both upstream plans land. **[Owner, 2026-10-25]**

**D2. Premium only.** The tab shows for a signed-in, non-guest account with the `recoverysky-premium`
entitlement (`isPremium` from `SubscriptionContext`, the gate the Sky tab uses). **[Owner]** Hidden, not
teased: no live-looking tab that funnels to the paywall, the same treatment the Agent tab gets, rather than
the Permissions rows' pattern. **[My call]** Guests never see it: a guest has no account and My Day needs one.

**D3. The crisis path is Meetings → Online.** My Day's `openCrisisPath()` navigates to the Meetings tab's
Online segment (`navigate("Meetings", { segment: "live" })`): live meetings right now, the fastest human
contact the app has, on a tab that stays mounted so it lands warm. **[Owner]**
CHANGED 2026-11-06 (support contacts spec D6): `openCrisisPath()` now opens the app's Support screen, which offers "Find a live meeting now" itself.

**D4. Light and dark, following the app, with no seams.** My Day today has one baked theme, `dailyDashDark`
(app packages amendment A11). Looks are very important; My Day is built for us and this is a feature it does
not have yet, so it grows one: a `dailyDashLight`, resolved from the Dash's existing light palette
(`palettes.light` in `apps/app/src/theme/tokens.ts`), and the host passes dark or light from the app's own
theme (`useAppTheme().theme.isDark`), switching live with the app's toggle (§4.6, §5.1). **[Owner: both
schemes, no seams; My call: resolve from the Dash's light palette rather than invent one]** The look inside
the tab stays the Dash's (glass, Playfair headings, the photo): that is the ruling of A11 and the reason
the tab is a different experience, not a reskin. **My Day's tint follows the app's tint picker. [Owner]** The
host passes the app's resolved `theme.colors.tint` and `tintInactive` into the theme it hands My Day (§4.6),
so a picked tint colours the tab's controls the way it colours the rest of the app; the Dash's `accent` (its
warm second colour, used in two places) stays the Dash's.

**D5. The photo and the blur, and so a store build on a branch.** The host passes `surfaces.photo` (the
Dash's background photos) and a `Blur` built on **expo-blur**, so the glass is real, on Android with the
native blur too rather than the tinted overlay expo-blur defaults to there (§4.6). **[Owner: "yes photo
to give a different UI/UX experience"; add expo-blur; native blur on Android]** expo-blur is a native module: `runtimeVersion` and
`version` bump together, and the work rides a **separate branch** so `root` keeps shipping 4.11.0 OTAs
until the store build is ready (§7). **[Owner]**

**D6. Tab order:** Home · Meetings · Attendance · **My Day** · Sky · Settings. **[Owner]** Attendance stays
conditional on `attendanceEnabled`, Sky on its env var and entitlement, as today.

**D7. Full i18n support, English in every locale for now.** My Day's six `*-copy.ts` modules become one
injected, typed copy object: `MyDayProvider` takes `copy`, and the host builds it from its own i18next
resources per locale (§4.7, §5.2). **[Owner: full i18n, English for all nine for now; My call: an injected
copy object rather than i18next inside the package]** The nine-file rule (CLAUDE.md "Internationalization")
applies: every key lands in `en.ts` and the eight others, English text in the eight, so the native-speaker
review queue (`docs/translation-review-2026-08-03.md`) picks them up.

**D8. Lifecycle follows the host's, and a sign-out never deletes a database or a key.** Our sign-out clears
tokens only (`useAuth0Wrapper` logout → `authStore.logout()` + `clearAuthCredentials()`; verified
2026-11-04): the encrypted database, its key, the device JWT and the owner record all stay, and only Settings
→ Delete User Data removes them. The Daily Dash side keeps the same rule: the app's logout does **not** call
the client's `signOut()`, because the client's `wipe()` deletes the account database *and* its SecureStore
key for every reason but two (`packages/client/src/session/session.ts` 586–628,
`src/db/open-database.native.ts` 58–59). The Daily Dash session, database and key stay on the device through
a sign-out, exactly as ours do, and only Settings → Delete User Data wipes them, in the same teardown as ours
(§4.4, §4.9). Our ownership gate is authoritative, and the client's owner check always sees the account we
already accepted. **[Owner: lifecycle follows the host; no sign-out deletes any database or key, RecoverySky
or Daily Dash]**

**D9. Outage states are not coupled.** My Day's own failed-read states ("Your day didn't load… Try again")
handle a Daily Dash API outage; our maintenance banner and `MaintenanceScreen` stay about our API. A My Day
screen never reads `configStore.maintenanceMode`. **[Owner: yes]**

**D10. The session is reused silently, and started only for those who can use it.** A `SignIn` adapter returns
the Auth0 tokens the app already holds; no second sign-in UI. The Daily Dash session is started (the exchange,
which creates and seeds the platform account on first contact, ADR 0015) only while the tab's gate holds:
signed in, not a guest, premium. A free account never gets a Daily Dash account minted for it. **[My call]**

**D11. Vendored, as common is.** `@daily-dash/sdk`, `@daily-dash/client` and `@daily-dash/my-day` are
`npm pack` tarballs under `vendor/`, named in `dependencies` and `overrides` (the README's recipe; the pattern
`@recoverysky-org/common` and its two private deps already use, see CLAUDE.md "Linked Packages"). EAS cloud
builds need no registry. **[My call]**

**D12. The Daily Dash API's URL is build configuration.** `EXPO_PUBLIC_DAILY_DASH_API_URL` in `.env`,
`eas.json` and the EAS production environment (`npm run check:env` keeps them agreed), read the way
`EXPO_PUBLIC_AGENT_URL` is (a direct `process.env.EXPO_PUBLIC_*` access, so Expo inlines it). A build without
it, or with an invalid one, hides the tab, the Agent tab's own precedent (`agentTabLogic.ts`). Moving it to
`/config` is a later, API-repo change. **[My call]** The production value is `https://api.the-daily-dash.com`:
today the hosted dev project, **promoted to production before this ships [Owner]**. Dev builds point `.env` at
the local Daily Dash API (`http://<mac-ip>:5001`, the Daily Dash app's own dev default) with its
`AUTH0_RECOVERYSKY_*` tenant values set, or at the hosted URL until the local overlay has them. Every
RecoverySky build signs in against `auth.recoverysky.app`, the tenant the Daily Dash API's `recoverysky`
tenant is configured for, so a dev build and a store build present the same kind of token.

## 4. The host (this repository)

### 4.1 Dependencies and the native shape

| Add | Why | Native? |
| --- | --- | --- |
| `vendor/daily-dash-sdk-<v>.tgz`, `vendor/daily-dash-client-<v>.tgz`, `vendor/daily-dash-my-day-<v>.tgz` as `file:` deps **and** `overrides` | D11; the versions §5.3 repacks | no |
| `@tanstack/react-query` `^5.104` | peer of client and my-day; `ClientProvider` owns the `QueryClient` (`packages/client/src/hooks/provider.tsx`), the host adds no provider of its own | no |
| `@expo-google-fonts/inter`, `@expo-google-fonts/playfair-display` (400, 500, 600, 700) | `dailyDashDark.typography` names `Inter_400Regular` … `PlayfairDisplay_700Bold`; add them to `customFontsToLoad` (`app/theme/typography.ts`) under exactly those names | no (font files are assets) |
| `expo-blur` (`npx expo install expo-blur`, the SDK 54 line) | D5; the `Blur` surface | **yes** |
| The Dash's background photos, copied into `assets/images/my-day/` | D5; `surfaces.photo` | no |

Every other peer is already here and inside the ranges: expo 54.0.37, react 19.1.0, react-native 0.81.5,
expo-sqlite 16.0.10, expo-secure-store 15.0.8, expo-crypto 15.0.9, drizzle-orm 0.45.2 (common's peer).
One bump: `@daily-dash/sdk` peers `zod ^4.6.5` and we have 4.6.2, so zod moves to 4.6.5 (JS only; common's
own range `^4.1.13` is satisfied). `@jenova-marie/ts-rust-result` 2.2.18, which client depends on, is the
exact version our override already vendors.

**Metro must be able to resolve the tarballs.** Our `metro.config.js` sets
`resolver.unstable_conditionNames = ["require", "default", "browser"]` (the axios/apisauce workaround for
metro#1272), and the packed manifests declare only `exports["."].import` and `.types`, no `default` and no
`main`; as the two stand, the first `npm start` fails to resolve `@daily-dash/client`. The fix is on the
package side (§5.3: a `default` condition), not by re-adding `import` here, which would re-open the axios
bug the condition list exists to avoid. **[My call]**

**Because of expo-blur:** `npm run prebuild:clean` after adding it, and bump `version` and `runtimeVersion`
together at release (§7). Nothing else in this design changes the native shape; if expo-blur were dropped,
the whole build would be OTA-shippable.

### 4.2 Providers in `app.tsx`

`ClientProvider` mounts once, inside `RootStoreProvider` and `SubscriptionProvider` (it needs the auth store
and `isPremium`) and outside `DatabaseProvider` (the two databases are independent). It renders its children
always and only reports, so the rest of the tree is untouched.

| `ClientProvider` prop | From |
| --- | --- |
| `client` | `{ app: "recoverysky", version: Application.nativeApplicationVersion, channel: Updates.channel ?? (__DEV__ ? "development" : "production") }` |
| `apiBaseUrl` | `EXPO_PUBLIC_DAILY_DASH_API_URL` (D12) |
| `auth` | `{ products: ["recoverysky"], loadSignIn }`, §4.3 |
| `logger` | an adapter over `logger.child({ module: "DailyDash" })` matching the client's `Logger` shape; log by fields, never the raw SQLite `cause` (client README "What a host never logs") |
| `features` | `[myDayFeature]` |
| `connectivity` | `{ reach, onReconnect }` over `NetworkStore` (`isOffline` edge → `onReconnect`) |
| `onRefused` | 410 → `sessionRefusal(session, problem)` from `@daily-dash/client` — with a host-built `session` the provider does not route refusals to it by itself, so the host must, or the `accountDeleted` state never arrives; 426 → the app's existing store-update prompt (`checkForUpdates.ts`'s "New Version Available") |
| `track` | `trackEvent` |
| `session` | built once at boot with `createClientSession`, the way `apps/app/src/boot/app-boot.ts` does, and held outside React so §4.4's reactions can drive it |

A small resumer-style component, `DailyDashSessionGate` (beside `ProfileHydrator` and friends), is where the
React-side state (`isPremium`) meets the session (§4.4).

### 4.3 The `SignIn` adapter

`loadSignIn("recoverysky")` resolves to one adapter over the app's existing Auth0 session. It opens no UI.

| `SignIn` member | Behaviour here |
| --- | --- |
| `inAppEmailCode` | `false` |
| `sendEmailCode`, `signInWithEmailCode` | never called by this host; return an `internal` error Result ("RecoverySky signs in elsewhere") |
| `signInWithProvider(connection)` | ignores `connection`; returns `Auth0Result { accessToken: authStore.accessToken, idToken: authStore.idToken, method: authStore.loginMethod ?? "hosted", product: "recoverysky" }` once both tokens are usable. If `idToken` is absent (a cold start that restored no ID token), it calls `renewStoredCredentials()` once and reads again; still absent, it returns `unauthorized`, and the gate tries again on the next auth change |
| `completeRedirect` | `ok(null)` |
| `signOutProvider` | no-op: the Auth0 session is the app's to close |
| `providerToken({ fresh })` | the app's user refresher (`api`'s registered `user()` refresher; `fresh` forces a renewal), so §6's Sky hand-off has a token source when it comes |

The audience already agrees: the Daily Dash API's `recoverysky` tenant verifies `https://auth.recoverysky.app/`
tokens for `https://api.recoverysky.app`, which is exactly what this app's Auth0 config asks for. The one
remaining gate is `azp`: this app's Auth0 client id must be in the API's `AUTH0_RECOVERYSKY_CLIENT_IDS`
(§5.4). Decisions (which tokens suffice, when to renew, when to give up) live in a pure
`dailyDashSignInLogic.ts`, vitest-covered; the adapter is the I/O half.

### 4.4 Session lifecycle

- **Start.** The host calls `session.start()` at boot (the client's boot step 5: restore a stored record,
  else signed out). `DailyDashSessionGate` watches `authStore.isAuthenticated && !authStore.isGuest &&
  isPremium` (the tab's gate, §4.5) and the session state; when the gate holds and the state is `signedOut`,
  it calls `session.signInWithProvider(null, "recoverysky")`. The client then runs its owner check and the
  exchange and stores its record. A gate that does not hold starts nothing (D10).
- **Logout.** The app's logout path does **not** touch the Daily Dash session (D8). What ours does, verified
  2026-11-04: `useAuth0Wrapper` logout clears the Auth0 web session or credentials, `authStore.logout()`
  drops the tokens, `userId`, `loginMethod` and the guest flag, and `clearAuthCredentials()` removes the
  SecureStore credential; the encrypted database, `sqlite_encryption_key_v1`, `device_jwt_v1` and `ownerSub`
  stay. `resetLocalDatabase()` has exactly two callers, Settings → Delete User Data and the database-error
  overlay's Reset. The Daily Dash client cannot match that with a call: its `signOut(reason)` runs `wipe()`,
  which deletes the account database and its `dd-db-key-<name>` SecureStore key for every reason except
  `permanent_refresh_failure` and `sky_sign_in` (those write a *kept* record so the same account's next
  sign-in reopens the file). So on our logout the host leaves the Daily Dash session record, its tokens, its
  database and its key where they are. `ClientProvider` unmounts with the gate (D10, §4.2), so nothing runs
  for the Daily Dash account while signed out; on the owner's next sign-in `session.start()` restores the
  record and My Day opens on the same data, and a Daily Dash refresh token revoked meanwhile ends in
  `permanent_refresh_failure`, which keeps the file, after which the gate signs in again. The device is
  single-owner by construction (our WrongAccount gate), so the shared-device case the client's wipe guards
  against cannot arise here. **[My call within D8]** If we later want the Daily Dash *tokens* cleared on
  sign-out as well, Daily Dash adds a sign-out reason that keeps the file, the `sky_sign_in` path under a
  host's name; not needed for v1 (§8).
- **Wrong account.** Cannot normally arise: the adapter only ever hands over a session our ownership gate
  accepted, and the client keeps one owner per product keyed by `sub`. It can arise after an **identity
  relink** (`relinkOwner`, CLAUDE.md "Auth" §1): the owner's sub changes and the client sees a mismatch. The
  rule: our gate is authoritative, so on the client's `wrongAccount` state the host calls
  `session.releaseDevice()` (hands the device to the account that just signed in, replacing the owner
  record). **Known edge, flagged to the Daily Dash team:** ADR 0015 makes the Auth0 subject the identity, so a
  relinked sub exchanges as a *different* platform account unless the platform links subs. Rare; accepted for
  v1; §8.
- **Account deleted (410).** The client's `accountDeleted` state; My Day's screens stop. This app has no
  account deletion of its own yet, so nothing more to wire.
- **Premium lapses.** The tab hides (§4.5). The session is left as it is; nothing is torn down for a lapse,
  and it resumes when the entitlement returns.

### 4.5 Navigation

- `MainTabParamList` gains `MyDay: NavigatorScreenParams<MyDayStackParamList> | undefined`. The tab's
  component is a native stack:

  | `MyDayRoutes` key | Stack screen | Params |
  | --- | --- | --- |
  | `today` | `MyDayToday` (initial) | — |
  | `checkIn` | `MyDayCheckIn` | `{ typeKey }` |
  | `routine` | `MyDayRoutine` | — |
  | `routineNew` | `MyDayRoutineNew` | — |
  | `routineItem` | `MyDayRoutineItem` | `{ itemId }` |
  | `night` | `MyDayNight` | `{ date }` |
  | `nights` | `MyDayNights` | — |

  The adapter (`app/navigators/myDayNavigation.ts`) is a table keyed by `MyDayRoutes`, so a route My Day adds
  with no row here fails `npm run compile` (app packages amendment A6); `go(route, ...params)` must declare
  the rest parameter (README, "The two adapters"). The route-name and params mapping is pure
  (`myDayNavigationLogic.ts`, vitest). `back()` is `goBack()`; `openCrisisPath()` is D3; `signOut` is **not**
  passed (Settings owns sign-out here, so the today card shows no Sign out link).
- **Visibility** is one pure decision, `decideMyDayTabVisible({ isAuthenticated, isGuest, isPremium,
  dailyDashUrlEnv, platform })` (`app/utils/myDayTabLogic.ts`, vitest): signed in, not a guest, premium, a
  valid URL (D12), and not web. `MainNavigator` registers the `Tab.Screen` only when it holds, as it does the
  Agent tab, in D6's position.
- **Tab chrome:** label `mainNavigator:myDayTab` (nine locale files); icon an Ionicons glyph the builder picks
  in the family's weight (`sunny-outline` is my suggestion).
- **The tab's own gate.** My Day's hooks throw outside the client's data providers, which `ClientProvider`
  renders only once the session is `signedIn` and `useDb().state.phase` is `ready`; the reference host draws
  five blocking screens for the rest (`apps/app/src/boot/session-gate.tsx`). Here a `MyDayGate` component,
  the stack's root, draws inside the tab, in My Day's look, with copy in the nine locale files: **[My call]**
  - session `restoring`, the exchange in flight, or the database `opening` → a quiet loading screen;
  - the exchange failed (offline, the API down, a refused token) → "My Day couldn't connect" with **Try
    again**; it also retries by itself on the network's reconnect edge and on the app's return to the
    foreground, so an outage during one session does not strand the tab until the next sign-in;
  - the database `failed` → the client's message with **Reset My Day's local data** (`useDb().reset()`,
    which deletes only `dd-<hash>.db` and its key, nothing of ours) and the plain warning that writes not yet
    sent are lost; the server holds everything that was;
  - `accountDeleted` → the message, with **Restore** (`session.restoreAccount()`) while `recoverableUntil` is
    open and without it once closed;
  - `wrongAccount` → never shown; §4.4 resolves it by `releaseDevice()` before anything draws.
- `GuestNavigator`, the linking config and `decideAppRoute` are untouched. No deep links in v1.

### 4.6 Theme and surfaces

- `MyDayProvider theme={myDayTheme}`, where `myDayTheme` is the scheme's base (`dailyDashDark` or
  `dailyDashLight`, §5.1, chosen by `useAppTheme().theme.isDark`) with `colors.tint` and `colors.tintInactive`
  replaced by the app's `theme.colors.tint` / `tintInactive` (the tint picker's colour, already resolved by
  `ThemeProvider`, so the guest and default looks need no special case) and `colors.onTint` chosen for
  contrast on that tint (white or the scheme's text colour, by relative luminance; the app has no such helper
  today). A pure `buildMyDayTheme(base, { tint, tintInactive })` in `app/utils/myDayTheme.ts` (vitest),
  memoised on scheme and tint, so the app's toggle and its picker both switch My Day live (D4). `accent` stays
  the base's.
- `surfaces.photo`: the Dash's background set, one chosen per launch the way `apps/app`'s
  `coldStartBackground()` does (a pure pick, vitest; `pickBackground` there is the model). The eight Pexels
  JPEGs total 1.3 MB; copied as they are.
- `surfaces.Blur`: `({ surface }) => <BlurView intensity={surface === "card" ? 20 : 40} tint={isDark ? "dark" : "light"} experimentalBlurMethod={androidBlurMethod} style={StyleSheet.absoluteFill} />`
  (the README's recipe, with the tint following the scheme). **Android gets the native blur [Owner].**
  expo-blur draws a tinted overlay there by default (`'none'`). On the SDK 54 line (expo-blur 15.0.x) the
  Android prop is `experimentalBlurMethod?: 'none' | 'dimezisBlurView'`; the `dimezisBlurViewSdk31Plus` value
  and the `blurMethod` name arrive only with expo-blur 57 (verified against both packages 2026-11-04). So the
  host does by hand what that value does: `androidBlurMethod` is `"dimezisBlurView"` on Android 12+
  (`Platform.Version >= 31`) and `"none"` below, where the Dimezis view costs on scrolling screens (a pure
  `decideAndroidBlurMethod()`, vitest). The builder measures the Today and Nights screens on a mid-range
  Android 12+ device before merge; the overlay stays one value away if the blur does not hold up. The Expo
  upgrade later swaps the prop for `blurMethod="dimezisBlurViewSdk31Plus"`.
- `version`: `Application.nativeApplicationVersion`.
- Fonts load with the app's others in `customFontsToLoad`; the splash already waits on `useFonts`.

### 4.7 Copy and i18n

- `app/i18n/en.ts` gains a `myDay` namespace mirroring `MyDayCopy` (§5.2) leaf for leaf; the eight other
  locale files gain the same keys with English text (D7; a missing key is a `tsc` error). Entries that are
  functions in My Day (`week: (n) => …`, `version: (v) => …`) become interpolation strings
  (`"{{count}} this week"`).
- `app/utils/myDayCopy.ts` builds a `MyDayCopy` from `translate()`, memoised on `i18n.language`, and the tab
  passes it as `MyDayProvider copy={…}`; a language change re-renders the tab the way it re-renders the
  navigators today (`useTranslation`). A table test asserts every leaf of the package's `defaultMyDayCopy`
  has a key in `en.ts`, so a copy My Day adds surfaces as a failing test, not a missing string.
- Date and number formatting inside My Day follow the device locale through `Intl`, as the package does
  today; not changed here.

### 4.8 Logging, connectivity, analytics

- The logger adapter forwards `debug/info/warn/error` with fields; it never logs `cause` of a database
  failure, `accountHash` is the client's own hashed id and may be logged; nothing of the person (CLAUDE.md
  "Logging").
- `connectivity.reach` is informational; `onReconnect` fires on `NetworkStore.isOffline`'s true→false edge
  so the outbox drains when the network returns.
- `trackEvent` receives the client's session events; My Day's screens get `trackScreenView` from the stack's
  `state` listener like the other tabs.

### 4.9 Delete User Data

Settings → Delete User Data runs the Daily Dash teardown in the same sequence as ours:
`session.signOut("reset_local_data")`, which the client defines as deleting the account database and its
SecureStore key (and any kept file), then `resetLocalDatabase({ clearOwner })` for our own file, key and owner
record, then `reloadApp()` as today. The order keeps the rule of CLAUDE.md "Database Layer": a failure earlier
leaves the later records intact rather than orphaning a database. The Daily Dash call sits in the Settings
handler **beside** `resetLocalDatabase()`, not inside it: `resetLocalDatabase()` is also the database-error
overlay's Reset, which is about *our* file failing to open and must reset ours alone, and `app/db/` must not
grow a dependency on the Daily Dash client. This handler is the **only** place the Daily Dash database and key
are deleted (D8); `MyDayGate`'s "Reset My Day's local data" (§4.5) resets the Daily Dash file alone.

AMENDED 2026-11-04 (final review I-1): the database-error overlay's "Reset local data" also resets My Day's
local data. That reset clears `ownerSub`, which undoes the single-owner premise of §4.4: the next sign-in is
adopted whoever it is, and the client restores a stored Daily Dash session with no owner check, so a different
account would open the previous owner's My Day. The Daily Dash reset is now one function,
`resetDailyDashLocalData()` (`app/services/dailyDash/`), called from Delete User Data and, injected as a
`DatabaseProvider` prop from `app.tsx`, from the overlay's Reset, before `resetLocalDatabase()`. `app/db/` still
imports nothing of the client, and the function never throws, so it cannot block our own reset.

### 4.10 Documents

- `docs/manual/`: one page per My Day feature the user can see (Today, Check in, Routine, Rate your day,
  Grateful for), in the manual's voice and rules (README there; `pnpm --dir ../agent manual:ingest
  ../app/docs/manual --dry-run` before the commit). Sources: the package README and screens.
- `CHANGELOG.md` `[Unreleased]`: Added (the tab), Build (the deps, the native bump), Docs (manual).
- `CLAUDE.md`: a "My Day (Daily Dash)" section: what is vendored, the two adapters, the gate, the lifecycle
  rules, and that the Sky hand-off is §6 and not built.
- `TODO.md`: §6 and §8's open items.

### 4.11 Tests

Pure modules with vitest, as the repo does: `myDayTabLogic.ts`, `myDayNavigationLogic.ts`,
`dailyDashSignInLogic.ts`, the photo pick, the copy coverage table test. The adapters and the session gate are
I/O and are verified by hand on a device: sign in premium → the tab appears and `/v1/today` loads; toggle the
theme; pick a tint → My Day's controls follow it; change the language; log out and in → My Day shows the same
data, nothing wiped (D8); Delete User Data → both databases gone, the next sign-in starts My Day empty; a free
account never starts a Daily Dash session (check the API's logs for no exchange); on Android 12+ the glass
blurs and Today / Nights scroll smoothly, on Android 11 the overlay shows (§4.6). `buildMyDayTheme` and
`decideAndroidBlurMethod` join the vitest list.

## 5. What My Day grows for this host (`jenova-marie/the-daily-dash-app`)

A hand-off in the shape of the Sky moments design's §4: the Daily Dash session reads this section and its own
documents, and amends the app packages design (an A-numbered amendment) as it sees fit.

### 5.1 A light theme, and the scheme on the glass

- `packages/my-day` exports `dailyDashLight: MyDayTheme`, the Dash's **light** palette resolved onto
  `MyDayTheme` the way `dailyDashDark` was (D4). The drift test in `apps/app/src/my-day-host/theme.test.ts`
  gains the light twin: `ddTokensToMyDayTheme(resolveTheme({ ...themeDefaults, scheme: "light" }))` equals
  `dailyDashLight`.
- `cardGlass`, `headerGlass`, `textShadow` and `errorBackground` get light values (the Dash's `errorText.light`
  exists already). `MyDaySurfaces.Blur` keeps its signature; the host chooses the tint from its scheme (§4.6).
- `MyDayProvider` already takes `theme` as a prop and re-renders on change; nothing else to add for live
  switching. The README's "The theme shape" lists both constants.

### 5.2 The copy seam

- The six copy modules (`today-copy.ts`, `check-in-copy.ts`, `gratitude-copy.ts`, `night-copy.ts`,
  `quote-copy.ts`, `routine-copy.ts`) become one exported type `MyDayCopy` (`{ today; checkIn; gratitude;
  night; quote; routine }`, the modules' present shapes, functions included) and one exported value
  `defaultMyDayCopy` (today's English). `MyDayProvider` takes `copy?: MyDayCopy` (whole, not partial; a host
  spreads the default); screens and components read `useMyDayCopy()` instead of importing the modules.
- `apps/app` passes nothing and is unchanged. A missing or extra leaf fails typecheck in the host (D7).
- Not i18next inside the package: `apps/app` has no i18next, and a plain typed object serves both hosts.

### 5.3 Repack

- `publishConfig.exports["."]` of `sdk`, `client` and `my-day` gains `"default": "./dist/index.js"` beside
  `import` (and `./fixtures` likewise). RecoverySky's Metro resolves with the conditions `require`, `default`,
  `browser` only (§4.1), so an `import`-only manifest is unresolvable there; `pack:tarballs --check` proves
  Node resolution alone and never met Metro. The reference host imports workspace sources, so nothing changes
  for it.
- `pnpm pack:tarballs --check` at the new versions (my-day minor for §5.1, §5.2 and this; client and sdk
  patch for the condition); the files and names land in this repository's `vendor/` and `package.json`
  (§4.1). The present `dist-tarballs/` (0.1.0, 2026-10-11) are stale.

### 5.4 The API's allow-list

`AUTH0_RECOVERYSKY_CLIENT_IDS` on the Daily Dash API (production and any staging) gains this app's Auth0 client
id, so the exchange admits its bearers as the `recoverysky` product (ADR 0015: product context is the
application that presented the token). No code change.

### 5.5 For §6 only (`recoverysky-org/agent`)

Not for this build; recorded so it is not lost: this app's client id must **stay** in the agent's
`DD_APP_CLIENT_IDS` (its CLAUDE.md marks it for removal "until Daily Dash builds that borrowed it are gone");
and `daily-dash/1` strips the RecoverySky manual tools ("the wrong app inside the Daily Dash"), which is the
right app when the host is this one.

## 6. Follow-on: the Sky hand-off (not this build)

When My Day gains its `sky` capability (Sky moments design §7, Daily Dash plan 2, unbuilt) and the agent its
moment addenda (that design's §4, agent plan 1, unbuilt), this host passes `capabilities.sky` and routes every
moment to the **Sky Agent tab**, as that design anticipated ("the RecoverySky app would route `tab` to its own
`AgentScreen`"). What `AgentScreen` then needs, in order:

1. The `daily-dash/1` guide, a `conversation_id` and the `moment` on the chat body for conversations My Day
   opens (today it sends neither guide nor id and keeps history in encrypted SQLite); the agent holds those
   conversations' history (Sky chat design D8), so a second history model lives beside `ConversationStore`
   or replaces it. A decision for that design.
2. The **approval card** (`skyCardLogic` + `SkyCard`, `addToolApprovalResponse`,
   `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`): without it a Daily Dash
   write tool stalls at `approval-requested` with nothing to tap.
3. The `crisis-resources` part drawn as a card (AgentScreen renders text and tool parts only today).
4. Whether `bubble` moments open a sheet here or map to the tab; the moments table is the API's, so the
   mapping is the host's.
5. §5.5's two agent configuration items.

The meeting cards already in `AgentScreen` are what makes this hand-off richer than the Daily Dash app's own
chat, where `rowsOf` draws nothing for a static tool part.

## 7. Branching and release

- All work on **`feat/my-day-tab`**, as a worktree under `.claude/worktrees/` (the repo's pattern), so
  `root` keeps publishing 4.11.0-N OTAs meanwhile (D5). Nothing from this branch is OTA-published.
- The design document is committed on that branch, not on `root`.
- Merge to `root` only when the device checklist (§4.11) passes. Then the native release
  (CLAUDE.md "Native release"): `npm run minor` (→ 4.12.0; resets the OTA counter), set `runtimeVersion` to
  match by hand, `npm run release:ios` and `release:android`, then the manual ingest from the agent repo
  against production, then the tracker's `fix-deployed` pass for any `(RS-NNN)` tag in the release block.
- Order with the other repositories: §5.1–§5.3 and §5.4 first (the host cannot build without the tarballs, nor
  sign in without the allow-list); the agent's §5.5 any time before §6.
- Before the store build: `EXPO_PUBLIC_DAILY_DASH_API_URL=https://api.the-daily-dash.com` in `eas.json`
  `build.base.env` and the EAS production environment (D12; `npm run check:env`), and that host promoted to
  production on the Daily Dash side (§5.4 lands on the same deployment). Premium users' recovery data goes to
  it from the first store build, so the promotion is a release prerequisite, not a follow-up.

## 8. Open items

- **Daily Dash tokens on sign-out** (§4.4): v1 leaves the Daily Dash session record on the device through a
  sign-out, as it leaves ours. If that should change, Daily Dash adds a sign-out reason that keeps the file
  (the `sky_sign_in` path under a host's name) and the host calls it from logout; nothing is deleted either
  way (D8).
- **Relinked identities** (§4.4): a relink presents a new sub and the Daily Dash platform treats it as a new
  account. Flag to the Daily Dash team; no change here.
- **Photo weight** (§4.6): the builder measures and decides downsampling.
- **Web:** hidden in v1; needs COEP/COOP headers and `wasm` in Metro's `assetExts` to lift.
- **`/config` for the URL** (D12): a later API-repo change.

## 9. Left to the builder

The logger adapter's exact shape; the `Blur` component's file; the Ionicons glyph; how `DailyDashSessionGate`
subscribes to the session (`subscribe`) and to `isPremium`; which `app.tsx` line `ClientProvider` sits on,
within §4.2's constraints; the manual pages' wording within the manual's rules; the photo pick's seed; the
test names.
