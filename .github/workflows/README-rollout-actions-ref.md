# Rollout Actions Ref

Repoints every consumer reference to this repository at a released commit SHA, annotated with the tag it came from, across every branch listed under `branches.scheduled` in [config/projects.json](../../config/projects.json).

```yaml
uses: spring-cloud/spring-cloud-github-actions/.github/workflows/deploy.yml@d52d95a… # v1.0.0
```

Defaults to a dry run.

## Why a SHA and not the tag

A SHA is immutable: moving or deleting a tag cannot change what a consumer runs. The tag rides along as a comment so the pin stays readable, and **Dependabot maintains both** — every consumer repository already runs the `github-actions` ecosystem, which [supports reusable workflows](https://github.blog/changelog/2023-03-13-dependabot-updates-support-reusable-workflows-for-github-actions/) pinned by SHA and [updates the accompanying version comment](https://github.blog/changelog/2022-10-31-dependabot-now-updates-comments-in-github-actions-workflows-referencing-action-versions/). After the one-time migration, later releases arrive as Dependabot PRs.

The trade-off: consumers no longer follow the floating `vX` tag, so **rollback means re-running this workflow at the previous release's tag** rather than moving a tag. That is why this is a workflow and not a one-off script.

## Weekly drift check

Runs every Monday (`0 12 * * 1`) as a **dry run**, comparing the refs on every scheduled branch against the current release. When anything has drifted it posts to Google Chat listing the repository, branch, and files, and says to run this workflow to fix them. When everything is current it posts nothing — a weekly "all clear" only teaches people to ignore the channel.

A scheduled run can never push. `schedule` events carry no inputs, so `inputs.dry_run` is null there; the workflow forces the dry run rather than passing that through, because an empty value would otherwise reach the sync action as "not a dry run" and it would commit to every branch.

Unlike the other scheduled workflows here, this one is not restricted to March–October. That window keeps them aligned to EDT, but it would also silence this report for four months a year.

## Inputs

| Name | Default | Description |
|------|---------|-------------|
| `projects` | *(all)* | Comma-separated project names, e.g. `spring-cloud-build,spring-cloud-config` |
| `repo_type` | `both` | `oss`, `commercial`, or `both` |
| `to_ref` | *(latest release)* | Tag to pin to. Empty resolves the latest published release. |
| `dry_run` | `true` | When true, reports what would change and pushes nothing. Always true on a scheduled run. |
| `notify` | `false` | Post the out-of-date summary to Google Chat. Always on for scheduled runs; off by default for manual ones, so a dry run you are watching does not also ping the channel. |
| `token` | `GH_ACTIONS_REPO_TOKEN` | Token with write access to the target repositories |

## What it targets

One matrix entry per `(repository, branch)` pair drawn from `branches.scheduled`, with the set of files to rewrite decided per branch:

| Branch | Files rewritten | Why |
|---|---|---|
| `*-internal` | `ci-release.yml` only | These are rebased from their OSS branch, so a pin written into their `ci.yml` / `pr.yml` would be overwritten. `ci-release.yml` exists only on these branches and survives the rebase. |
| everything else | everything except `ci-release.yml` | `ci.yml` / `pr.yml` are the source of truth here, and flow into the `-internal` branches by rebase. |

That is deliberately the set of branches actively built:

- **`ci-release.yml` is only ever touched on `-internal` branches**, and never anywhere else — that split is what keeps the rollout from fighting the rebase.
- **Retired branches are not touched.** `retire-branch` removes them from `projects.json`, and their `Locked Branches` rulesets have no bypass actors, so a push would fail by design.
- **`docs-build` branches are not touched here.** They carry the `deploy-docs` caller and are handled by [rollout-deploy-docs](README-rollout-deploy-docs.md), which resolves the same release.
- **Archived repositories are not reachable** and are excluded from `projects.json`.

## Typical use

```
# 1. see what would change, everywhere
dry_run: true

# 2. canary a single project
projects: spring-cloud-cloudfoundry, repo_type: commercial, dry_run: false

# 3. the rest
repo_type: commercial, dry_run: false
repo_type: oss,        dry_run: false

# 4. the docs-build branches
run "Rollout Deploy Docs Workflow" with actions_ref empty
```

## Notes

- **Re-running is safe.** A branch already on the target ref reports `no-change`, and no line gains a second comment.
- **Fails fast when no release exists.** Falling back to `main` would stamp a moving ref into every consumer, which is what this exists to undo.
- **`determine-matrix`'s `config-ref` is unaffected.** It selects `config/projects.json` and stays on `main` permanently, so pinning code does not freeze project configuration.
