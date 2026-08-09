#!/usr/bin/env bash
# Tags HEAD with a UTC timestamp (YYYYMMDD-HHMMSS) and pushes it, triggering CI's publish job.
#
# This does NOT deploy. Flux's ImagePolicy matches only the `main-<run>-<sha>` tags CI publishes
# on every push to main, so a merge to main is the deploy and this script exists to pin an
# immutable, human-named image for a release you want to be able to point at later.
set -euo pipefail

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit or stash changes before releasing" >&2
  exit 1
fi

tag="$(date -u +%Y%m%d-%H%M%S)"

git tag "$tag" HEAD
git push origin "$tag"

echo "released $tag"
