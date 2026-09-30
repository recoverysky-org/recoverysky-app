# auth0/

Source of truth for the RecoverySky Auth0 tenants' Actions, one folder per tenant:

| Folder | Tenant | Domain | Role |
|---|---|---|---|
| `actions/meetingmaker/` | `meetingmaker` | `auth.recoverysky.app` | **prod**. One client shared with every app build. |
| `actions/bad-bitch-tenant/` | `bad-bitch-tenant` | `bad-bitch-tenant.us.auth0.com` | dev |

**A file in a tenant's folder is an Action deployed and bound on that tenant. A
file that isn't there doesn't exist on that tenant.** No Action is written straight
into the dashboard. Promoting an Action from dev to prod means copying the file
into `meetingmaker/` in the same commit as the deploy. Any claim the app reads
that no folder issues is never sent. In particular there is no
`https://recoverysky.app/metadata` Action on either tenant, so the `sqliteKey`
claim that `jwtUtils.extractSqliteKeyFromClaims()` looks for never arrives (see
"Not implemented" below).

The tenants' other settings (connections, grant types, email) are still configured
by hand.

**Prod and every app build share one Auth0 client, so a `meetingmaker` Action
change reaches live users on their next login or token refresh.** Deploy to
`bad-bitch-tenant` first, check it on a device, then promote.

Before redeploying, diff the tenant's deployed code against the file:
`GET /api/v2/actions/actions/{id}` → `deployed_version.code`.

## Actions

| Action | File | Trigger | Secrets | Consumed by | dev | prod |
|---|---|---|---|---|---|---|
| Identities claim | `identities-claim.js` | Login / Post Login | none | `app/services/auth/accountMethodsLogic.ts` (Settings → Account) | v1, bound 2026-09-30 (id `6d745790-f4db-479d-b1d0-0422c354c86b`) | — |

Post-login order, once the other Actions exist: passwordless linking → identities
claim. Linking runs first because it changes which identity is primary.

### Not implemented (on any tenant)

- **Metadata claim** (`https://recoverysky.app/metadata`, carrying `sqliteKey`).
  The app reads it (`useAuth0Wrapper` → `handleSqliteKeyFromJwt`) and rekeys
  the local database when it differs from the device key. No Action has ever
  issued it, so every signed-in device runs on its own locally generated key,
  and the rekey-on-login path has **never run in production**. Writing this
  Action would switch that path on for every user at their next login.
  Treat it as a new feature with its own spec (RS-024 is what a wrong key
  does), not as a copy job. Nothing creates a per-user key server-side today.
- **Passwordless linking** (spec 1 §3.5). Designed, not written. It is part of the
  prod ship gate. Decided 2026-09-30: it does **not** randomise the linked database
  user's password (for now), because old builds still sign in with passwords on
  the shared prod client.

## identities-claim.js

The claim is emitted only for accounts with two or more identities, and each
entry carries `current: true` when its connection is the one this login used.
That tag tells the app which identity is active, because the token's `email`
is the primary's on every linked login.

**Deploy:**
1. Actions → Library → Create Action → "Identities claim", trigger **Login / Post
   Login**, runtime Node 22. Paste the file. No dependencies, no secrets. Deploy.
2. Actions → Triggers → post-login: add it after passwordless linking, once that
   Action exists. A link made during this login is not in `event.user.identities`
   yet, so it shows on the next refresh or login.
3. Verify: sign in on a dev build, decode the ID token (log it locally only, never
   to Loki), and confirm the `https://recoverysky.app/identities` array. On the
   device, Settings → Account should list the linked methods.

**Known lag:** a link made by the app's wrong-account recovery (`POST
/auth0/link`, after the owner has already signed in) is not in the current ID
token, so the new "Linked" row appears on the next token refresh or login. The
app does not force a refresh for it. That was decided on 2026-09-30: a
cosmetic row isn't worth touching the token-freshness path.

The app treats a missing claim as "no links", so deploying the app before the
Action is safe. The Action is safe to deploy before the app, too: older builds
ignore unknown claims.
