# Rollout Deploy Docs Workflow

A dispatchable workflow that pushes the shared `deploy-docs` caller to the `docs-build` branch of every Spring Cloud project, so each project delegates its docs build to [`deploy-docs.yml`](README-deploy-docs.md) instead of carrying its own copy.

## Description

Before this rollout, every `docs-build` branch carried a hand-maintained ~55-line job. The OSS copies had drifted across five different `spring-io/spring-doc-actions` versions, and every commercial repository except `spring-cloud-build-commercial` carried the **byte-identical OSS file** — publishing to the public docs host with an OSS context root rather than to the commercial GCS bucket. This workflow replaces all of them with the same short caller.

It:

1. **Builds a matrix** from [`config/projects.json`](../../config/projects.json), expanding each project into its OSS repo (`spring-cloud/<project>`) and/or commercial repo (`spring-cloud/<project>-commercial`)
2. **Filters to repositories that actually have a `docs-build` branch**, logging every repository it drops rather than silently shrinking the matrix
3. **Renders and syncs** the caller to each one via the [sync-deploy-docs-workflow](../actions/sync-deploy-docs-workflow/action.yml) action
4. **Writes a summary table** to the job summary and fails if any repository failed

## Enabling disabled workflows

A correct workflow file in a disabled workflow still never builds. At the time this was written **30 of the 32 repositories had `Deploy Docs` in state `disabled_manually`** — every project except `spring-cloud-build` and `spring-cloud-build-commercial`. So the rollout enables the workflow by default (`enable_workflow`, default `true`).

The enable step runs **even when the file was already up to date**, since those are independent conditions, and it re-reads the state afterwards to confirm the change took effect rather than trusting the API call.

> **This has a wider blast radius than the docs build alone.** GitHub identifies a workflow by its *path*, not by branch. `.github/workflows/deploy-docs.yml` exists both on `docs-build` (the docs build) and on every source branch (the trigger that dispatches it) — and they are a single workflow entity sharing one enable/disable state. Enabling it therefore also re-enables the trigger.
>
> Set `enable_workflow: false` to sync the files and leave workflow state alone.

## Safety

- **`dry_run` defaults to `true`.** The default run renders the file, prints a full diff per repository, and pushes nothing. Set it to `false` only once the diffs look right.
- **The default commit message contains `[skip actions]`.** This matters: the caller triggers on `push` to `docs-build`, so without a skip token a full rollout would kick off a docs build in every repository at once. The action warns if you override the message and drop the token.
- **`max-parallel: 8`** keeps the fan-out from saturating the runner pool.
- **`fail-fast: false`** so one bad repository does not abandon the rest.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `projects` | Comma-separated project names (e.g. `spring-cloud-build,spring-cloud-config`). Empty processes every project. | No | string |
| `repo_type` | Which flavors to update: `both`, `oss`, or `commercial` | No | choice (default: `both`) |
| `dry_run` | Render and diff without committing, pushing, or enabling | No | boolean (default: `true`) |
| `enable_workflow` | Enable the `Deploy Docs` workflow where it is disabled. See the section above — this also re-enables the same-named trigger workflow on the source branches. | No | boolean (default: `true`) |
| `actions_ref` | Ref of `spring-cloud-github-actions` the generated caller points at. Useful for staging a change on a branch first. | No | string (default: `main`) |
| `branch` | Branch holding the docs build | No | string (default: `docs-build`) |
| `commit_message` | Commit message. Keep `[skip actions]` unless you want each push to trigger a docs build. | No | string |
| `token` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## The template is the source of truth

The deployed file is rendered from [`examples/deploy-docs.yml`](../../examples/deploy-docs.yml) — the same file the docs point people at — so the example and what actually ships cannot drift. Rendering:

1. Drops the example-only header comment (everything before the first `name:` line)
2. Prepends a generated-by banner warning against editing the file directly
3. Points the `uses:` line at `actions_ref`
4. Points the `push:` trigger at `branch`

To change what every project gets, edit `examples/deploy-docs.yml` and re-run the rollout.

## Suggested sequence

1. **Dry run, one project**: `projects: spring-cloud-config`, `dry_run: true`. Check the diff.
2. **Dry run, everything**: `dry_run: true`. Check the summary table and the skip list.
3. **Real run, one project**: `projects: spring-cloud-config`, `dry_run: false`. Dispatch that project's docs build by hand and confirm it publishes to the right place.
4. **Real run, everything**: `dry_run: false`.

Because the commit message carries `[skip actions]`, step 4 does not rebuild any docs. Each project picks up the shared workflow on its next real docs build.

## Repositories covered

Every project in `projects.json` with an `oss` and/or `commercial` section that has a `docs-build` branch. Projects without one — currently `spring-cloud-cloudfoundry-commercial` and `spring-cloud-sleuth-commercial`, both legacy `3.1.x`-only — are listed in the setup log and skipped.
