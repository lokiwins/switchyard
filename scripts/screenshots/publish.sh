#!/usr/bin/env bash
# Pushes the new and changed screenshots of a PR's comparison to the
# `screenshots` branch, so its comment can show them inline. The branch only
# holds these previews and can be deleted at any time; release screenshots are
# attached to the release instead.
#
#   publish.sh <shots dir> <report.json> <dest path on the branch>
#
# Needs GH_TOKEN (contents: write) and GITHUB_REPOSITORY. Prints the URL prefix
# the images are served under: <prefix>/{base,head}/<scene>.png.
set -euo pipefail

shots="$1"
report="$2"
dest="$3"
branch=screenshots
# PUBLISH_REMOTE overrides where it pushes, for trying it against a local repo.
remote="${PUBLISH_REMOTE:-https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git -C "$work" init -q
git -C "$work" config user.name "github-actions[bot]"
git -C "$work" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# The branch is created on first use.
if git -C "$work" fetch -q --depth 1 "$remote" "$branch" 2>/dev/null; then
  git -C "$work" checkout -q FETCH_HEAD
fi
git -C "$work" checkout -q -B "$branch"

# Only what the comment or notes show: head for new scenes, base and head for changed ones.
copy() { mkdir -p "$work/$dest/$1" && cp "$shots/$1/$2.png" "$work/$dest/$1/"; }
for name in $(jq -r '.entries[] | select(.status == "new" or .status == "changed") | .name' "$report"); do
  copy head "$name"
done
for name in $(jq -r '.entries[] | select(.status == "changed") | .name' "$report"); do
  copy base "$name"
done

git -C "$work" add -A
if ! git -C "$work" diff --cached --quiet; then
  git -C "$work" commit -q -m "Screenshots for $dest"
  # Another run may have pushed meanwhile; replay this commit on top of it.
  for attempt in 1 2 3; do
    git -C "$work" push -q "$remote" "HEAD:$branch" && break
    [ "$attempt" = 3 ] && exit 1
    git -C "$work" fetch -q "$remote" "$branch"
    git -C "$work" rebase -q FETCH_HEAD
  done
fi

echo "https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${branch}/${dest}"
