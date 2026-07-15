# RecoverySky — App Store Listings

Paste-ready store copy for Google Play and the Apple App Store.
Keep this file in sync whenever the listing changes.

Voice: warm, plain, addict-to-addict — *not* a spec sheet. The undercurrent is
**"you have to want it, and wanting it starts small."** Say the outcome, never the
mechanism (e.g. we promise *"the link always works,"* we never describe the
verification bot). We do **not** advertise unreleased features (Sky AI, Social).

---

## Google Play

**Title** (30 / 30)

```
RecoverySky AA NA CMA Meetings
```

**Short description** (75 / 80)

```
Live AA, NA & CMA meetings happening now. Find one, log on, and just listen.
```

**Full description** (~3,200 / 4,000)

> **There's a meeting happening right now — and someone in it is exactly where you are.**
>
> RecoverySky is a live online meeting finder for AA, NA, and CMA. Find a meeting that's on right now and join it through Zoom — and like a lot of us started, you can just log on and listen.
>
> The trick to recovery is simple, even when it's hard: you have to *want* it. And wanting it starts small — wanting to find an app that helps, wanting to find a meeting, wanting to log on, wanting to hear someone who started right where you are — and found what you're looking for. RecoverySky exists to make that first step the easy one.
>
> **Find a meeting when you need one**
> • See AA, NA, and CMA meetings that are live *right now*
> • Search and filter by program, day, and time
> • Browse each meeting's full weekly schedule, so you always know when it's on
> • One tap takes you from the listing straight into the meeting
>
> **Meetings that actually open**
> Broken links. Wrong passwords. "This meeting has ended." When you finally reach out, the last thing you need is a door that won't open. RecoverySky keeps meeting details current and constantly checks that live meetings are really live — so when you tap to join, you get a room, not a dead end. *(Meetings open in Zoom Workplace — free, just have it installed.)*
>
> **Your recovery, in one place**
> • Clean-time tracker and milestones
> • Money-saved tracker
> • The 90-in-90 challenge
> • Meeting history and a simple picture of your progress
> Your recovery is personal, so it stays that way — your data lives encrypted on your device.
>
> **The easiest way to meet a supervision requirement**
> If someone needs proof that you're showing up — drug court, DFS, probation, parole, a sponsor, or a treatment team — RecoverySky is the simplest way to attend online meetings and show it. Your attendance becomes a clean, digitally-verifiable PDF, emailed straight to whoever's asking. Unlimited reports with RecoverySky Premium ($6.99/mo). Premium also unlocks:
> • Meeting reminders, so you don't miss the one you meant to make
> • Secure cloud backup
> • Sync across your phone, tablet, and devices
> • And it keeps RecoverySky alive and growing
>
> **Built by someone who needed it**
> RecoverySky was made in recovery, for people in recovery — by someone who found a community of strangers online and slowly started to feel human again. Log on, and listen. That's the whole idea.
>
> **A nonprofit you can trust**
> RecoverySky is a 501(c)(3) nonprofit organization. We don't track you, and we don't sell your data — the only thing we'll ever sell is the subscription that keeps the app running. That will never change. Our platform is built and operated on HIPAA-compliant AWS infrastructure, because we take your security and privacy seriously.
>
> You don't have to have it all figured out. You just have to want it, a little. Open the app, find a meeting — we'll be here. 🌤️
>
> Learn more at recoverysky.app
>
> ⸻
> RecoverySky Premium is $6.99/month. Payment is charged to your Google Play account at confirmation. Your subscription renews automatically unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your Google Play account settings.

**Keywords:** Google Play has no keyword field — it indexes the title, short
description, and full description. Coverage is already dense: *live, online,
meeting finder, AA, NA, CMA, find a meeting, recovery, attendance, verified,
supervision, court, probation, Zoom.*

---

## Apple App Store

**App Name** (30 / 30)

```
RecoverySky AA NA CMA Meetings
```

**Subtitle** (28 / 30) — adds keywords the name doesn't already carry

```
Live recovery meeting finder
```

**Promotional text** (~135 / 170) — updatable anytime without review

```
Find a live AA, NA, or CMA meeting happening right now — the link works, the room is real. Log on, and like a lot of us started, just listen.
```

**Keywords** (Apple 100-char field, comma-separated, no spaces)

Apple indexes the **name + subtitle + keyword field** together and builds search
combinations across them, so we do NOT repeat words already in the name
(`aa`, `na`, `cma`, `meetings`) or subtitle (`live`, `recovery`, `meeting`,
`finder`). That frees room for higher-value terms.

Optimized (89 / 100):

```
online,virtual,attendance,verified,pinkcloud,zoom,find,sober,anonymous,group,court
```

Simple fallback (matches the maintained keyword list, 93 / 100):

```
aa,na,cma,meetings,online,virtual,recovery,attendance,verification,pinkcloud,zoom,find,finder
```

Notes:
- `meetings` covers `meeting` — Apple stems plurals, so we don't spend characters on both.
- `pinkcloud` is deliberate competitor-conquesting (rival app is "Pink Cloud").
- `court` is high-intent for the supervision audience (our paying users) — kept.

**Description** — same body as Google Play, minus the Google-specific
subscription block. Apple shows subscription terms from the App Store Connect
configuration; the closing lines below satisfy Apple's disclosure requirement.

> *(Identical to the Google Play full description above, through "Learn more at recoverysky.app", then:)*
>
> ⸻
> RecoverySky Premium is $6.99/month. Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless it is canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your Apple Account settings.
> Terms of Use: https://www.recoverysky.app/terms
> Privacy Policy: https://www.recoverysky.app/privacy

---

## Decisions & rationale (so future-you remembers why)

- **Dropped "Find your pink cloud" as the slogan.** It's lovely recovery language,
  but the top competitor is literally named *Pink Cloud* — using it as our tagline
  reinforces their brand and muddies the listing. (Kept `pinkcloud` as a *keyword*
  to capture their searchers — the opposite move.)
- **Hugo stays invisible.** We promise the outcome ("the link always works, live
  meetings are really live"), never the mechanism (a bot auto-joining meetings to
  verify would unsettle users).
- **No "no account / no setup" claims.** RecoverySky requires an account, and
  joining requires the free Zoom Workplace app installed. Both are stated plainly.
- **"We don't track you / don't sell your data"** — chosen over "we collect no
  information," because the app requires an account and offers cloud backup/sync,
  which Google's mandatory Data Safety form will disclose. A blanket "we collect
  nothing" would contradict that form and risk rejection.
- **Sky AI + Social feed are NOT advertised** — they're built but hidden behind the
  premium gate pending content. Advertising unavailable features invites 1-star
  reviews and policy risk.
