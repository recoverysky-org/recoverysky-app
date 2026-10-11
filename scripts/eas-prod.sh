#!/bin/bash
# eas-prod.sh - Run an `eas` command for a production build or OTA without any
# local EXPO_PUBLIC_* in the environment.
# Usage: bash scripts/eas-prod.sh <eas args...>
#   e.g. bash scripts/eas-prod.sh update --branch production --environment production
#
# ADDED 2026-10-11. `eas update --environment production` sets EXPO_NO_DOTENV=1
# and overlays the EAS production variables, but the `expo export` it spawns
# still inherits this shell's environment (eas-cli 24.12.1, utils/expoCli.js).
# direnv loads .env into the shell (.envrc is `dotenv`), so every EXPO_PUBLIC_*
# that the EAS environment does not define shipped with its LOCAL value: OTA
# 4.11.0-1 showed the Sky Agent tab pointed at the dev agent URL, and the dev
# API key (EXPO_PUBLIC_AUTH_KEY) rode along in the store build and every OTA.
# With them unset here, an OTA gets its values from the EAS environment only,
# and a production build from eas.json and EAS. scripts/check-bundle-env.js is
# the tripwire if something gets around this.
#
# Dev and preview builds do not go through here: they are meant to carry .env.
# Bash 3.2 (macOS /bin/bash) safe: no arrays under `set -u`, no mapfile.

set -e

stripped=""
for name in $(compgen -e | grep '^EXPO_PUBLIC_' || true); do
  unset "$name"
  stripped="$stripped $name"
done

if [ -n "$stripped" ]; then
  echo "eas-prod: not passing local$stripped" >&2
fi

exec npx eas "$@"
