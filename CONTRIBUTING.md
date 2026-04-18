# Contributing to RecoverySky App

Thanks for your interest in contributing! 💜 RecoverySky exists to help people in recovery find meetings and track their journey, and contributions of every size — bug reports, doc fixes, translations, code — are welcome.

This guide covers the conventions that keep the codebase coherent. Most of these conventions also live in [`CLAUDE.md`](CLAUDE.md) (which is the source of truth for tooling-driven contributors); this document is the human-friendly version.

---

## Code of Conduct

Be kind. Be patient. Many users of this app are in early recovery and many contributors are too. Disagreements about code are fine; disrespect toward other people is not.

If something feels off — in an issue, a PR review, or a discussion — please flag it to the maintainers privately at `support@recoverysky.org`.

---

## Getting Started

```bash
git clone https://github.com/recoverysky-org/recoverysky-app.git
cd recoverysky-app
npm install              # MUST be npm — pnpm/yarn break native module resolution
npm start                # Expo dev client (Metro)
```

Day-to-day commands and platform builds are documented in the [README](README.md#-getting-started). The short version:

- `npm run ios` / `npm run android` / `npm run web` — run on a target.
- `npm run compile` — TypeScript check (no emit).
- `npm run lint` — ESLint with auto-fix.
- `npm test` — Jest + Vitest.

Native module changes require a rebuild (`npm run build:ios:sim`, etc.) — Expo Go can't load them.

---

## Branching & Pull Requests

1. Fork the repository (external contributors) or create a topic branch (maintainers).
2. Branch off `main` (or the current default).
3. Branch naming is loose; we suggest `feat/<short-topic>`, `fix/<short-topic>`, `docs/<short-topic>`.
4. Keep PRs focused — one logical change per PR is much easier to review than five mixed.
5. Run `npm run compile && npm run lint` before opening the PR.
6. Update [`CHANGELOG.md`](CHANGELOG.md) (see the Changelog Discipline section below).
7. Open the PR with a description that explains the *why*, not just the *what*. Link any related issues.

Reviewers will look for: behavior accuracy, edge cases, accessibility (VoiceOver), i18n coverage, and whether comments + CHANGELOG were updated alongside the code.

---

## Commit Messages

We use **conventional commits with emoji prefixes**. Format:

```
<emoji> <type>(<scope>): <subject>

<body>

Authored-By: Your Name <you@example.com>
```

Common emoji prefixes:

| Emoji | Type | When |
|-------|------|------|
| ✨ | `feat` | New user-visible feature |
| 🐛 | `fix` | Bug fix |
| 📝 | `docs` | Documentation only |
| 🎨 | `style` | Formatting / copy / non-logic UI tweak |
| ♻️ | `refactor` | Code restructuring with no behavior change |
| 🧪 | `test` | Tests added or updated |
| 🔥 | `perf` | Performance improvement |
| 🏗️ | `chore` | Tooling / build / scripts |
| 🔒 | `security` | Security fix or hardening |
| 📦 | `deps` | Dependency bump |
| 🔧 | `config` | Configuration change |
| ♿ | `feat(accessibility)` | A11y additions (also valid as a `feat`) |

Subject line:
- Imperative mood ("add", not "added").
- Lowercase after the type.
- No trailing period.
- Under 72 characters.

Body:
- Wrap at ~72 characters.
- Bullet points or short paragraphs.
- **Explain the why.** What problem does this solve? What constraint shapes the solution?
- Reference issues or prior commits when relevant.

Example:

```
🐛 fix(zoom): prevent attendance timer from resetting on app foreground

SchedulePopup is an observer and re-renders on every MobX notification
(including the AppState change when Zoom hands focus back). It was
inlining the modal's `meeting` prop as a fresh object literal each
render, so the modal's effect torn down and restarted the timer —
zeroing elapsed and re-launching Zoom. Memoized the payload in the
parent and switched the modal's effect to depend on stable primitives.

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

## Code Style

### Languages & tooling

- **TypeScript** everywhere. `npm run compile` must pass.
- **ESLint** with auto-fix. `npm run lint:check` must pass in CI.
- **Dependency cruiser** (`npm run lint:deps`) prevents circular imports and enforces module boundaries.

### React / React Native

- No default React import. Use named imports: `import { useState, useEffect } from "react"`.
- No `SafeAreaView` from `react-native` — use `react-native-safe-area-context`.
- No raw `Text`, `Button`, or `TextInput` from `react-native` — use the `@/components` wrappers (themed, i18n-aware).
- Wrap MST-consuming components with `observer()` from `mobx-react-lite`.
- Prefix unused variables with `_`.
- Extract `ListHeaderComponent` into standalone `observer` components, not inline `useCallback` (avoids FlatList focus-loss bugs).

### Imports — sort order

1. React
2. React Native
3. Expo packages
4. External packages (`mobx-react-lite`, etc.)
5. Internal `@/` aliases
6. Relative imports

### Storage

Use `app/utils/storage/` (MMKV-backed). Do **not** use AsyncStorage.

### i18n

Strings shown to users **must** go through i18next. Use `tx` / `txOptions` props on `Text` components, or `useTranslation()` / `translate()` for non-component code. Add the key to `app/i18n/en.ts` *and* every other locale file (typecheck enforces this) — fall back to English copy in unfamiliar languages rather than leaving them missing.

---

## Comments

This project intentionally **overrides the default minimal-comment style**. The codebase carries a lot of subtle, history-driven behavior (MobX re-render gotchas, MMKV persistence rules, Zoom SDK quirks, OTA `runtimeVersion` semantics, attestation flow), and we want that knowledge captured at the call site — not just in commit messages.

**Write comments liberally** when:

- A line exists for a non-obvious reason (workaround, third-party SDK constraint, iOS/Android divergence, a race we already hit once).
- A choice could plausibly be "fixed" by a future contributor in a way that re-introduces a real bug (suspicious-looking deps arrays, defensive-looking gates, fields that look unused but feed a downstream consumer).
- An invariant has to hold across files.
- A magic number or threshold has a story (timeouts, retry budgets, credit floors).

**Keep comments accurate.** If you change code that has a comment, the comment is part of the change — updating it is mandatory.

**When changing existing behavior**, do *not* delete the original functional comment. Keep it (it still describes what the code does) and append a brief `CHANGED YYYY-MM-DD: …` note explaining *why* the change was made. This produces a small living log at the call site:

```ts
// Cleanup runs on visibility change so the timer state resets.
// CHANGED 2026-04-18: cleanup no longer clears the persisted MMKV session;
// that's owned by handleSave/handleCancel so a process kill mid-meeting can
// be recovered by TimerSessionResumer instead of silently dropped.
return () => {
  if (intervalRef.current) clearInterval(intervalRef.current)
  // ...
}
```

The "why" line should reference the specific failure mode or motivation, not just "refactored" or "improved". If the original behavior is fully gone (not just changed), it's fine to remove the original comment and write a fresh one — but the bar for "fully gone" is high.

---

## Changelog Discipline

[`CHANGELOG.md`](CHANGELOG.md) lives at the repo root. After making any user-visible or behavior-changing edit, add an entry **before opening the PR**.

**Where entries go:**
- During development, add to `## [Unreleased]`. Group entries under `Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security` / `Docs` / `Build`.
- When cutting a release, the maintainer moves `[Unreleased]` content under a new versioned heading.

**What to include:**
- Why the change matters to a future maintainer or release-notes reader — not the implementation detail.
- Cross-reference the subsystem when it helps (e.g. "external Zoom attendance timer", not just a filename).
- Bug fixes should describe the user-visible failure mode, not just the patch.

**What to skip:**
- Pure refactors with no user-visible behavior change.
- Doc-only edits to internal files (CLAUDE.md, EVENTS.md) unless they encode policy a contributor needs to know about.
- Test-only additions.

The release scripts (`bump-version.sh`, `bump-update.sh`) deliberately do **not** auto-update the changelog — that's a discipline step, not a tooling step. Update it in the same commit as the change so reviewers see the rationale next to the diff.

---

## Testing

```bash
npm test                       # Vitest (unit) + Jest (component)
npm run test:unit              # Vitest only
npm run test:unit:watch        # Vitest watch mode
npm run test:component         # Jest only
npm run test:maestro           # Maestro e2e flows (requires Maestro CLI)
```

Tests are not yet exhaustive; new tests for fixed bugs are very welcome.

---

## Releases

Two release shapes (see [`CHANGELOG.md`](CHANGELOG.md) for the convention):

- **Native release** — `npm run patch` / `npm run minor` / `npm run major`. Bumps `version` in both `package.json` and `app.json`, commits, tags, pushes, then runs `prebuild:clean`. A new App Store / Play Store / TestFlight build is then required.
- **OTA release** — `npm run update`. Bumps the `update` counter in `package.json`, commits as `🔖 ota: vX.Y.Z-N`, tags, pushes, then runs `eas update --branch production --auto`. Reaches every user already on a matching `runtimeVersion`.

Bump `runtimeVersion` (in `app.json`) **before** publishing an OTA whenever any of the following changed since the last native build:

- Native dep added / removed / upgraded (anything that adds native code)
- `app.json` native config (permissions, plugins, bundle ID, splash, etc.)
- `ios/Podfile` or CocoaPods configuration
- `android/build.gradle` or native Android config
- EAS build plugins
- Expo SDK version

Otherwise the published OTA targets a runtime no installed user has, and reaches no one. Reset `package.json` `update` to `"0"` on each native version bump.

---

## Internationalization

We support 9 locales: English, Spanish, French, German, Portuguese, Russian, Ukrainian, Arabic, Thai. When you add a new translation key:

1. Add it to `app/i18n/en.ts` first (this defines the type).
2. The TypeScript compiler will then complain about every other locale file missing the key — add it to each.
3. If you don't speak a language, English fallback copy is acceptable as a stopgap (note in the PR description that translation help is welcome).

---

## Accessibility

VoiceOver / TalkBack support is a first-class concern. Newly added interactive elements should include:

- `accessibilityRole` (e.g. `"button"`, `"link"`, `"radio"`)
- `accessibilityLabel` (translated where relevant)
- `accessibilityHint` for non-obvious actions
- `accessibilityState` (`disabled`, `selected`, `busy`, etc.) where it changes

For lists, prefer `accessibilityActions` over hidden buttons when a row has multiple actions.

---

## License

This project is licensed under [GNU Affero General Public License v3.0](LICENSE.md). By contributing, you agree your contributions will be licensed under the same terms.

If you run a modified version of this app as a network service, the AGPL requires you to make the modified source code available to the users of that service.

---

## Need Help?

- 📧 `support@recoverysky.org` for private questions or sensitive issues.
- 📝 Open a GitHub issue for bugs and feature requests.
- 💜 If you're nervous about a first PR, that's normal — open a draft PR and ask for guidance. We'd rather help you ship than have you not contribute at all.

---

Thanks again for being here. One day at a time. 🌤️
