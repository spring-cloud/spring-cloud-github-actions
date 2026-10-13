#!/usr/bin/env bash
# Rebases one project's -internal and release/* branches for one minor line, for
# rebase-release-branches.yml. The plan (rebase-plan.js) decides what each job covers.
#
#   oss         <line>.x-internal (commercial repo) is rebased onto the OSS base branch, then each
#               release/<version> onto the rebased -internal branch.
#   commercial  each release/<version> is rebased onto the commercial <line>.x branch.
#
# The base branches are only ever read. Only -internal and release/* are rewritten, and only
# pushed when DRY_RUN is not 'true' (always with --force-with-lease against the sha that was
# rebased, so a push that landed in the meantime is not overwritten).
#
# A rebase that conflicts is aborted and recorded; the branches that depend on it are recorded
# as blocked. Nothing here exits non-zero for a conflict - the summary is where those are
# reported, so one project does not hide the rest.
#
# Environment:
#   PROJECT, LINE, MODE, VERSIONS (space separated), DRY_RUN, GH_TOKEN, RESULT_FILE
#   OSS_BASE         OSS branch to rebase -internal onto (oss mode)
#   COMMERCIAL_BASE  commercial <line>.x branch (commercial mode)
#
# One JSON object per line is appended to RESULT_FILE:
#   {project, branch, base, status, detail}
# status: rebased | up-to-date | skipped | conflict | blocked | error

set -uo pipefail

: "${PROJECT:?}" "${LINE:?}" "${MODE:?}" "${VERSIONS:?}" "${GH_TOKEN:?}" "${RESULT_FILE:?}"
DRY_RUN="${DRY_RUN:-true}"

COMMERCIAL_REPO="spring-cloud/${PROJECT}-commercial"
OSS_REPO="spring-cloud/${PROJECT}"
INTERNAL="${LINE}.x-internal"
WORKDIR="${WORKDIR:-repo}"
# Overridable so the git logic can be tried against local repositories.
GIT_URL_BASE="${GIT_URL_BASE:-https://x-access-token:${GH_TOKEN}@github.com}"

record() { # status branch base detail
  jq -cn --arg project "$PROJECT" --arg status "$1" --arg branch "$2" --arg base "$3" --arg detail "${4:-}" \
    '{project: $project, branch: $branch, base: $base, status: $status, detail: $detail}' >> "$RESULT_FILE"
  echo "[$1] ${PROJECT} ${2}${3:+ onto ${3}}${4:+ - ${4}}"
}

# Cross-org clones and fetches fail on a blip often enough to be worth retrying.
retry() {
  local what="$1" attempt
  shift
  for attempt in 1 2 3; do
    "$@" && return 0
    [[ $attempt -lt 3 ]] && { echo "${what}: failed, attempt ${attempt}/3 - waiting $((attempt * 10))s..."; sleep $((attempt * 10)); }
  done
  return 1
}

remote_branch_exists() { git rev-parse --verify --quiet "refs/remotes/$1/$2" > /dev/null; }

# rebase <branch> <onto> [<upstream>]: leaves the branch rebased locally, or aborts.
# Returns 0 on success, 1 on conflict (aborted, conflicting files in $CONFLICTS).
rebase() {
  local branch="$1" onto="$2" upstream="${3:-}"
  git checkout --quiet -B "$branch" "origin/${branch}" || return 2
  if [[ -n "$upstream" ]]; then
    git rebase --quiet --onto "$onto" "$upstream" "$branch" > /dev/null 2>&1 && return 0
  else
    git rebase --quiet "$onto" "$branch" > /dev/null 2>&1 && return 0
  fi
  CONFLICTS=$(git diff --name-only --diff-filter=U | head -10 | paste -sd, -)
  git rebase --abort > /dev/null 2>&1 || true
  return 1
}

push() { # branch old_sha
  [[ "$DRY_RUN" == "true" ]] && return 0
  git push --quiet --force-with-lease="refs/heads/${1}:${2}" origin "${1}:refs/heads/${1}"
}

CONFLICTS=""

