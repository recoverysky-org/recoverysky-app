# No Meetings
probably a device attestation failure

# Identifiers in logs

Every OTLP log record (→ Loki) carries these identity attributes, set via
`logger.setContext()` in `app.tsx`. Lines logged at cold start before a key
was known (`App module loaded`, `getDeviceId()`, `Database opened`, …) have
it filled in at flush time; a key that was set to `undefined` (anonymous
user, sign-out) is never filled in afterwards.

| Attribute    | Value                                            | Lifetime            |
| ------------ | ------------------------------------------------ | ------------------- |
| `sessionId`  | random per process launch                        | one cold start      |
| `appVersion` | `{version}-{update}` (native + OTA counter)      | static              |
| `deviceId`   | install-scoped UUID (survives sign-in/sign-out)  | until reinstall     |
| `userId`     | **hashed** Auth0 `sub` (`hashUserId()`, 16 hex)  | signed-in only      |

**One spelling from 4.10.1-9 on (RS-042).** Earlier builds also sent the
identity as OTel Resource attributes (`session.id` / `device.id` /
`user.id`), which Loki surfaces as `session_id` / `device_id` / `user_id`.
Those were stamped at *flush* time, so every cold-start line carried only
the snake_case spelling and `| userId="<hash>"` missed ~35 lines per launch.
For windows that include older builds, match both:
`| userId="<hash>" or user_id="<hash>"` (`bin/loki user` already does).

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

Query Loki with `{service_name="recoverysky-app"} | userId="<hash>"` — plus
`or user_id="<hash>"` for builds before 4.10.1-9 (see the table note above).

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

### Ownership lines (2026-09-17)

Passwordless login and wrong-account recovery (spec
`2026-09-17-device-owner-and-wrong-account-recovery-design.md`) add their own
log lines. As with everything above, only the `hashUserId()` form of a sub is
ever logged — never the raw value, never an email address.

| line | module | ids |
| --- | --- | --- |
| `Device owner adopted` | `useAuth0Wrapper` | `ownerId` (hashed) |
| `Owner stamped from hydration` | `RootStore` | — |
| `Foreign session on an owned device` | `useAuth0Wrapper` | `ownerId`, `sessionId` (both hashed), `loginMethod` |
| `Foreign identity linked` | `linkForeignIdentity` | `linked`, `reason`, `moved` |
| `Foreign identity link failed` | `linkForeignIdentity` | `problem` (API problem kind) |

Umami also gets three events from this flow, none carrying identifiers:
`wrong_account_shown` (`proof` — which proof method the screen offered),
`wrong_account_cancelled`, and the existing `login_code_sent` /
`login_completed` (`method`) events, now also fired for the email path.

**Support lookup for "I signed in and my meetings are gone":** search Loki
for `Foreign session on an owned device` scoped to the device (`deviceId` is
on every line — see the identifiers table above); `ownerId` in that line is
the account that actually holds the data. If the user since cancelled and
walked away, there is no further trace — `WrongAccountScreen` never wrote
anything to local storage.

# Tracing

ADDED 2026-09-21. The app starts a distributed trace for every RecoverySky
API request and records no spans of its own: the auth gate sends a W3C
`traceparent` header with a fresh random trace id, and the response monitor
writes one `"API request"` debug line (module `Api`) with `method`, `url`
(query string stripped), `status`, `durationMs`, `problem` when there was
one, and `traceId`. The API's OpenTelemetry http instrumentation continues
the id, so its pino lines carry the same `traceId` and Tempo stores the
server-side trace under it. Ids are random per request and identify nothing.

**From an app symptom to the server's side of it:**

```logql
# 1. The app's line for the request (structured metadata, no regex needed)
{service_name="recoverysky-app"} | module="Api" | status="401" | url="/config"
#    → copy traceId from the line

# 2. The API's lines for the same request (container stdout via the per-node
#    Alloy, so the stream label is the swarm service name; pino JSON with
#    traceId in the body)
{service_name="app_api"} |= "<traceId>"

# 3. The trace itself: Explore → Tempo → TraceQL
{ trace:id = "<traceId>" }
```

Tempo keeps 72 h of blocks (`stacks/observability`), Loki 31 days — after
three days only steps 1–2 work.

Verified live 2026-09-22 against api 1.12.1: the app's `GET /schedules/live`
id resolved in Tempo to a `SERVER` span whose parent is the app's span id,
with the Express middleware / router / handler children under it; `/config`
and `/status` ids 404 in Tempo because the API's `ignorePaths` drops them.
`tempo.rso` answers `GET /api/traces/<id>` and `/api/search?tags=…` from the
workstation (plain http, via the ingress Caddy).

**Stacks-side prerequisites** (not in this repo; check before assuming a
missing trace is an app bug):

