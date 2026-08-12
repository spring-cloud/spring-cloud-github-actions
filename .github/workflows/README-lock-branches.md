# Lock Branches

A dispatchable workflow that freezes — or unfreezes — the branches of some or all Spring Cloud projects, so nothing can be pushed to them while a release is being staged.

## Description

An OSS release is built on a `release/<version>` branch in the commercial repo, and [post-release](README-post-release.md) later merges those commits back into the OSS `.x` branch and pushes the tag there. Anything that lands on `.x` in between turns that merge into a conflict — most sharply on the version lines, since [update-versions](README-update-versions.md) may have moved the branch to the next snapshots in the meantime. Freezing the branches for the duration removes the problem rather than managing it.

It:

1. **Builds a matrix** from [`config/projects.json`](../../config/projects.json) — one entry per repository, carrying every branch to freeze
2. **Creates, updates or deletes** each repository's `Release Freeze` ruleset
3. **Writes a summary table** and fails the run if any repository could not be done

## How the freeze works

A repository ruleset named **`Release Freeze`**, holding exactly the branches the run froze:

```json
{ "name": "Release Freeze", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main", "..."], "exclude": [] } },
  "rules": [ {"type":"creation"},
             {"type":"update","parameters":{"update_allows_fetch_and_merge":false}},
             {"type":"deletion"},
             {"type":"non_fast_forward"} ] }
```

Between them those four rules reject a push, a force push, a delete, and a re-create. Unlocking deletes the ruleset outright.

### It is deliberately a separate ruleset

[retire-branch](README-retire-branch.md) also locks branches, using a long-lived ruleset of its own called `Locked Branches` that accumulates retired branches permanently. **This workflow never touches that one.** Rulesets are additive — GitHub aggregates every ruleset matching a ref and applies the most restrictive — so the two coexist, and a branch that is both retired and frozen stays locked when the freeze is lifted.

Keeping them apart is what makes this workflow's writes whole-object: a single `POST` to freeze and a single `DELETE` to unfreeze. Sharing one ruleset would mean a read-modify-write of a list another workflow appends to, with all of the attendant hazards — dropping somebody else's refs, having to echo `bypass_actors` back on every write, and an unfreeze that could un-retire a retired branch. None of those are possible here.

### What a freeze does not cover

Only the `Release Freeze` ruleset is managed. A branch can still be locked afterwards by the `Locked Branches` ruleset, by an organization-level ruleset, or by classic branch protection — none of which this workflow reads or writes. If a push is still rejected after a successful unlock, that is where to look.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `projects` | Comma-separated project names, **bare** — no `-commercial` suffix, `repo_type` carries that. Empty processes every project. | No | string |
| `unlock` | Unlock instead of lock — deletes the `Release Freeze` ruleset from each repository. | No | boolean (default: `false`) |
| `repo_type` | Which flavours to act on: `both`, `oss`, or `commercial` | No | choice (default: `both`) |
| `dry_run` | Report what would change without creating, updating or deleting anything | No | boolean (default: `true`) |
| `token` | Token with `administration: write` on all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

Note the `projects` names are bare here, unlike [post-release](README-post-release.md) and [update-versions](README-update-versions.md) where the `-commercial` suffix decides the flavour. This workflow takes `repo_type` instead, matching [ci-status-report](README-ci-status-report.md) and [rollout-deploy-docs](README-rollout-deploy-docs.md).

The workflow is also **callable** (`workflow_call`), so the unlock can be wired into a release workflow later. `workflow_call` has no `choice` type, so `repo_type` is a plain string on that side and is validated in the setup job.

## A freeze blocks the automation too

No `bypass_actors` is set, so a frozen branch rejects **every** push, including the one `GH_ACTIONS_REPO_TOKEN` makes. [post-release](README-post-release.md) cannot merge the release branch back, push the version bump, or push the tag to a frozen branch — and since publishing the GitHub release now depends on that tag arriving, a forgotten unfreeze stops the release, visibly.

**So the unlock has to run before post-release**, not after it. The summary of a successful lock says so explicitly.

## Which branches

Every branch under the chosen section's `branches` in `projects.json` — the deduped union of `branches.scheduled` and `branches.default`. As of writing that is 79 branches across 34 repository sections.

The union rather than just `scheduled` because a freeze that let commits through on the default branch would be worse than no freeze at all. `default` is a subset of `scheduled` everywhere in the file today, but nothing enforces that.

## One matrix leg per repository

All of a repository's frozen branches live in a single ruleset, so the fan-out is per repository and each leg makes one API call. A per-branch fan-out would have several legs writing the same object at once.

For the same reason across *runs*, the workflow declares `concurrency: { group: lock-branches, cancel-in-progress: false }` — two overlapping runs in opposite directions would otherwise resolve by whichever write landed last. It queues rather than cancels: stopping a run mid-write would leave some repositories frozen and others not.

## Unlock is all-or-nothing per repository

Unlocking deletes the whole `Release Freeze` ruleset, which unfreezes every branch in it — not just the ones named by that run. That matches the filter being per project rather than per branch, and the ruleset only ever contains what a previous lock run put there.

To unfreeze part of the estate, filter by `projects`.

## Safety

- **`dry_run` defaults to `true`.** A dry run prints the exact request body it would send and makes no write call.
- **A repository already in the requested state is reported and skipped**, with no API call — so a re-run is free, and the summary distinguishes "froze it" from "was already frozen".
- **A leg never fails.** Every API call is checked; failures are recorded and reported, and the summary job is what exits non-zero. A leg that died silently would drop that repository from the table, which for a freeze reads as success.
- **`fail-fast: false`** so one bad repository does not abandon the rest, and **`max-parallel: 8`** keeps the fan-out from saturating the runner pool.
- **An unknown name in `projects` fails the run**, listing the known ones. Processing nothing and reporting success is the wrong answer when the question was "is everything frozen?".

## Suggested sequence

1. **Dry run, one project**: `projects: spring-cloud-config`, `repo_type: oss`. Check the branch list and the printed ruleset body.
2. **Dry run, everything**: check the summary covers what you expect.
3. **Real run**: `dry_run: false`. Confirm with `gh api repos/spring-cloud/spring-cloud-config/rulesets --jq '.[] | select(.name=="Release Freeze")'`.
4. **When the tags exist**: re-run with `unlock` checked, **before** [post-release](README-post-release.md).

## Related workflows

- [post-release.yml](README-post-release.md) — merges the release branch back and pushes the tag; needs the branches unfrozen first
- [update-versions.yml](README-update-versions.md) — the snapshot bump, which also pushes to these branches
- [retire-branch.yml](README-retire-branch.md) — the other user of branch-locking rulesets, permanent rather than temporary