# Rebases one branch and records the outcome. $4 is the upstream for --onto, if any.
# Sets REBASED_OK=1 when the branch ends up on its base (rebased or already there).
process() { # branch onto onto_label [upstream]
  local branch="$1" onto="$2" label="$3" upstream="${4:-}" old rc
  REBASED_OK=0
  if ! remote_branch_exists origin "$branch"; then
    record skipped "$branch" "$label" "branch does not exist in ${COMMERCIAL_REPO}"
    return
  fi
  old=$(git rev-parse "refs/remotes/origin/${branch}")
  if git merge-base --is-ancestor "$onto" "$old"; then
    record up-to-date "$branch" "$label"
    REBASED_OK=1
    return
  fi
  rebase "$branch" "$onto" "$upstream"; rc=$?
  if [[ $rc -eq 1 ]]; then
    record conflict "$branch" "$label" "conflicts in: ${CONFLICTS:-unknown}"
    return
  elif [[ $rc -ne 0 ]]; then
    record error "$branch" "$label" "could not check out the branch"
    return
  fi
  if ! push "$branch" "$old"; then
    record error "$branch" "$label" "rebased, but the push was rejected (the branch changed during the run?)"
    return
  fi
  record rebased "$branch" "$label" "$([[ "$DRY_RUN" == "true" ]] && echo 'dry run, not pushed')"
  REBASED_OK=1
}

rm -rf "$WORKDIR"
retry "clone ${COMMERCIAL_REPO}" git clone --quiet "${GIT_URL_BASE}/${COMMERCIAL_REPO}.git" "$WORKDIR" || {
  for v in $VERSIONS; do record error "release/${v}" "" "could not clone ${COMMERCIAL_REPO}"; done
  exit 0
}
cd "$WORKDIR" || exit 1
git config user.name  "Spring Builds"
git config user.email "svc.spring-builds@broadcom.com"

if [[ "$MODE" == "oss" ]]; then
  if [[ -z "${OSS_BASE:-}" ]]; then
    record error "$INTERNAL" "" "no OSS base branch could be resolved in ${OSS_REPO}"
    for v in $VERSIONS; do record blocked "release/${v}" "$INTERNAL" "needs ${INTERNAL} rebased first"; done
    exit 0
  fi
  git remote add oss "${GIT_URL_BASE}/${OSS_REPO}.git"
  retry "fetch ${OSS_REPO}@${OSS_BASE}" git fetch --quiet oss "$OSS_BASE" || {
    record error "$INTERNAL" "oss/${OSS_BASE}" "could not fetch ${OSS_REPO}@${OSS_BASE}"
    for v in $VERSIONS; do record blocked "release/${v}" "$INTERNAL" "needs ${INTERNAL} rebased first"; done
    exit 0
  }
  oss_ref="refs/remotes/oss/${OSS_BASE}"

  if ! remote_branch_exists origin "$INTERNAL"; then
    record skipped "$INTERNAL" "oss/${OSS_BASE}" "branch does not exist in ${COMMERCIAL_REPO}"
    for v in $VERSIONS; do record blocked "release/${v}" "$INTERNAL" "${INTERNAL} does not exist"; done
    exit 0
  fi
  old_internal=$(git rev-parse "refs/remotes/origin/${INTERNAL}")

  process "$INTERNAL" "$oss_ref" "oss/${OSS_BASE}"
  if [[ $REBASED_OK -ne 1 ]]; then
    for v in $VERSIONS; do record blocked "release/${v}" "$INTERNAL" "needs ${INTERNAL} rebased first"; done
    exit 0
  fi
  # In a dry run the push is skipped, so the rebased branch only exists locally - which is
  # the one the releases are rebased onto either way.
  new_internal=$(git rev-parse --verify --quiet "refs/heads/${INTERNAL}" || echo "$old_internal")

  for v in $VERSIONS; do
    b="release/${v}"
    upstream=""
    # Replay only the release branch's own commits. A plain rebase would also replay the old
    # -internal commits that were just rewritten.
    if remote_branch_exists origin "$b"; then
      upstream=$(git merge-base "refs/remotes/origin/${b}" "$old_internal" 2> /dev/null || true)
    fi
    process "$b" "$new_internal" "$INTERNAL" "$upstream"
  done
else
  if [[ -z "${COMMERCIAL_BASE:-}" ]]; then
    for v in $VERSIONS; do record error "release/${v}" "" "no ${LINE}.x branch could be resolved in ${COMMERCIAL_REPO}"; done
    exit 0
  fi
  for v in $VERSIONS; do
    process "release/${v}" "refs/remotes/origin/${COMMERCIAL_BASE}" "$COMMERCIAL_BASE"
  done
fi
