#!/usr/bin/env bash
# VERCEL IGNORED BUILD STEP (#553 COWORK #164, owner-approved 2026-10-05).
#
# Vercel runs this before each build: exit 0 SKIPS the build, exit 1 BUILDS.
# It skips only when it is sure, and builds in every other case:
#   - production always builds;
#   - read-only branches skip: relay/*, mockup/*, claude/*-census,
#     claude/*-study, claude/*-mockup;
#   - a commit message carrying [skip preview] skips;
#   - a diff since VERCEL_GIT_PREVIOUS_SHA (else HEAD^) touching only
#     reports/, claude/, docs/ or *.md files skips. scripts/ is NOT skipped
#     (some checks run in the build), and a diff that cannot be computed
#     (shallow clone, no previous commit) builds.
# One log line names the reason. Tested by scripts/check-vercel-ignore-build.mjs.

skip() { echo "vercel-ignore-build: SKIP — $1"; exit 0; }
build() { echo "vercel-ignore-build: BUILD — $1"; exit 1; }

if [ "${VERCEL_ENV:-}" = "production" ]; then
  build "production always builds"
fi

ref="${VERCEL_GIT_COMMIT_REF:-}"
case "$ref" in
  relay/*) skip "read-only relay branch ($ref)" ;;
  mockup/*) skip "mock-up branch ($ref)" ;;
esac
if [[ "$ref" =~ ^claude/.+-(census|study|mockup)$ ]]; then
  skip "read-only branch ($ref)"
fi

if [[ "${VERCEL_GIT_COMMIT_MESSAGE:-}" == *"[skip preview]"* ]]; then
  skip "commit message says [skip preview]"
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$base" ] || base="HEAD^"
if ! files="$(git diff --name-only "$base" HEAD 2>/dev/null)"; then
  build "diff since $base could not be computed"
fi
if [ -z "$files" ]; then
  build "no changed files found since $base"
fi
while IFS= read -r f; do
  case "$f" in
    reports/*|claude/*|docs/*|*.md) ;;
    *) build "code changed ($f)" ;;
  esac
done <<< "$files"
skip "only docs changed (reports/, claude/, docs/, *.md)"
