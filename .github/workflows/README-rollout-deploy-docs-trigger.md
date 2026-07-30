# Rollout Deploy Docs Trigger

A dispatchable workflow that pushes the canonical **Deploy Docs trigger** to every source branch listed in [`config/projects.json`](../../config/projects.json) that already has one.

## Description

Each Spring Cloud project carries a small `.github/workflows/deploy-docs.yml` on its *source* branches (`main`, `4.3.x`, `release/5.0.4`, …) whose only job is to dispatch the real docs build on the `docs-build` branch. That file was copy-pasted per branch and had drifted badly. An audit of all 68 scheduled branches found:

- **49 of 51** existing triggers missing `permissions: contents: read` — which makes the checkout fail on every private commercial repo with a misleading `Repository not found`
- **34 commercial branches** using `secrets.GITHUB_TOKEN`, inherited from OSS, versus exactly **one** using `GH_ACTIONS_REPO_TOKEN`
- an unfiltered `on.push` firing on every branch including Dependabot ones
- one branch (`spring-cloud-task@main`) pinning `actions/checkout@v3d3c42e5aac…` — a `v` prefix glued onto a SHA, which cannot resolve

This workflow replaces all of them with one canonical file.

## What the canonical trigger does differently

**Allow-lists exactly its own branch.** The template's `__BRANCH__` placeholder is replaced with the branch being written to:

```yaml
on:
  push:
    branches:
      - 4.3.x
    tags: '**'
```

A topic or Dependabot branch cut from `4.3.x` carries this file too. With the old `branches-ignore` form, every push to one of those dispatched a full docs build for a ref that isn't in the Antora playbook. The allow-list makes that impossible rather than something to enumerate. (`branches` and `branches-ignore` are mutually exclusive for the same event, so this replaces the ignore list entirely.)

**Declares `contents: read` and `actions: write`.** A `permissions:` block sets every unlisted scope to none, so omitting `contents: read` leaves `GITHUB_TOKEN` unable to clone a private repo.

**Uses `secrets.GITHUB_TOKEN` everywhere.** With the permissions above it works in both OSS and commercial repos, so `GH_ACTIONS_REPO_TOKEN` is no longer needed here. The one case it cannot cover is Dependabot — GitHub forces a read-only token for those runs regardless of the `permissions:` block — which the branch allow-list already excludes.

**Pins `actions/checkout` by SHA:** `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1). 21 branches already pinned this exact SHA.

## Branches without a trigger are skipped, never created

17 branches (all commercial — mostly `3.1.x`, plus `3.2.x`, `2.1.x`, `2.4.x`, `2021.0.x`) have no trigger workflow. Those branches are deliberately not built, so the sync action skips them and reports `skipped-no-trigger`; it never creates the file. They are listed in the run summary so the set stays visible.

## Safety

- **`dry_run` defaults to `true`.** The default run renders the file, prints a full diff per branch, and pushes nothing.
- **The commit message carries `[skip actions]`.** The trigger fires on push to its own branch, so without it the rollout would dispatch a docs build from every branch it touched.
- **`max-parallel: 8`**, and **`fail-fast: false`** so one bad branch does not abandon the rest.
- Rendering fails loudly if `__BRANCH__` survives substitution, rather than shipping a workflow that silently never fires.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `projects` | Comma-separated project names. Empty processes every project. | No | string |
| `repo_type` | Which flavors to update: `both`, `oss`, or `commercial` | No | choice (default: `both`) |
| `dry_run` | Render and diff without committing or pushing | No | boolean (default: `true`) |
| `token` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## The template is the source of truth

The deployed file is rendered from [`examples/deploy-docs-trigger.yml`](../../examples/deploy-docs-trigger.yml): the template-only header comment is dropped, a generated-by banner is prepended, and `__BRANCH__` is replaced. To change what every branch gets, edit the template and re-run the rollout.

## Suggested sequence

1. **Dry run, one project**: `projects: spring-cloud-function`, `dry_run: true`. Check the diffs.
2. **Dry run, everything**: `dry_run: true`. Check the summary and the skip list.
3. **Real run, one project**: `dry_run: false`, then push a commit to that branch and confirm a docs build is dispatched.
4. **Real run, everything**: `dry_run: false`.

## Relationship to the docs build rollout

This is the companion to [rollout-deploy-docs](README-rollout-deploy-docs.md), which syncs the caller on the `docs-build` branch. Note that both files live at the same path, `.github/workflows/deploy-docs.yml`, and **GitHub keys a workflow by path** — so the trigger and the docs build are a single workflow entity sharing one enable/disable state. Enabling is handled by the docs build rollout; this one does not touch workflow state.
