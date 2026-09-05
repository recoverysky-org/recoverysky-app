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

**Sentry and Umami are different.** Both receive `authStore.userIdentifier`
(the raw sub, or `deviceId` when anonymous) via `setSentryUser` /
`setTrackingUserId`, because their UIs group by user id and a hash would
break the link to the Auth0 dashboard. Sentry's PII policy lives in the
header of `app/services/crashReporting/sentry.ts`.

**Privacy-policy dependency:** the policy must list a diagnostic identifier
and the Loki retention window. The policy is not in this repo — re-check it
whenever this table changes.
