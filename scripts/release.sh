#!/usr/bin/env bash
# Tags HEAD with a UTC timestamp (YYYYMMDD-HHMMSS) and pushes it, triggering
# CI's publish job. Flux tracks these tags, so the format must stay exact.
set -euo pipefail

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit or stash changes before releasing" >&2
  exit 1
fi

tag="$(date -u +%Y%m%d-%H%M%S)"

git tag "$tag" HEAD
git push origin "$tag"

echo "released $tag"
