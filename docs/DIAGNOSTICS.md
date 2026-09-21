# No Meetings
probably a device attestation failure

# Identifiers in logs

Every OTLP log record (→ Loki) carries these identity attributes, set via
`logger.setContext()` in `app.tsx`. They are also emitted as OTel Resource
attributes under the canonical names in parentheses.

| Attribute    | Resource key      | Value                                            | Lifetime            |
| ------------ | ----------------- | ------------------------------------------------ | ------------------- |
| `sessionId`  | `session.id`      | random per process launch                        | one cold start      |
| `appVersion` | `service.version` | `{version}-{update}` (native + OTA counter)      | static              |
| `deviceId`   | `device.id`       | install-scoped UUID (survives sign-in/sign-out)  | until reinstall     |
| `userId`     | `user.id`         | **hashed** Auth0 `sub` (`hashUserId()`, 16 hex)  | signed-in only      |

**`userId` is never the raw Auth0 `sub`.** The sub embeds the identity
provider and its account id (`google-oauth2|1098…`), which is
cross-referenceable with a third party; a recovery app's logs sit next to
meeting names and attendance events, so the raw value would make every line
health-adjacent personal data tied to a Google/Apple account. The hash is a
truncated SHA-512 (tweetnacl, pure JS) — pseudonymous, not anonymous: it is
still personal data under GDPR, but nothing in the log alone reverses it.

**Looking up a user's logs (support workflow):**

```bash
# Get the user's Auth0 sub from the Auth0 dashboard, then:
node -e 'const n=require("tweetnacl");const d=n.hash(new TextEncoder().encode(process.argv[1]));console.log(Buffer.from(d.subarray(0,8)).toString("hex"))' 'auth0|abc123'
```

Query Loki with `{service_name="recoverysky-app"} | userId="<hash>"` (or
`user_id` if the collector promoted the Resource attribute).

**Reach of that lookup by build (RS-026, fixed 2026-09-16).** On builds before
the fix, a child logger snapshotted the context at creation, so every
module-scope logger (`Api`, `AuthStore`, `ConfigStore`, `sqliteKey`, `App`,
…) emitted lines with **no `userId` and mostly no `deviceId`** for the whole
session; only component loggers created after sign-in carried them
(measured 2026-09-16: 45 % of lines had a `userId`). For those builds, find
the session another way — `| sessionId="…"` from a line that does carry the
hash, or `module="LoginScreen"`/`useAuth0Wrapper` lines near the report time
— and then widen to the whole session. On fixed builds every line after the
`setContext` call carries all four fields, so the `userId` filter alone is
complete. The same bug left 12 % of lines (`App`, `deviceId`, `ErrorHandler`,
`sentry`) with no `appVersion` label at all; those cannot be version-filtered
on old builds, and `service_version` on them is the bare package.json
version without the OTA counter.

**Never logged, in any field, at any level:** the report recipient's email
address, the user's own email, `shortName`, and raw coordinates. Structured
metadata counts — Loki indexes it just as well as line text, and
`| email!=""` is exactly how the last leak was found (RS-025, 2026-09-15: the
report send path attached the recipient address to six log calls across
`Api` and `ReportSender`, ~100 lines per 48 h, spanning every build). The
recipient is a third party — a sponsor, court officer, or employer — who never
consented to our telemetry. When you need to tie a line to a recipient, log
`reportId`; the encrypted report row and the API both resolve it.

**Sentry and Umami are different.** Both receive `authStore.userIdentifier`
(the raw sub, or `deviceId` when anonymous) via `setSentryUser` /
`setTrackingUserId`, because their UIs group by user id and a hash would
break the link to the Auth0 dashboard. Sentry's PII policy lives in the
header of `app/services/crashReporting/sentry.ts`.

**Privacy-policy dependency:** the policy must list a diagnostic identifier
and the Loki retention window. The policy is not in this repo — re-check it
whenever this table changes.

# Log levels

ADDED 2026-09-21 (RS-039). Before this the app reserved ERROR for a handful
of infrastructure faults and logged the failures a user actually feels at
WARN, so the dashboard's Errors tile read 0 for the whole fleet and was
*right* — anything alerting or triaging on ERROR was blind. The level is the
signal; pick it by what the user experienced, not by how surprised the code
was.

| Level   | Means                                                                 | Examples                                                                              |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `fatal` | The app cannot continue                                               | attestation blocked, RootStore init failed                                             |
| `error` | **A user-visible operation failed, or a session was lost**            | report send rejected, forced logout, maintenance mode entered, sign-in error shown     |
| `warn`  | Degraded, retried, or recovered — the user may notice, nothing is lost | one venue pool failed (partial list), sync push backing off, token refreshed late      |
| `info`  | State changes and recovery actions                                    | signed in, timer session restored, credit clamped to the daily max, backfill 404      |
| `debug` | Transport and idempotency no-ops                                      | every `Api` request/response line, "already initialized, skipping"                    |
| `trace` | Per-frame / per-row detail                                            |                                                                                       |

Rules that fall out of the table:

- **The `Api` module logs transport at `debug` and never judges severity.**
  It does not know what the user was doing, so `Report detail fetch failed`
  from a background backfill and from a user tapping a report look identical
  to it. The **caller owns the level**: every non-`ok` result that matters
  gets one line from the module that can judge it. Before 2026-09-21 the two
  layers each logged the same failure at WARN, and ~2,000 of 4,205 weekly
  WARN lines were that duplicate.
- **`kind` is not a severity.** `not-found` is a normal answer for a lookup
  (`checkFirebaseUser` for a new user, a report body Firebase never had).
  Don't build a dashboard failure signal from `kind` alone.
- **A retried failure is `warn` until the retry budget is spent**, then the
  terminal outcome gets the level the user experiences: a config poll that
  exhausts its ladder and flips `maintenanceMode` is `error`; the same ladder
  giving up while the device is offline is `warn` (nothing we can fix).
- **Known-benign storms go to `info`**, not `warn`, with the RS number in the
  code comment — e.g. `upsertToken` before sign-in (RS-012), report-body 404
  backfill (RS-018).

Production ships `EXPO_PUBLIC_LOG_LEVEL=trace` (`eas.json`), so moving a line
to `debug` changes what a dashboard counts, not what Loki stores.
