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
| **Close** | `state == unmaintained` | Comments why, then closes — see [Closing PRs on unmaintained branches](#closing-prs-on-unmaintained-branches) |
| **Merge** | a green `npm` / `github_actions` PR — see [Merging green dependency PRs](#merging-green-dependency-prs) | Merges with `merge_method` |

### What it deliberately does not do

- **A missing milestone is never created.** It is reported and left alone, so which
  milestones exist stays a human decision about the release train.
- **An existing, different milestone is never overwritten.** A mismatch is recorded and
  skipped, so a deliberate human choice survives.
- **`docs-build` PRs get neither a milestone nor a board.** They belong to no release train —
  see the [report's note](README-dependabot-report.md#the-docs-build-exception) on why this
  matters (that branch carries a placeholder `0.0.1-SNAPSHOT` version).
- **Maven PRs are never merged.** Those change what the projects ship. Only `npm` and
  `github_actions` updates — build and docs tooling — are merged automatically.

## Merging green dependency PRs

With `merge_green` (on by default, including on the schedule), a PR is merged when **all**
of these hold — in **OSS and commercial** repositories alike:

| Condition | Why |
|---|---|
| Ecosystem is **`npm_and_yarn`** or **`github_actions`** | Build and docs tooling. **Maven is never merged** — those change what the projects ship |
| `state == ready` | Every check passing, mergeable, and a `CLEAN` merge state |
| Milestone is set — *release branches only* | Merging must not lose the record of which train shipped it |
| Project board is set — *OSS release branches only* | Commercial PRs are never added to a board, so requiring one would block them permanently |

**Only the board requirement is OSS-specific**, and it is taken from the scan's own verdict
rather than re-decided here: `projectState` is `n/a` exactly when no board was ever expected,
which covers commercial repositories and `docs-build` together.

The ecosystem comes from Dependabot's own branch name
(`dependabot/npm_and_yarn/docs/main/antora-3.2.0`), which is the only reliable source: a PR
title names the dependency, not what manages it.

**`docs-build` is exempt from both requirements.** That branch belongs to no release train
and gets neither a milestone nor a board by design, so requiring them would mean never
merging a docs update at all.

**Eligibility is evaluated after this run's own work**, not from the scan — so a PR this run
has just milestoned and added to the board is merged immediately, rather than waiting four
hours for the next run. A PR still missing either is reported as
`not filed yet - waiting on milestone and project` and reconsidered next time.

Nothing here re-derives mergeability: `ready` already means CI passed and GitHub reports a
clean merge state, so branch protection, conflicts and pending checks are excluded upstream.

### Why a PR was not merged

Every eligible PR that is **not** merged records the reason, so the summary answers "why is
this one not in the list?" rather than leaving it out:

| Reported as | Meaning |
|---|---|
| `checks failing: build (17), DCO` | Named, so it is clear what to look at |
| `checks still running: build (21)` | Will be reconsidered next run |
| `conflicts with the base branch` | Needs a rebase — see [Rebase idempotency](#rebase-idempotency) |
| `all checks pass but GitHub reports BLOCKED` | Branch protection, usually a required review |
| `GitHub has not resolved mergeability yet` | Transient; resolves on a later run |
| `not filed yet - waiting on milestone and project` | Triage has not finished filing it |
| `maven is never auto-merged` | Policy — **dry runs only** |

The last one is deliberately dry-run-only. It can never change for that PR, so it belongs in
an explanation of the plan, not in a run reporting what it changed — otherwise every real run
would carry a row per open Maven PR saying nothing new.

Set `merge_green` to false to leave every PR for a human.

## Closing PRs on unmaintained branches

A Dependabot PR whose base branch is not in `projects.json` targets a **locked** branch: it
can never merge, and it will sit open forever. With `close_unmaintained` (on by default,
including on the schedule) triage comments the reason and then closes it.

**The comment is posted first, and it is the point.** Closing in silence leaves no way to
tell a deliberate close from a mistaken one, and the judgement rests entirely on
`projects.json` — which is wrong if a still-live branch was dropped from it. So the comment
names the branch, links `projects.json`, and says what to do if the call was wrong:

> Closing automatically: `4.3.x` is no longer a maintained branch of this repository (it is
> not listed in config/projects.json), so this update cannot be merged here.
>
> If that is wrong — the branch is still maintained and was dropped from projects.json by
> mistake — reopen this PR and restore the branch there.

If the comment cannot be posted the PR is **not** closed, and the failure is reported. An
unexplained close is worse than none: closing is reversible, but only if someone can tell
why it happened.

Milestone and project are skipped for these PRs — there is no train to file them under.

Set `close_unmaintained` to false to go back to reporting them and leaving them open.

## Notifications

A Google Chat message is posted **only when a PR was actually closed or merged**. Setting a
milestone or adding a board item happens on most runs and is not worth a message; a PR
changing hands is something the team should hear about without going to look for it.

```
🤖 *Dependabot Triage* — 1 merged, 2 closed

*Merged* (1)
• spring-cloud/spring-cloud-openfeign <#1500> — squash

*Closed — branch no longer maintained* (2)
• spring-cloud/spring-cloud-openfeign <#1332> — 4.2.x
• spring-cloud/spring-cloud-openfeign <#1400> — 4.3.x
```

Two details:

- **A dry run can never send one.** It records `would`, never `closed` or `merged`, so the
  status itself is the gate — there is no separate dry-run check to get wrong.
- **`merged` is already handled** even though triage does not merge yet, so adding merging
  later needs no change here.

Sent to `SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL`, the same webhook
[`dependabot-report.yml`](README-dependabot-report.md) and
[`ci-status-report.yml`](README-ci-status-report.md) use. If it is unset the step logs that
it is skipping and the run still succeeds.

Everything else stays in the job summary. The daily report re-derives state from scratch, so
a quiet failure here still surfaces there as unset milestones or unresolved projects.

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
- **`schedule`** — once a day on weekdays at ~6:17am US Eastern, **an hour before**
  [`dependabot-report.yml`](README-dependabot-report.md). Triage files, merges and closes
  first, so the report the team reads describes the state *after* that work rather than a
  backlog already dealt with.

  Both workflows use the same two month-selected cron entries for DST (EDT `UTC-4`, EST
  `UTC-5`) and the same weekdays, so the one-hour gap holds all year instead of drifting to
  two hours or zero at a DST boundary. **Keep the two in step** — an hour is comfortably
  longer than a triage run, but GitHub starts scheduled runs 8–23 minutes late in practice,
  so a smaller gap would not reliably preserve the order.

  A consequence worth knowing: a PR opened after triage runs waits until the next weekday
  morning. Dependabot opens PRs at staggered times (`spring-cloud-commons` ~03:22 UTC,
  `spring-cloud-gateway` ~16:32 UTC), so one opened in the afternoon is filed and merged the
  following morning, not the same day.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `projects` | Comma-separated project names. Empty processes all of them. | No | `''` |
| `repo_type` | `both`, `oss`, or `commercial` | No | `both` |
| `merge_green` | Merge green npm / github_actions PRs (OSS and commercial) | No | `true` |
| `merge_method` | `squash`, `merge`, or `rebase` | No | `squash` |
| `close_unmaintained` | Close PRs against branches no longer in `projects.json` | No | `true` |
| `dry_run` | Report what would change without changing it | No | `true` |
| `token` | Token with write access to issues/PRs and the `project` scope. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GH_ACTIONS_REPO_TOKEN` | Needs repo write (milestones, comments) **and the `project` scope** for the board step. | Yes (unless `token` is given) |
| `SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL` | Google Chat webhook for the close/merge notification. Unset means the step skips and the run still succeeds. | No |

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

- **Google Chat only when a PR changes hands.** See
  [Notifications](#notifications) — routine triage stays silent.
- **A failure on one PR never stops the rest.** Errors are collected per PR and listed under
  **Errors** in the summary; the job still ends green, and the next run retries whatever
  did not take, since every action is derived from current state rather than a queue.
- Write calls use the same three-attempt backoff as the scan, so a transient 502 does not
  leave a PR untouched until the next scheduled run.
- `max-parallel: 8` and `fail-fast: false`, matching the other reporting workflows.
