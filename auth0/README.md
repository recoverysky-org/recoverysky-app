# auth0/

Source of truth for the RecoverySky Auth0 tenants' Actions, one folder per tenant:

| Folder | Tenant | Domain | Role |
|---|---|---|---|
| `actions/meetingmaker/` | `meetingmaker` | `auth.recoverysky.app` | **prod**. One client shared with every app build. |
| `actions/bad-bitch-tenant/` | `bad-bitch-tenant` | `bad-bitch-tenant.us.auth0.com` | dev |

**A `.js` file in a tenant's folder is an Action deployed and bound on that tenant.
A file that isn't there doesn't exist on that tenant.** No Action is written straight
into the dashboard. Promoting an Action from dev to prod means copying the file
into `meetingmaker/` in the same commit as the deploy. Any claim the app reads
that no folder issues is never sent. In particular there is no
`https://recoverysky.app/metadata` Action on either tenant, so the `sqliteKey`
claim that `jwtUtils.extractSqliteKeyFromClaims()` looks for never arrives (see
"Not implemented" below).

The tenants' other settings (connections, grant types, email) are still configured
by hand.

## Deploying — `scripts/deploy-actions.sh`

ADDED 2026-09-30. Makes a tenant match its folder, idempotently:

```bash
auth0/scripts/deploy-actions.sh bad-bitch-tenant              # dry run: diff + plan, changes nothing
auth0/scripts/deploy-actions.sh bad-bitch-tenant --apply      # create / update / deploy / bind
auth0/scripts/deploy-actions.sh meetingmaker --apply --prod   # prod refuses without --prod
```

Each Action file names itself in its header, and the script reads only these tags:

```js
/**
 * @auth0-action   Identities claim        // exact Action name on the tenant
 * @auth0-trigger  post-login              // any trigger id; the tenant's CURRENT version is used
 * @auth0-runtime  node22                  // optional, default node22
 * @auth0-dependency lodash@4.17.21        // optional, repeatable
 * @auth0-secret   API_KEY                 // optional, repeatable — NAMES only
 */
```

- **Missing Action** → created, built, deployed, bound.
- **Deployed code, runtime or dependencies differ** → the diff is printed, then the Action is
  updated, built and deployed. **In sync** → untouched, so a second run is a no-op.
- **Unbound** → appended to the end of its trigger's flow. Existing order is never changed; the
  printed order is what to check against "Post-login order" below.
- **On the tenant, no file** → reported as drift, never deleted or unbound.
- **Secrets:** values never live in git. An Action that declares a secret the tenant lacks is
  skipped with an error. Set the value in the dashboard, then re-run.

Credentials come from the Management API client in `AUTH_MGMT_*` (default `../api/.env`;
override with `ENV_FILE=…`). The script refuses unless `AUTH_MGMT_DOMAIN` starts with the
tenant's name, and needs `read:actions`, `create:actions` and `update:actions` on that client.
It never prints the secret or the token.

**Clean slate for tests (dev only):** `auth0/scripts/wipe-dev-users.sh [--delete]` lists, then
deletes, every user on `bad-bitch-tenant` (needs `delete:users`; refuses any other tenant).
Auth0 users only — pair it with the app's 🧨 DEV Purge for a true fresh start.
`auth0/scripts/diagnose-linking.mjs [--since <min>]` is its read-only partner (dev only; needs
`read:users`, `read:logs`, `read:actions`). It prints each user's identities with the app's log hash of
each sub, plus recent logins, marking an email-code login issued for a non-email sub `⇐ LINKED`.
It's the checkpoint step in `docs/AUTH_LINKING_TESTS.md`.

**Prod and every app build share one Auth0 client, so a `meetingmaker` Action
change reaches live users on their next login or token refresh.** Deploy to
`bad-bitch-tenant` first, check it on a device, then promote.

Before redeploying, diff the tenant's deployed code against the file:
`GET /api/v2/actions/actions/{id}` → `deployed_version.code`.

## Actions

