# Update Antora UI Bundle Workflow

Opens a pull request against every maintained repository/branch whose `docs/antora-playbook.yml`
points at an old release of the Antora UI bundle
([`spring-io/antora-ui-spring`](https://github.com/spring-io/antora-ui-spring)), so **CI
decides whether the bump is safe** rather than nobody noticing the rendered docs look stale.
Defaults to a dry run.

## Why this exists

Every Spring Cloud project's docs pin a UI bundle release in `docs/antora-playbook.yml`:

```yaml
ui:
  bundle:
    url: https://github.com/spring-io/antora-ui-spring/releases/download/v0.4.15/ui-bundle.zip
```

Nobody was watching `spring-io/antora-ui-spring`'s releases, so this drifts silently. At the
time this workflow was written, every maintained branch of `spring-cloud-commons` (and its
`-commercial` counterpart) was pinned to `v0.4.15` while the latest release was already
`v0.4.26` — eleven releases behind. This is the same shape of problem
[`update-maven-wrapper.yml`](README-update-maven-wrapper.md) solves for the Maven wrapper: an
upstream artifact versions independently of every project, and nothing else notices when it
moves.

## Description

1. **`versions`** resolves the latest `spring-io/antora-ui-spring` release tag.
2. **`setup`** expands [`config/projects.json`](../../config/projects.json) into one matrix
   entry per repo/branch, via the shared
   [`project-branch-matrix.js`](../scripts/project-branch-matrix.js).
3. **`update`** compares the branch's UI bundle tag against the target and, if behind, creates
   a branch, commits the one-line URL change, and opens a PR.
4. **`summary`** reports every combination in one table, and posts a Google Chat notification
   when anything changed.

## `docs/antora-playbook.yml` is per-branch

Unlike `maven-wrapper.properties`, this file documents its **own** branch —
`content.sources[].branches` is `HEAD` — so every maintained branch carries its own copy
rather than there being one canonical file on the default branch. Branches that predate
Antora adoption have no such file at all; those are reported as `no-playbook` rather than an
error.

### What is out of scope

- **`-internal` branches are skipped**, for the same reason
  [`update-maven-wrapper.yml`](README-update-maven-wrapper.md#what-is-out-of-scope) skips
  them: they are the in-flight development line for the next train.
- **A repository that ships no `docs/antora-playbook.yml` on any of its branches** never
  appears in the summary's table beyond a `no-playbook` row per branch — there is nothing
  broken to flag, it simply has not adopted Antora on that branch.

## What it changes

Only the UI bundle's release-download URL, via a textual, non-destructive replacement (the
same contract [`maven-wrapper-properties.js`'s `rewrite`](../scripts/README.md) gives for
`maven-wrapper.properties`) — everything else in the file, including comments, key order and
unrelated settings, is preserved byte-for-byte. Applying it to an already-current file is a
no-op.

A branch already **ahead** of the target (a manual override, or a target resolved before the
branch was last touched) keeps its own tag and is reported as `ahead` — never walked
backwards.

## Shared with `update-maven-wrapper.yml`

Rather than reimplementing the same mechanics, this workflow calls the same shared scripts
[`update-maven-wrapper.yml` uses](README-update-maven-wrapper.md):
[`project-branch-matrix.js`](../scripts/project-branch-matrix.js) for the matrix,
[`git-pr-helpers.js`](../scripts/git-pr-helpers.js) for reading a file at a ref, creating a
branch, committing via the git data API, and finding/opening a PR, and
[`merge-if-green.js`](../scripts/merge-if-green.js) for the auto-merge check. Only the
domain-specific rule — how to read and rewrite the UI bundle URL — lives in its own module,
[`antora-ui-bundle.js`](../scripts/antora-ui-bundle.js).

## DCO

Spring Cloud repositories run a **required DCO check**, so each commit carries a
`Signed-off-by` trailer and sets the commit author and committer explicitly to match it —
`spring-builds <spring-builds@users.noreply.github.com>`, same identity
`update-maven-wrapper.yml` uses.

## Triggers

- **`workflow_dispatch`** — on demand, with the inputs below.
- **`schedule`** — Mondays at ~10:00am US Eastern, as two month-selected cron entries (EDT
  `UTC-4` / EST `UTC-5`), a few hours after `update-maven-wrapper.yml`'s ~7:00am schedule so
  the two weekly runs don't land on the shared runner pool at the same moment.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `projects` | Comma-separated project names. Empty processes all of them. | No | `''` |
| `repo_type` | `both`, `oss`, or `commercial` | No | `both` |
| `bundle_version` | Target `spring-io/antora-ui-spring` release tag (e.g. `v0.4.26`). Empty uses the latest release. | No | `''` |
| `auto_merge` | Merge existing UI-bundle PRs whose checks have all passed. **Manual runs only** — see [Auto-merge](#auto-merge) | No | `true` |
| `merge_method` | `squash`, `merge`, or `rebase` | No | `squash` |
| `dry_run` | Report what would happen without creating, updating or merging anything | No | `true` |
| `notify` | Post a Google Chat notification when anything changed. Always on for the scheduled run | No | `true` |
| `token` | Needs `contents:write` and `pull-requests:write` on all targets. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

### What the weekly scheduled run actually does

A scheduled event carries **no inputs at all**, so every input falls back to what the
expressions decide rather than to the `default:` shown above, exactly as in
[`update-maven-wrapper.yml`](README-update-maven-wrapper.md#what-the-weekly-scheduled-run-actually-does):

| | Scheduled run | Manual dispatch |
|---|---|---|
| Dry run? | **No — it opens PRs** | Yes by default; uncheck `dry_run` to act |
| Merges green PRs? | **No** | Yes, if `auto_merge` is left checked |
| Notifies Chat? | **Always, if there's anything to report** | Only if `notify` is left checked |
| Scope | Every project, `oss` and `commercial` | As chosen |
| Target version | Latest `spring-io/antora-ui-spring` release | As chosen |
| `-internal` branches | Skipped | Skipped |

## Auto-merge

**The weekly scheduled run never merges.** The schedule opens and refreshes PRs, posts the
Chat notification, and leaves the decision to a human. `auto_merge` applies to a manual
dispatch only, making merging every green UI-bundle PR one deliberate click.

Only a PR that was *already* open when the run started is eligible — one opened or moved up
in the same run has not had CI run against it yet. Checks are read from `statusCheckRollup`
via the shared [`merge-if-green.js`](../scripts/merge-if-green.js), the same module
`update-maven-wrapper.yml` uses — a PR is merged only when every check passes *and*
`mergeable` is `MERGEABLE` *and* `mergeStateStatus` is `CLEAN`.

| Merge status | Meaning |
|---|---|
| `merged` | Merged and the head branch deleted |
| `would-merge` | Dry run — it would have been merged |
| `not-merged` | Reported with the reason: failing checks (named), checks still running, conflicts, no checks reported yet, or green-but-`BLOCKED` |
| `error` | The merge call itself failed |

Set `auto_merge` to false to only open and update PRs and leave merging to a human.

## Google Chat notification

Posted to `secrets.SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL` — the same webhook
[`rollout-actions-ref.yml`](README-rollout-actions-ref.md) and
[`dependabot-report.yml`](README-dependabot-report.md) already use for their own
notifications — with the run's summary counts and up to 15 PR links. Skipped silently, with a
line in the job log saying why, when the secret is unset or there is nothing to report: a
weekly "all clear" would only teach people to ignore the channel.

## Statuses

| Status | Meaning |
|---|---|
| `pr-opened` | A PR was created |
| `pr-updated` | An open PR was moved up to a newer target — see [Rerunning](#rerunning) |
| `would-open` / `would-update-pr` | Dry run — what would happen |
| `pr-open` | A PR is open and already at the target; nothing done |
| `branch-exists` | The branch exists with no open PR — a previous PR was closed unmerged, so it is **left alone** rather than reopened |
| `up-to-date` | Already on the target |
| `ahead` | Newer than the target; never walked backwards |
| `no-playbook` | No `docs/antora-playbook.yml` on this branch — it predates Antora adoption |
| `unparsed` | No UI bundle release-download URL matched the expected shape in the playbook — needs a look |
| `error` | An API call failed; the detail is in the summary |

## Rerunning

Safe to run repeatedly, for the same reason `update-maven-wrapper.yml` is — it derives
everything from current state, never from a queue:

| On rerun | Result |
|---|---|
| PR still open at the target, checks green | `pr-open` — merged only on a manual run with `auto_merge` on; a scheduled run leaves it |
| PR still open at the target, checks red or pending | `pr-open` — left for a human |
| PR merged | The branch is now current → `up-to-date` |
| PR open, but a **newer release** has since shipped | `pr-updated` — the commit lands on the **existing** PR's branch, moving it up in place |
| PR closed unmerged, branch still present | `branch-exists` — left alone, so a deliberate rejection is not re-litigated |
| PR closed unmerged, branch deleted | A fresh PR is opened |

**One PR per repo/branch, always at the current target.** The head branch name includes both
the base branch and the target tag —
`antora-ui-bundle-update/<branch>-<tag>` — and existing PRs are matched by prefix and base
rather than by exact head name, so a PR opened for an earlier release is found and moved up
rather than having a second PR stacked on top of it.

## Notes

- One branch failing never stops the others (`fail-fast: false`, `max-parallel: 8`); errors
  are collected and listed in the summary.
- A `Release Freeze` from [`lock-unlock-branches.yml`](README-lock-branches.md) restricts
  pushes to the frozen release branches, so the PR branch itself is created fine, but the PR
  cannot be merged until the freeze lifts.
