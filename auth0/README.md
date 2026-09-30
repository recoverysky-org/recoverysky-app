# auth0/

Source of truth for the code in the RecoverySky Auth0 tenants' Actions. The
tenants themselves are still configured by hand (dashboard or Management API);
this folder holds the code so it is reviewed, versioned, and identical on the
dev tenant (`bad-bitch-tenant.us.auth0.com`) and prod (`auth.recoverysky.app`).

**If an Action is not in `actions/`, it does not exist on any tenant.** No
Action gets written straight into the dashboard. Any claim the app reads that
has no Action here is never issued. In particular there is no
`https://recoverysky.app/metadata` Action, so the `sqliteKey` claim that
`jwtUtils.extractSqliteKeyFromClaims()` looks for never arrives (see
"Not implemented" below).

**Prod and every app build share one Auth0 client, so a prod Action change reaches
live users on their next login or token refresh.** Deploy to the dev tenant first,
check it on a device, then deploy to prod.

## Actions

| File | Trigger | Secrets | Consumed by |
|---|---|---|---|
| `actions/identities-claim.js` | Login / Post Login | none | `app/services/auth/accountMethodsLogic.ts` (Settings → Account) |

### Not implemented

- **Metadata claim** (`https://recoverysky.app/metadata`, carrying `sqliteKey`).
  The app reads it (`useAuth0Wrapper` → `handleSqliteKeyFromJwt`) and rekeys
  the local database when it differs from the device key. No Action has ever
  issued it, so every signed-in device runs on its own locally generated key,
  and the rekey-on-login path has **never run in production**. Writing this
  Action would switch that path on for every user at their next login.
  Treat it as a new feature with its own spec (RS-024 is what a wrong key
  does), not as a copy job. Nothing creates a per-user key server-side today.
- **Passwordless linking** (spec 1 §3.5). Designed, not written. It is part of the
  prod ship gate.

### Where each Action is live

| Action | dev (`bad-bitch-tenant`) | prod (`auth.recoverysky.app`) |
|---|---|---|
| Identities claim | v1, bound to post-login — 2026-09-30 (id `6d745790-f4db-479d-b1d0-0422c354c86b`) | not deployed |

Update this table in the same commit as any deploy, and diff the tenant's
deployed code against the file first: `GET /api/v2/actions/actions/{id}` →
`deployed_version.code`.

### identities-claim.js — deploy

1. Actions → Library → Create Action → "Identities claim", trigger **Login / Post
   Login**, runtime Node 22. Paste the file. No dependencies, no secrets. Deploy.
2. Actions → Triggers → post-login: drag it in **after** the passwordless-linking
   Action (spec `docs/superpowers/specs/2026-09-12-passwordless-login-design.md`
   §3.5) and the metadata-claim Action. Order matters for the linking Action
   only as a known lag: a link made during this login is not in
   `event.user.identities` yet, so it shows on the next refresh or login.
3. Verify: sign in on a dev build, decode the ID token (log it locally only, never
   to Loki), and confirm the `https://recoverysky.app/identities` array. On the
   device, Settings → Account should list the linked methods.

The claim is emitted only for accounts with two or more identities, and each
entry carries `current: true` when its connection is the one this login used.
That tag tells the app which identity is active, because the token's `email`
is the primary's on every linked login.

**Known lag:** a link made by the app's wrong-account recovery (`POST
/auth0/link`, after the owner has already signed in) is not in the current ID
token, so the new "Linked" row appears on the next token refresh or login. The
app does not force a refresh for it. That was decided on 2026-09-30: a
cosmetic row isn't worth touching the token-freshness path.

The app treats a missing claim as "no links", so deploying the app before the
Action is safe. The Action is safe to deploy before the app, too: older builds
ignore unknown claims.
