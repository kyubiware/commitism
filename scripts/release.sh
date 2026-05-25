#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
	echo "Usage: npm run release -- <patch|minor|major>"
	exit 1
fi

BUMP="$1"

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
	echo "Working tree is not clean. Commit or stash changes first."
	exit 1
fi

echo "Running CI checks..."
npx biome check --error-on-warnings .
npm run typecheck
npm run test
npm run build

echo "Bumping version ($BUMP)..."
NEW_VERSION="$(npm version "$BUMP" -m "chore: release v%s" | tr -d '\n')"

echo "Pushing commit + tag..."
git push
git push origin "$NEW_VERSION"

echo "Released $NEW_VERSION"
echo "https://github.com/kyubiware/commit-mint/actions"
