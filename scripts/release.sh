#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
	echo "Usage: npm run release -- <patch|minor|major>"
	exit 1
fi

BUMP="$1"

echo "Running CI checks..."
npm run lint
npm run typecheck
npm run test
npm run build

echo "Bumping version ($BUMP)..."
npm version "$BUMP" -m "chore: release v%s"

echo "Pushing commit + tag..."
git push --follow-tags

TAG="v$(node -p 'require("./package.json").version')"
echo "Creating GitHub release $TAG..."
gh release create "$TAG" --title "$TAG" --generate-notes

echo "Released $TAG!"
