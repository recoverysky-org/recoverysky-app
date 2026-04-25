# Journal

**Entry:** 2026-04-24 09:22 CDT
**Covers:** the preceding 24 hours on branch `root`

## What we did

Jenova and I spent the day tightening several rough edges in the RecoverySky
app rather than building any new user-facing feature.

The biggest piece of work was on **device attestation**. Previously every
failure — whether Apple App Attest had a hiccup, whether our backend rejected
the assertion, or whether the device couldn't do attestation at all —
collapsed into a single misleading "check your internet connection" alert,
and users sat through four retries before they saw it. I enriched the
attestation error model so we can tell those cases apart, short-circuited
the retry loop on errors that won't recover, and split the alert copy into
matching variants across all nine supported locales. Jenova briefly asked
me to wire in an `EXPO_PUBLIC_AUTH_KEY` fallback for graceful degradation
but then decided against it and we reverted that piece.

We also added a small **escape hatch on the external Zoom attendance timer**:
tapping the timer readout seven times within 2.5 seconds force-saves the
record regardless of whether the credit-minute threshold was met. It's a
support path for meetings that ran long in real life but the timer captured
late.

On **attendance tracking**, we tagged the `processed` event with its capture
source (`"sdk"` vs `"external-timer"`) and Jenova documented a new
`attendance_validated` analytics event in `EVENTS.md` that rides on top of
it, so analytics can finally distinguish the two flows downstream.

On the **Home screen**, we simplified the news-announcement card to be
non-dismissible — the server now owns visibility gating, and the client
no longer tracks dismissed content locally. That let us remove the
`dismissedNews` field from `ProfileStore` and the slide-out animation
from `NewsCard`.

In **Settings**, Jenova asked me to disable the "Send Error Report" button
in Advanced, then asked me to hide it instead — so I did both as separate
commits, which read together as a small trail of the decision.

Finally, a couple of quiet housekeeping items: I enriched the `/config`
fetch-failure log with the full URL and HTTP status so future environment
misconfigurations are obvious in OTLP, and Jenova cut two OTA releases
(`v4.3.3-2` and `v4.3.3-3`) to ship all of the above to existing installs.

## Commits in scope

- `095889e` feat(attestation): differentiate failure cases and short-circuit retries
- `9d53641` feat(attendance): add 7-tap shortcut to force-save external Zoom timer
- `fe0bd8a` style(settings): disable Send Error Report button in Advanced
- `ee045a0` style(settings): hide Send Error Report button in Advanced
- `58f06a7` feat(attendance): tag processed events with capture source
- `3228a87` refactor(home): make news card non-dismissible
- `b81e154` chore(api): enrich /config failure log with URL and status code
- `2a30796` ota: v4.3.3-2
- `8db5fbf` ota: v4.3.3-3

---

## Postscript — attestation was a red herring

After shipping the attestation error-case work, Jenova traced the actual
outage and it had nothing to do with attestation or our API at all.
CrowdSec was blocking the app because the Umami analytics endpoint was
returning 403, and Alloy was also returning errors. The attestation
symptoms we were chasing were downstream of that — the code changes we
landed are still useful defensively, but the incident itself was a
platform-side block, not a client-side or backend-attestation bug.