- The API exports spans only when Infisical sets `API_OTEL_TRACE_EXPORTER=otlp`
  and `API_OTEL_TRACES_ENDPOINT=http://ingress_alloy:4318/v1/traces`
  (`stacks/app/stack.yml` defaults to `console` / empty; the trex-engine,
  scraper and hugo entries in the same file show the working shape). Until
  then step 3 finds nothing and steps 1–2 still work.
- Step 2 needs the API's console transport to print `traceId`: its
  `wonder-logger.yaml` `includeFields` lists only `version` as of 1.12.1, so
  the id the traceContext plugin stamps never reaches stdout → Loki. Until
  `traceId` (and `spanId`) are added there, go app line → Tempo directly
  (steps 1 and 3), and use the API's `requestId` for its own lines.
- The app marks every request sampled, and the API's sampler is ParentBased,
  so the API's `sampleRate` does not apply to app traffic — only to requests
  with no `traceparent` (probes, webhooks, curl). If `/config` polls need to
  stay out of Tempo, that is the API's route-based ignore list, not a flag on
  the app side: the app can't know which poll will be the one that fails.
- Grafana's Loki datasource links `traceId` to Tempo with a regex over the
  line body (`"traceId":"(\w+)"` in
  `stacks/observability/grafana/etc/provisioning/datasources/datasources.yml`).
  That matches the API's pino lines. The app's `traceId` is structured
  metadata, not body text, so the click-through from an app line needs a
  second derived field with `matcherType: label` on `traceId`. Step 1's copy
  and paste works regardless.

# Network quality & the internet oracle

ADDED 2026-09-28. Three signals answer "is it the phone or is it us?":

1. **`"Device network state changed"`** (module `NetworkMonitor`): logged on
   an `isOffline` change or a change in NetInfo's reachability probe, with
   `netType`, and `cellGen` / `carrier` on cellular or `wifiStrength` on
   Android Wi-Fi.
2. **The internet oracle**: after a retry ladder ends with *no answer at all*
   (every attempt `cannot-connect` / `timeout`), the app fetches
   `https://1.1.1.1/cdn-cgi/trace` and `https://8.8.8.8/resolve?…` in
   parallel with a 3 s budget (`services/network/oracle.ts`). The result rides
   on the ladder's terminal line (`Config poll failed … no answer`,
   `/status/ready precheck exhausted retries`, `Config fetch failed … env var
   defaults`) as `oracleReachable`, `cloudflareOutcome` / `cloudflareMs`,
   `googleOutcome` / `googleMs`, plus the network fields. `oracleReachable:
   false` means neither provider answered, so the device's internet was down.
   `true` means the internet worked and only we were unreachable from that
   network, which points at a network that blocks us or an edge (CrowdSec)
   ban. The oracle never runs on healthy sessions, because it reveals the
   device IP to Cloudflare and Google.
3. **`"API request"`** (module `Api`, debug level; production ships
   `trace`): every request carries `durationMs` and the same network
   fields. That makes it the per-device latency baseline.

```logql
# Devices with the worst typical latency to our API (median, last day)
topk(20, quantile_over_time(0.5,
  {service_name="recoverysky-app"} | module="Api" |= "API request"
  | durationMs!="" | unwrap durationMs [1d]) by (deviceId))

# Same, split by network — which users are slow only on cellular?
quantile_over_time(0.5,
  {service_name="recoverysky-app"} | module="Api" |= "API request"
  | durationMs!="" | unwrap durationMs [1d]) by (deviceId, netType, cellGen)

# Oracle verdicts: was the internet down, or only us?
{service_name="recoverysky-app"} | oracleReachable!=""
```

Measured 2026-09-28 (6 h window): the slowest devices' MEDIAN API request
was 1.7–2.0 s. That's why the oracle budget is 3 s and not 2 s. Tune it from
`cloudflareMs` / `googleMs` once there's data.

We deliberately do **not** log the Wi-Fi name (SSID/BSSID). It needs
precise-location permission, plus an entitlement on iOS, and an SSID is often
a family name, which effectively ties a recovery user to a home address.
`netType` + `cellGen` + time of day is how to tell home from commute.

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
  CHANGED 2026-09-28: so is a ladder where *no attempt got an answer*
  (every one `cannot-connect` / `timeout`, `maintenanceCause: "network"`).
  The user sees the "Network issues" banner, but that's their connection, and
  31 such ERRORs a day from phones on dead Wi-Fi were burying real errors. A
  ladder the server actually answered (5xx, rejection) stays `error`.
- **Known-benign storms go to `info`**, not `warn`, with the RS number in the
  code comment — e.g. `upsertToken` before sign-in (RS-012), report-body 404
  backfill (RS-018).

Production ships `EXPO_PUBLIC_LOG_LEVEL=trace` (`eas.json`), so moving a line
to `debug` changes what a dashboard counts, not what Loki stores.