| Action | File | Trigger | Secrets | Consumed by | dev | prod |
|---|---|---|---|---|---|---|
| Link passwordless identity | `link-passwordless-identity.js` | Login / Post Login | `MGMT_DOMAIN`, `MGMT_CLIENT_ID`, `MGMT_CLIENT_SECRET` | nothing in the app — it makes an email-code login land in the user's existing account | deployed + bound 2026-09-30 (v2; own M2M app "Action: Link passwordless identity") | — |
| Identities claim | `identities-claim.js` | Login / Post Login | none | `app/services/auth/accountMethodsLogic.ts` (Settings → Account; the ownership gate's `relinked` check) | v2 (adds `sub` per entry), deployed 2026-09-30 via `deploy-actions.sh`; bound (id `6d745790-f4db-479d-b1d0-0422c354c86b`) | — |

Post-login order: passwordless linking → identities claim. Linking runs first because it
changes which identity is primary. In practice the order can't change a token today: the
claim reads the event as it arrived, and a first email login has one identity, so the claim
is skipped either way. Keep the order anyway so a future claim Action doesn't inherit a
surprise. `deploy-actions.sh` only appends, so a newly created linking Action lands AFTER
the claim; drag it above in Actions → Triggers → post-login.

### Not implemented (on any tenant)

- **Metadata claim** (`https://recoverysky.app/metadata`, carrying `sqliteKey`).
  The app reads it (`useAuth0Wrapper` → `handleSqliteKeyFromJwt`) and rekeys
  the local database when it differs from the device key. No Action has ever
  issued it, so every signed-in device runs on its own locally generated key,
  and the rekey-on-login path has **never run in production**. Writing this
  Action would switch that path on for every user at their next login.
  Treat it as a new feature with its own spec (RS-024 is what a wrong key
  does), not as a copy job. Nothing creates a per-user key server-side today.

## link-passwordless-identity.js

Spec 1 §3.5, written 2026-09-30. Part of the prod ship gate. Without it, an existing
password / Google / Apple user who taps "Continue with Email" gets a new, empty
`email|…` account. On an `email` login by a one-identity user (not a refresh), it finds
the oldest same-email account whose root identity is `auth0` / `google-oauth2` / `apple`,
links the email identity into it, and calls `setPrimaryUser` so this login's tokens carry
the existing sub. Any failure logs and lets the login through unlinked (the next login
retries). It does **not** randomise the old password (decided 2026-09-30: old builds still
sign in with passwords on the shared prod client).

**First deploy to a tenant.** Fast path: `node auth0/scripts/provision-link-client.mjs <tenant>
[--apply]` does steps 1–2 by API (creates the dedicated M2M app + grant, creates the Action
with its secrets — the client secret never touches a screen); then steps 3–4. It needs the
`AUTH_MGMT_*` client to also hold `read:clients`, `create:clients`, `read:client_grants`,
`create:client_grants`. By hand (deploy-actions won't create an Action that declares secrets):
1. Dashboard → Actions → Library → Create Action → Build from scratch, name exactly
   `Link passwordless identity`, trigger Login / Post Login, runtime Node 22. Leave the
   code as the stub.
2. Add secrets: `MGMT_DOMAIN` = the canonical `<tenant>.us.auth0.com` (not a custom
   domain), `MGMT_CLIENT_ID` / `MGMT_CLIENT_SECRET` = a **dedicated** M2M application
   (Applications → Create → Machine to Machine, e.g. "Action: link passwordless
   identity") authorized for the Auth0 Management API with ONLY `read:users` +
   `update:users`. Not the API's `AUTH_MGMT_*` client: Action secrets are readable by
   every dashboard admin, so a leak should expose two scopes, and it can be rotated
   without touching the API. These are client credentials, not a token — the Action
   mints its own short-lived Management token and caches it (decided 2026-09-30).
3. `auth0/scripts/deploy-actions.sh <tenant> --apply` pushes the code, deploys and binds it.
4. Drag it above Identities claim in the post-login flow (see order above).

**Verify** (dev): the basic run in `docs/AUTH_LINKING_TESTS.md` (password/Google → email link,
iOS ↔ Android sync, relinked owner), then the fuller list in plan Task 18 Step 4,
`docs/superpowers/plans/2026-09-17-passwordless-auth-and-wrong-account-recovery.md`.
Auth0 → Monitoring → Logs shows `linked email identity into <provider> primary` or
`link skipped: <reason>`; the log line never carries the email.

## identities-claim.js

**v2 (deployed to dev 2026-09-30):** each entry also carries `sub` (`provider|user_id`). The app's ownership
gate uses it to recognise a device owner whose identity was linked into another account from a
different device (spec 2 §7). Without it that device loops on the wrong-account screen. The app
treats an entry without `sub` as before, so either deploy order is safe. Prod needs v2 before
account linking ships there.

The claim is emitted only for accounts with two or more identities, and each
entry carries `current: true` when its connection is the one this login used.
That tag tells the app which identity is active, because the token's `email`
is the primary's on every linked login.

**Deploy:** `auth0/scripts/deploy-actions.sh <tenant> --apply` (see "Deploying" above).
1. Order: once passwordless linking exists, it must run before this Action in post-login.
   A link made during this login is not in `event.user.identities` yet, so it shows on the
   next refresh or login.
2. Verify: sign in on a dev build, decode the ID token (log it locally only, never
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
