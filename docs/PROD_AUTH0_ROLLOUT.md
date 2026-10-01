# Prod Auth0 rollout (meetingmaker): where it stands

Written 2026-09-30 and paused there, so a bug in the linking flow could be chased first. Resume from
here. The app's passwordless build **must not ship as an OTA** until every step below is done.

## Verified on dev
`docs/AUTH_LINKING_TESTS.md` ran green on iOS + Android on 2026-09-30, on branch
`fix/relinked-owner` (commit `7c71d3d`). It covered:
- password → email linking
- Google → email linking
- sync between the two devices
- the relinked owner
- the Settings → Account rows

## Prod today
Read-only checks with `AUTH0_MGMT_API_TOKEN_PROD`, 2026-09-30:

| Item | Prod | Dev, for comparison |
|---|---|---|
| Connections | `Username-Password-Authentication`, `google-oauth2`, `apple`. **No `email`.** | Has `email`: 6-digit code, 180 s step, Liquid subject `{{ code }} is your RecoverySky sign-in code`, sign-ups allowed |
| App client grant types (RecoverySky App) | `authorization_code`, `implicit`, `refresh_token`. **No passwordless code grant.** | Adds `http://auth0.com/oauth/grant-type/passwordless/otp` |
| Post-login Actions | `Create Firebase User` only | Link passwordless identity → Identities claim |
| Post-user-registration Actions | `Create Firebase User API` | — |
| Email provider | SMTP, enabled | none (slow default mailer) |

**Neither Firebase Action is in `auth0/actions/meetingmaker/`.** That is drift: by the folder rule,
anything on the tenant should have a file there.
- `Create Firebase User` (post-login, axios, secrets `PASSWORD` and `PREFIX`): on the first login
  of a user that isn't marked `app_metadata.user_created`, it posts the user to
  `api.irecovery.app/<PREFIX>/createUser/`. It would fire for every new `email|` user, and it runs
  before any Link Action.
- `Create Firebase User API` (post-user-registration): broken. Its handler declares a post-login
  handler inside itself, so it never does anything.
- **To decide:** bring both into the repo, or remove them.

## Steps, in order
Each one is a prod write; Jenova approves each one.
1. **Identities claim.** It's safe on its own: it only adds an ID-token claim for accounts with two
   or more identities, and older builds ignore it. The file
   `auth0/actions/meetingmaker/identities-claim.js` is staged locally (untracked).
   - Run `auth0/scripts/deploy-actions.sh meetingmaker --apply --prod`. Claude Code's safety check
     blocks this when Claude runs it, so Jenova runs it with `!`.
   - Then commit the file and set the README's prod column.
2. **Decide on the Firebase Actions** (see above), before any `email|` users exist on prod.
3. **Create the `email` connection** with dev's settings, enabled for RecoverySky App only.
   - Before enabling it, check that live builds' Universal Login doesn't start offering a code
     option.
4. **Add the passwordless code grant** to the RecoverySky App client.
5. **Link passwordless identity:**
   - Run `node auth0/scripts/provision-link-client.mjs meetingmaker --apply --prod`, which creates
     a dedicated M2M app with only `read:users` + `update:users` and writes its credentials into
     the Action's secrets.
   - Then run `deploy-actions.sh meetingmaker --apply --prod`, and in the dashboard drag the Link
     Action **above** Identities claim.
6. **Check prod** with a test address before the OTA (a prod variant of
   `docs/AUTH_LINKING_TESTS.md` Part 1).
7. **Ship the OTA**, following the `CHANGELOG.md` "Also before that OTA" note.

## Still open for email-first users (product decision)
When the Link Action links an `email|` account into a Google/Apple/password account:
- **Server attendance** already pushed under the `email|` sub doesn't move. Only
  `POST /auth0/link` runs `reassignUserRows`.
- **A RevenueCat purchase** made under the `email|` sub doesn't follow either.

## Tooling
- `auth0/scripts/mgmt-auth.mjs` lets the deploy and provision scripts use
  `AUTH0_MGMT_API_TOKEN_PROD` / `_DEV` directly. It reads the tenant from the token's `aud`, and an
  expired token stops with the refresh steps.
- This change is uncommitted as of writing.
