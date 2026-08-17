# Dependabot Triage Workflow

Acts on the open Dependabot PRs that [`dependabot-report.yml`](README-dependabot-report.md)
only describes: sets the milestone matching the PR's base branch, adds OSS PRs to the
release train's org-level GitHub Project, and asks Dependabot to rebase a PR that has fallen
into conflict.

Implements features 2 and 3 of
[`DESIGN-dependabot-automation.md`](../../DESIGN-dependabot-automation.md).

**Defaults to a dry run**, in the same way [`post-release.yml`](README-post-release.md) and
[`lock-unlock-branches.yml`](README-lock-branches.md) do. Nothing is changed until you
re-run with `dry_run` unchecked.

## Description

1. **`setup`** expands [`config/projects.json`](../../config/projects.json) into one matrix
   entry per repository.
2. **`releaser-map`** reads the `jenkins-releaser-config` branch once and shares it as an
   artifact — same as the report.
3. **`triage`** runs the shared [`dependabot-scan`](../actions/dependabot-scan/action.yml)
   action per repository, then applies the three actions below.
4. **`summary`** merges the per-repo results into one job-summary table.

**Triage never re-derives PR state itself** — it consumes exactly the same read-only scan
the report does, so a PR can't be classified one way in the report and another way here.

## What it does

For each open Dependabot PR, in order:

| Action | When | Behaviour |
|---|---|---|
| **Milestone** | `milestoneState == unset` | Sets the milestone matching the base branch's version |
| **Project** | `projectState == resolved` and the PR is not already on the board | Adds it via GraphQL `addProjectV2ItemById` |
| **Rebase** | `state == conflicting` | Comments `@dependabot rebase` — see [Rebase idempotency](#rebase-idempotency) |

### What it deliberately does not do

- **PRs on retired branches are skipped entirely.** Those branches are locked, so their PRs
  cannot merge; the report lists them for closing instead. See
  [Agreement with branch locking](#agreement-with-branch-locking).
- **A missing milestone is never created.** It is reported and left alone, so which
  milestones exist stays a human decision about the release train.
- **An existing, different milestone is never overwritten.** A mismatch is recorded and
  skipped, so a deliberate human choice survives.
- **`docs-build` PRs get neither a milestone nor a board.** They belong to no release train —
  see the [report's note](README-dependabot-report.md#the-docs-build-exception) on why this
  matters (that branch carries a placeholder `0.0.1-SNAPSHOT` version).
- **Nothing is merged or closed.** Merging is out of scope pending the team's decision.

## Rebase idempotency

A scheduled job must not re-comment `@dependabot rebase` on a permanently conflicting PR
every time it runs. The rule is stateless — no cache, no marker file, nothing to keep in
sync:

> Comment only if there is no `@dependabot rebase` comment **newer than the PR's current
> head commit**.

A rebase that produced a new head makes the PR eligible again; a rebase that changed nothing
does not. So a conflict Dependabot cannot resolve is asked about exactly once, and a PR that
falls back into conflict after a genuine update is asked again.

## Agreement with branch locking

Triage's core safety property is that it never touches a PR against a retired branch. That
holds because [`retire-branch.yml`](README-retire-branch.md) does all of this in one run:
removes the branch from `projects.json`, removes its Dependabot entries, and adds it to the
permanent **"Locked Branches"** ruleset. So `projects.json` — which is what the scan keys
off — and the lock are updated together, and cannot disagree.

Note this is a different mechanism from
[`lock-unlock-branches.yml`](README-lock-branches.md), whose **"Release Freeze"** ruleset is
a temporary staging freeze. A freeze restricts pushes to the frozen release branches; it
does not block setting a milestone, adding a board item, or commenting, so triage keeps
working normally during one. (It does mean a PR the report calls "ready to merge" cannot
actually be merged until the freeze lifts.)

## Triggers

- **`workflow_dispatch`** — on demand, with the inputs below.
- **`schedule`** — every four hours (`41 */4 * * *`). Dependabot opens PRs once a day per
  repository but not at a shared time (`spring-cloud-commons` runs ~03:22 UTC,
  `spring-cloud-gateway` ~16:32 UTC), so no single slot catches everything promptly. Hourly
  was the original intent, but one job per repository means ~35 jobs per run and runner
  startup dominates the ~15s of real work; every four hours keeps the worst-case wait for a
  milestone well under a working day at a sixth of the runner minutes. Nothing downstream
  depends on the latency — the daily report re-derives state from scratch.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `projects` | Comma-separated project names. Empty processes all of them. | No | `''` |
| `repo_type` | `both`, `oss`, or `commercial` | No | `both` |
| `dry_run` | Report what would change without changing it | No | `true` |
| `token` | Token with write access to issues/PRs and the `project` scope. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GH_ACTIONS_REPO_TOKEN` | Needs repo write (milestones, comments) **and the `project` scope** for the board step. | Yes (unless `token` is given) |

Run [`check-token-permissions.yml`](README-check-token-permissions.md) to confirm a token
can do all of this — the `project` scope is not implied by `repo` or `admin:org`, and is the
one that has actually been missing before.

## Output

```
## Dependabot Triage

> **Dry run** — nothing was changed. Re-run with `dry_run` unchecked to apply.

7 pending change(s), 0 applied, 3 already done, 1 skipped, 0 error(s) across 2 repositories.

| Repo | PR | Action | Status | Detail |
|---|---|---|---|---|
| `spring-cloud/spring-cloud-build` | #902 | milestone | _would_ | set 5.0.3 |
| `spring-cloud/spring-cloud-build` | #904 | rebase | _would_ | comment @dependabot rebase |
| `spring-cloud/spring-cloud-build` | #907 | milestone | skipped | milestone 9.9.9 does not exist |
```

Statuses are `would` (dry run), `set` / `added` / `requested` (applied), `already` (nothing
needed), `skipped` (deliberately not done, with the reason), and `error`. Repositories where
everything was already in order are left out of the table entirely.

## Notes

- **No Google Chat notification.** The daily report is what the team reads, and it re-derives
  everything from scratch — so if triage fails or is misconfigured, the gaps simply show up
  in the next report as unset milestones or unresolved projects. Triage failing quietly
  cannot hide anything.
- **A failure on one PR never stops the rest.** Errors are collected per PR and listed under
  **Errors** in the summary; the job still ends green, and the next run retries whatever
  did not take, since every action is derived from current state rather than a queue.
- Write calls use the same three-attempt backoff as the scan, so a transient 502 does not
  leave a PR untouched until the next scheduled run.
- `max-parallel: 8` and `fail-fast: false`, matching the other reporting workflows.
