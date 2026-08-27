# Dependabot Report Workflow

A scheduled, read-only report covering the state of Dependabot across every OSS and
commercial Spring Cloud repository: which of Dependabot's own update jobs are failing, and
how many open Dependabot PRs are ready to merge, blocked by failing checks, conflicting, or
targeting a branch that is no longer maintained.

## Description

1. **`setup`** expands [`config/projects.json`](../../config/projects.json) into one matrix
   entry per repository (not per branch — Dependabot PRs are listed repo-wide, so fanning
   out per branch would fetch the same list several times).
2. **`releaser-map`** reads the `jenkins-releaser-config` branch of `spring-cloud-release`
   and `spring-cloud-release-commercial` once, building a `{type: {project: {version:
   train}}}` map, then gap-fills the OSS side from the commercial side, and shares the
   result with the scan jobs as an artifact. This is what resolves which GitHub Project a
   PR belongs to — see [Project resolution](#project-resolution).
3. **`scan`** runs the [`dependabot-scan`](../actions/dependabot-scan/action.yml) action
   per repository and uploads its JSON result.
4. **`summary`** merges every result into a job-summary table plus detail sections, and
   posts the same facts to Google Chat.

**The workflow always succeeds**, regardless of what it finds — it reports, it does not
gate. Watch the job summary or the Chat message, not the run's pass/fail status.

## Triggers

- **`workflow_dispatch`** — on demand, with the inputs below.
- **`schedule`** — weekdays at ~7:17am US Eastern, **an hour after**
  [`dependabot-triage.yml`](README-dependabot-triage.md), so this report describes the state
  once triage has filed, merged and closed — not a backlog already dealt with by the time
  anyone reads it.

  As in [`ci-status-report.yml`](ci-status-report.yml), this is two month-selected cron
  entries (EDT `UTC-4`, EST `UTC-5`) because GitHub Actions cron is always UTC with no
  notion of DST. Triage uses the same split and the same weekdays, so the one-hour gap holds
  all year — at a DST boundary both shift together, preserving their order. The minute is
  `:17` rather than `:00` because GitHub flags the top of the hour as the most congested
  slot, and it is offset from `ci-status-report.yml`'s `:07` so the two reports do not
  contend for runners or land as one wall of text.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `projects` | Comma-separated project names. Empty checks all of them. | No | `''` |
| `repo_type` | `both`, `oss`, or `commercial` | No | `both` |
| `notify` | Post the summary to Google Chat | No | `true` |
| `token` | Token with read access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GH_ACTIONS_REPO_TOKEN` | Read access to Actions, Contents, Issues and Pull Requests on every target repo. | Yes (unless `token` is given) |
| `SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL` | Google Chat incoming webhook. If unset, the notification step logs that it is skipping and the run still succeeds. | No |

Use [`check-token-permissions.yml`](README-check-token-permissions.md) to confirm a token
can do everything this workflow needs.

## What counts as what

Each open Dependabot PR is put in exactly one bucket, first match winning:

| State | Rule |
|-------|------|
| `unmaintained` | Base branch is not in `projects.json` (nor an [extra branch](#the-docs-build-exception)) — the branch is retired and locked, so the PR cannot merge and should be closed |
| `conflicting` | `mergeable == CONFLICTING` — needs `@dependabot rebase` |
| `failing` | Any check is `FAILURE`, `TIMED_OUT`, `ERROR`, `STARTUP_FAILURE` or `CANCELLED` |
| `pending` | Any check has not completed |
| `unknown` | GitHub still will not say whether it merges cleanly |
| `blocked` | Every check passed, but GitHub reports `BLOCKED` — branch protection or an unreported required check |
| `ready` | Every check passed and it can actually be merged |

Two things about this ordering are deliberate.

**Maintenance is tested before anything else.** A retired branch is *locked*, so its PRs
report `mergeStateStatus: BLOCKED` even with every check green —
`spring-cloud-openfeign#1332` on the retired OSS `4.2.x` is exactly this. Describing such a
PR in terms of its checks would bury the only fact that matters: the branch is gone and the
PR should be closed.

**Checks are read from `statusCheckRollup`, not inferred from `mergeStateStatus`,** which
conflates a locked branch, missing reviews, and unreported required checks into one value.
Conversely, a green PR that GitHub still refuses to merge is reported as `blocked` rather
than `ready`, so that everything listed as ready can genuinely be merged. `blocked` is
listed with the raw `mergeStateStatus` so the cause is visible.

`unknown` is a real state rather than an error: GitHub computes mergeability lazily and
returns `UNKNOWN` until it has. Asking for the PR is what triggers the computation, so the
scan re-reads the list once after a short pause, which resolves it in practice.

## Milestone and project checks

For PRs on **release** branches the scan also works out what *should* be set, so the triage
workflow has something to act on and the report can flag gaps. PRs on
[extra branches](#the-docs-build-exception) such as `docs-build` are skipped entirely —
they belong to no release train and need neither a milestone nor a board:

- **Milestone** — the base branch's project version with `-SNAPSHOT` stripped (the same
  string [`post-release.yml`](post-release.yml) creates milestones with). Reported as
  `set`, `unset` (exists but not applied), `mismatch` (a different one is applied — never
  overwritten, only reported), or `missing` (no such milestone exists, which is the warning
  the design calls for).
- **Project** — OSS only, resolved as below. Commercial PRs get a milestone and no board.

### Project resolution

Take the PR's base-branch project version, find the `*-snapshot.properties` file on
`jenkins-releaser-config` whose `releaser.fixed-versions[<project>]` equals it, and read
that file's `releaser.fixed-versions[spring-cloud-release]` value minus `-SNAPSHOT`. That
is the org-level Project board title.

```
spring-cloud-build@main = 5.0.3-SNAPSHOT
  → 2025_1_3-snapshot.properties has releaser.fixed-versions[spring-cloud-build]=5.0.3-SNAPSHOT
  → that file's releaser.fixed-versions[spring-cloud-release]=2025.1.3-SNAPSHOT
  → board "2025.1.3"
```

This was validated against all 16 OSS maintained branches: 16/16 resolved to exactly one
train, with no ambiguity. Because the match is on the exact version string, already-released
trains left behind in the config cause no false positives.

#### Commercial fallback

The OSS map is gap-filled from `spring-cloud-release-commercial`'s copy of
`jenkins-releaser-config`. Commercial is where a new train's snapshot file lands first: when
a train is opened and the `.x` branches are bumped, the OSS file can lag by days, and every
PR against a bumped branch reports "could not resolve project" until it appears. This is
what happened when 2025.1.4 opened — `main` moved to `5.0.4-SNAPSHOT` while the newest OSS
file was still `2025_1_3-snapshot.properties` (`5.0.3-SNAPSHOT`), so all 21 `main` PRs went
unresolved.

The fallback only *adds* versions the OSS files do not already carry, so an authoritative
OSS mapping is never overwritten. Commercial-only trains are skipped — titles such as
`2025.1.2.1` and `2025.1.3-INTERNAL` have no OSS board, so only plain `YYYY.N.N` trains are
adopted. Their version keys (`5.0.2.1-SNAPSHOT`, `5.0.3-INTERNAL-SNAPSHOT`) cannot collide
with an OSS branch version anyway.

This report only *resolves* the expected board; it does not read board membership, which
would need the `project` scope the token may not have.

### The `docs-build` exception

Dependabot legitimately targets `docs-build`, which is a maintained branch that never
appears in `projects.json` because it is not a release branch. Without an exception every
`docs-build` PR would be reported as "invalid, should be closed". The scan action's
`extra-branches` input holds these (default `docs-build`).

**This applies to OSS and commercial repositories alike** — `extra-branches` is added to the
maintained set regardless of repo type, and Dependabot does run against `docs-build` on both
(e.g. `spring-cloud-gateway-commercial` and `spring-cloud-build-commercial` both have recent
`docs-build` update runs).

**Extra branches are maintained but are not release branches**, so
[milestone and project checks are skipped for them](#milestone-and-project-checks) and both
states report `n/a`. This is not merely tidier: `docs-build` carries its own `pom.xml` with a
placeholder version (`0.0.1-SNAPSHOT`), so treating it as a release branch would derive an
expected milestone of `0.0.1` and then report that milestone as missing on every docs PR.
Such a PR is still classified normally (`ready`, `failing`, and so on) — only the milestone
and project checks are skipped.

## Output

```
**10** open Dependabot PR(s) across **4** repositories — **1** ready to merge,
**0** blocked by failing checks, **0** green but not mergeable, **1** conflicting,
**0** pending.

| | Repo | Type | Open | Ready | Failing | Blocked | Conflicting | Pending | Invalid | Update jobs |
|---|---|---|---|---|---|---|---|---|---|---|
| ❔ | `spring-cloud/does-not-exist` | oss | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ❔ |
| ⚠️ | `spring-cloud/spring-cloud-build` | oss | 9 | 1 | 0 | 0 | 1 | 0 | 7 | ✅ |
| ✅ | `spring-cloud/spring-cloud-gateway` | oss | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
```

Detail sections follow for anything needing attention: **Could not be scanned**, **Failing
Dependabot update jobs**, **Ready to merge**, **Blocked by failing checks**, **Green but not
mergeable**, **Conflicting**, **Missing milestone**, **Milestone mismatch**, **Could not
resolve project**, **On unmaintained branches**, and **Warnings**. Empty sections are
omitted.

The Chat message carries the same facts in Chat's own formatting (`*bold*`, `<url|text>`),
capped at 15 entries per section with an "…and N more" line, plus a link back to the run.

## How update-job failures are decided

Dependabot's update runs are grouped by **ecosystem, directory and branch**, and only the
**latest** run per group counts — the question is "is this update broken now?", not "has it
ever failed?".

Two details stop that from producing false alarms:

**The dependency is deliberately left out of the grouping key.** Run names come in two
shapes:

```
maven in /. - Update #1512675253                                  recurring, whole ecosystem
maven in /. for org.bouncycastle:bcprov-jdk18on - Update #1369244864   one-off, one dependency
```

The second is what a security advisory or an `@dependabot recreate` produces, and it never
runs again under that name. Keying on the dependency would give each such run a group of its
own in which it is permanently the newest, so a single old failure would be reported as
currently-failing forever. Grouping by scope instead means a later run covering the same
ecosystem/directory/branch supersedes it, which is what actually happened: a one-off
`bcprov-jdk18on` update that failed in May was reported as a live failure in
`spring-cloud-commons` months later, even though every run since had passed.

A name that does not parse still has its trailing `- Update #<id>` stripped before being
used as a key, so an unrecognised format degrades to one group per scope rather than one per
run.

**Failures older than `stale-days` (default 14) are reported separately.** A scope whose last
run is long past is not evidence about today — retired branches are the common case, since
their updates stop for good and a final failed run would otherwise be reported every day
from then on. These appear under **Stale update-job failures** rather than being dropped, so
a genuinely stalled scope stays visible without being called a current failure.

## Why a silent zero is treated as a failure

Two ways this report could quietly lie, both guarded against:

- **Transient API errors.** `gh pr list` goes through the GraphQL endpoint, which returns
  the occasional 502/504 — observed live during development. Without a retry that surfaces
  as "0 open PRs", which reads as good news. Calls are retried three times with backoff,
  and a repo whose list still cannot be read is marked `❔` and listed under **Could not be
  scanned** rather than counted as clean.
- **Unreadable repositories.** `gh pr list` answers with an empty array and **exit code 0**
  for a repo it cannot see, so a renamed, deleted or permission-denied repo would look like
  one with no open PRs. The scan issues an explicit `repos/{repo}` check to turn that into a
  visible error.

In both cases the header also states how many repositories could not be scanned, so partial
results are never presented as complete.

## Notes

- `max-parallel: 8` and `fail-fast: false`, matching `ci-status-report.yml`.
- The scan is read-only, so it is safe to run at any time and is shared with the triage
  workflow rather than duplicated.
- Update-job grouping and the staleness window are described in
  [How update-job failures are decided](#how-update-job-failures-are-decided).
