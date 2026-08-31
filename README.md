# Spring Cloud GitHub Actions

Shared GitHub Actions workflows and composite actions for Spring Cloud projects. This repository provides reusable automation for building, testing, and deploying Spring Cloud repositories with consistent branch and JDK version handling.

## Contents

- **[How Spring Cloud releases work](docs/release-automation.md)** — Start here. The end-to-end narrative: OSS and commercial release flows, the branch model, where versions come from, and where this repo's automation stops and the external release train begins.
- **[Workflows](.github/workflows/)** — Reusable workflows callable from other repositories
- **[Actions](.github/actions/)** — Composite actions used by those workflows (and optionally by callers)
- **[Config](config/)** — Centralized configuration (e.g. branches and JDK versions per project)
- **[Examples](examples/)** — Example caller workflows you can copy into your project

## Workflows

| Workflow | Description | Documentation |
|----------|-------------|---------------|
| [deploy.yml](.github/workflows/deploy.yml) | Build and deploy Spring Cloud projects with matrix builds (branch × JDK). Uses centralized config to decide what to build and deploy. | [README](.github/workflows/README-deploy.md) |
| [pr.yml](.github/workflows/pr.yml) | Reusable build workflow called during pull requests. Accepts a custom build command and Artifactory/Dockerhub secrets. | — |
| [deploy-docs.yml](.github/workflows/deploy-docs.yml) | Builds the Antora reference docs and publishes them. Called from the `docs-build` branch of each project; auto-detects OSS vs commercial and picks the runner and publish target accordingly. | [README](.github/workflows/README-deploy-docs.md) |
| [rollout-deploy-docs.yml](.github/workflows/rollout-deploy-docs.yml) | Pushes the shared `deploy-docs` caller to the `docs-build` branch of every project in `projects.json`. Defaults to a dry run, and runs weekly as a drift check that reports anything out of date to Google Chat. | [README](.github/workflows/README-rollout-deploy-docs.md) |
| [rollout-actions-ref.yml](.github/workflows/rollout-actions-ref.yml) | Repoints every consumer reference to this repository at a released commit SHA, annotated with its tag, across every scheduled branch in `projects.json` — `ci-release.yml` on `-internal` branches, `ci.yml`/`pr.yml` everywhere else. Defaults to a dry run. | [README](.github/workflows/README-rollout-actions-ref.md) |
| [rollout-deploy-docs-trigger.yml](.github/workflows/rollout-deploy-docs-trigger.yml) | Pushes the canonical `Deploy Docs` trigger to every source branch in `projects.json` that already has one. Fixes the `contents: read` gap, unifies the token, and allow-lists each branch. Defaults to a dry run. | [README](.github/workflows/README-rollout-deploy-docs-trigger.md) |
| [initialize-commercial-branch.yml](.github/workflows/initialize-commercial-branch.yml) | Full-control workflow that creates a new commercial branch from an OSS branch and runs all commercial setup steps (settings, CI/PR workflows, licenses, repositories, distribution management, Antora playbook, projects.json). | [Example](examples/initialize-commercial-branch.yml) |
| [create-commercial-branch.yml](.github/workflows/create-commercial-branch.yml) | Simplified wrapper over `initialize-commercial-branch` for the common case: copies an OSS branch to `<repo>-commercial` using the same branch name. | — |
| [create-hotfix-branch.yml](.github/workflows/create-hotfix-release-branch.yml) | Creates a commercial hotfix `release/[version]` branch directly from an OSS tag, applies all commercial setup steps, stamps the project version, ensures release-train workflows are present, triggers `release-train-join`, and starts CI. | [README](.github/workflows/README-create-hotfix-branch.md) |
| [retire-branch.yml](.github/workflows/retire-branch.yml) | Retires a branch: removes it from `projects.json`, removes its Dependabot entries, and locks the branch permanently via the repository's `Locked Branches` ruleset. | [README](.github/workflows/README-retire-branch.md) |
| [lock-branches.yml](.github/workflows/lock-unlock-branches.yml) | Locks or unlocks the branches of some or all projects via a `Release Freeze` ruleset per repository — freeze while a release is staged, unfreeze before `post-release` needs to push. Defaults to a dry run. | [README](.github/workflows/README-lock-branches.md) |
| [post-release.yml](.github/workflows/post-release.yml) | Runs the chores that follow a release train: verifies every project was tagged, closes milestones, publishes GitHub releases, seeds the next snapshot properties file, opens the next milestones, merges `release/` branches back into `.x` and bumps them to the new snapshots, nudges Dependabot, opens the website PR documenting the released versions — with the announcement blog post too, on an OSS train — bumps the Spring Cloud version on start.spring.io, and rolls the release train's GitHub Project board over to the next version. Defaults to a dry run. | [README](.github/workflows/README-post-release.md) |
| [setup-next-release-train.yml](.github/workflows/setup-next-release-train.yml) | Rolls `main` forward in every OSS project when a release train branches: cuts the release line branch from `main`, retargets that branch's workflow triggers, adds its Dependabot entries, moves `main` onto the next train's versions, opens the first milestone of the new line, and registers every new branch in `projects.json`. Defaults to a dry run that shows the diffs it would push. | [README](.github/workflows/README-setup-next-release-train.md) |
| [update-versions.yml](.github/workflows/update-versions.yml) | Applies the versions from a release train's `jenkins-releaser-config` properties file to every OSS or commercial project on that train, then commits and pushes. The snapshot bump `post-release` does, on its own, for when versions must move before or independently of a post-release run. Defaults to a dry run. | [README](.github/workflows/README-update-versions.md) |
| [run-github-actions-workflow-generator.yml](.github/workflows/run-github-actions-workflow-generator.yml) | Runs the workflow generator across all tracked projects and branches, copying release-train action files and regenerating workflow files. | [README](.github/workflows/run-github-actions-workflow-generator.README.md) |
| [update-maven-wrapper.yml](.github/workflows/update-maven-wrapper.yml) | Weekly check of the Maven wrapper on every maintained repo/branch, opening a PR where it is behind so CI gates the upgrade. Keeps Dependabot's wrapper updater from failing. Defaults to a dry run. | [README](.github/workflows/README-update-maven-wrapper.md) |
| [dependabot-report.yml](.github/workflows/dependabot-report.yml) | Daily read-only report on Dependabot across every OSS and commercial repo: failing update jobs, and open PRs that are ready, blocked, conflicting, or on retired branches. Posts to Google Chat. | [README](.github/workflows/README-dependabot-report.md) |
| [dependabot-triage.yml](.github/workflows/dependabot-triage.yml) | Acts on open Dependabot PRs: sets the milestone, adds OSS PRs to the release train's GitHub Project, and comments `@dependabot rebase` on conflicts. Defaults to a dry run. | [README](.github/workflows/README-dependabot-triage.md) |
| [check-token-permissions.yml](.github/workflows/check-token-permissions.yml) | Probes a token for every permission the Dependabot automation needs and reports which features it can support. Run after rotating `GH_ACTIONS_REPO_TOKEN`. | [README](.github/workflows/README-check-token-permissions.md) |
| [release.yml](.github/workflows/release-spring-cloud-github-action.yml) | Cuts a release: verifies every bundled action, resolves the next version, tags it, moves the floating major tag, and publishes a GitHub Release. Defaults to a dry run. | [Versioning](#versioning) |
| [verify-dist.yml](.github/workflows/verify-dist.yml) | Rebuilds every JavaScript action and fails if a committed `dist/` bundle does not match its source. Discovers actions automatically. | — |

## Actions

| Action | Description | Documentation |
|--------|-------------|---------------|
| [determine-matrix](.github/actions/determine-matrix/) | Reads [config/projects.json](config/projects.json) and produces a build matrix (branches × JDK versions) for the current repo and event. Supports OSS/commercial, scheduled vs single-branch, and comma-separated branch overrides. | [README](.github/actions/determine-matrix/README.md) |
| [create-commercial-branch](.github/actions/create-commercial-branch/) | Copies the content of an OSS branch into a new orphan branch in a commercial repository, with no OSS git history. Optionally sets the new branch as the repo default. | [README](.github/actions/create-commercial-branch/README.md) |
| [generate-workflows-for-branch](.github/actions/generate-workflows-for-branch/) | Copies release-train action files and runs the workflow generator for a single repository branch. Used by both the generator workflow and `create-hotfix-branch`. | [README](.github/actions/generate-workflows-for-branch/README.md) |
| [create-milestone](.github/actions/create-milestone/) | Creates a milestone in a GitHub repository for a given version if one does not already exist. | [README](.github/actions/create-milestone/README.md) |
| [close-milestone](.github/actions/close-milestone/) | Closes a milestone by title, optionally moving any issues still open in it to another milestone first. Missing or already-closed milestones are skipped, not failed. | [README](.github/actions/close-milestone/README.md) |
| [copy-dependabot-config](.github/actions/copy-dependabot-config/) | Copies `dependabot.yml` / `dependabot.yaml` from one branch to another within the same repository as a separate commit. | [README](.github/actions/copy-dependabot-config/README.md) |
| [copy-settings-xml](.github/actions/copy-settings-xml/) | Replaces `.settings.xml` on a target branch with the version from the source (or default) branch. | [README](.github/actions/copy-settings-xml/README.md) |
| [update-oss-workflows-to-commercial](.github/actions/update-oss-workflows-to-commercial/) | Updates `ci` and `pr` workflow files on a commercial branch: restricts branches, adds `runs_on`, and injects Artifactory secrets. | [README](.github/actions/update-oss-workflows-to-commercial/README.md) |
| [update-license-headers](.github/actions/update-license-headers/) | Replaces Apache License 2.0 headers with the Broadcom license header across all source files, and replaces `LICENSE` / `LICENSE.txt` with the Broadcom license file. | [README](.github/actions/update-license-headers/README.md) |
| [update-commercial-repositories](.github/actions/update-commercial-repositories/) | Replaces `repo.spring.io` OSS repository references with commercial Broadcom Artifactory repositories in all Maven POM and Gradle build files. | [README](.github/actions/update-commercial-repositories/README.md) |
| [update-distribution-management](.github/actions/update-distribution-management/) | Replaces OSS `<distributionManagement>` targets with commercial Broadcom Artifactory repositories and removes Maven Central publishing plugin references. | [README](.github/actions/update-distribution-management/README.md) |
| [update-antora-playbook](.github/actions/update-antora-playbook/) | Registers a new commercial branch in the Antora playbook on the `docs-build` branch, expanding tag patterns as needed. | [README](.github/actions/update-antora-playbook/README.md) |
| [update-projects-json](.github/actions/update-projects-json/) | Updates `config/projects.json` when a new commercial branch is initialized: adds the branch to `scheduled`, copies JDK versions from the OSS entry, and optionally updates the default branch. | [README](.github/actions/update-projects-json/README.md) |
| [retarget-branch-triggers](.github/actions/retarget-branch-triggers/) | Rewrites the branch triggers of every workflow on a branch so they name that branch instead of the one it was cut from. Leaves workflows that never named it untouched. | [README](.github/actions/retarget-branch-triggers/README.md) |
| [add-dependabot-branch-entries](.github/actions/add-dependabot-branch-entries/) | Duplicates a repository's Dependabot entries for a newly created branch, editing the config on the default branch — the only place Dependabot reads it. | [README](.github/actions/add-dependabot-branch-entries/README.md) |
| [add-branches-projects-json](.github/actions/add-branches-projects-json/) | Registers a whole release train's new branches in `config/projects.json` as one commit: adds each to `scheduled` and copies the source branch's JDK versions. | [README](.github/actions/add-branches-projects-json/README.md) |
| [retire-branch-projects-json](.github/actions/retire-branch-projects-json/) | Updates `config/projects.json` when a branch is retired: removes it from `scheduled` and `jdkVersions`. Fails fast if the branch is still set as the default. | [README](.github/actions/retire-branch-projects-json/README.md) |
| [trigger-branch-ci](.github/actions/trigger-branch-ci/) | Dispatches the `ci.yml` or `ci.yaml` workflow for each non-default branch in a Spring Cloud project. | [README](.github/actions/trigger-branch-ci/README.md) |
| [dependabot-scan](.github/actions/dependabot-scan/) | Scans one repository for open Dependabot PRs and the state of its Dependabot update jobs, classifies each PR, and writes the result as JSON. Read-only, so [reporting](.github/workflows/README-dependabot-report.md) and [triage](.github/workflows/README-dependabot-triage.md) share it. | [README](.github/workflows/README-dependabot-report.md) |
| [releaser-map](.github/actions/releaser-map/) | Builds the `{type: {project: {version: train}}}` map that resolves a PR's base branch to its release train, from the `jenkins-releaser-config` branch of `spring-cloud-release` and `spring-cloud-release-commercial`, gap-filling the OSS side from commercial and resolving a version claimed by two trains to the highest of them. Shared by [reporting](.github/workflows/README-dependabot-report.md) and [triage](.github/workflows/README-dependabot-triage.md). | [README](.github/workflows/README-dependabot-report.md#project-resolution) |
| [resolve-actions-ref](.github/actions/resolve-actions-ref/) | Resolves the latest published release of this repository to a commit SHA plus its tag. The single lookup used by everything that writes a ref into another repository. | [README](.github/actions/resolve-actions-ref/README.md) |
| [sync-actions-ref](.github/actions/sync-actions-ref/) | Repoints references to this repository in one branch of one repository at a given SHA, with the tag as a trailing comment. Idempotent. | [README](.github/actions/sync-actions-ref/README.md) |
| [set-commercial-creds-env-vars](.github/actions/set-commercial-creds-env-vars/) | Sets `COMMERCIAL_ARTIFACTORY_USERNAME/PASSWORD` environment variables, falling back to read-only credentials during PR builds. | [README](.github/actions/set-commercial-creds-env-vars/README.md) |
| [sync-deploy-docs-workflow](.github/actions/sync-deploy-docs-workflow/) | Renders the shared `deploy-docs` caller from `examples/deploy-docs.yml` and commits it to a repository's `docs-build` branch. Supports dry runs. | [README](.github/workflows/README-rollout-deploy-docs.md) |
| [sync-deploy-docs-trigger](.github/actions/sync-deploy-docs-trigger/) | Renders the canonical `Deploy Docs` trigger from `examples/deploy-docs-trigger.yml` and commits it to a source branch. Skips branches with no existing trigger. Supports dry runs. | [README](.github/workflows/README-rollout-deploy-docs-trigger.md) |

## Configuration

- **[config/projects.json](config/projects.json)** — Defines, per project, which branches to build (e.g. for scheduled runs) and which JDK versions to use per branch. Includes separate `oss` and `commercial` sections and a `defaults` fallback. The [determine-matrix](.github/actions/determine-matrix/README.md) action reads this file to build the matrix used by the [deploy](.github/workflows/README-deploy.md) workflow.
- **[config/release-train-actions/](config/release-train-actions/README.md)** — Project-specific and branch-specific overrides for the `release-train-build` and `release-train-test` actions deployed to commercial repositories by the workflow generator. Uses a three-level lookup (branch-specific → project-level → global default).

## Quick start

1. In your Spring Cloud project, add a workflow that calls the deploy workflow (see [examples/deploy.yml](examples/deploy.yml)).
2. Configure the required secrets in your repository (`ARTIFACTORY_*`, `DOCKERHUB_*`; add `COMMERCIAL_*` for commercial repos).
3. Trigger via push, schedule, and/or `workflow_dispatch`. The deploy workflow will use this repo's config and actions to decide what to build and deploy.

For full details on inputs, secrets, and behavior, see the [Deploy workflow README](.github/workflows/README-deploy.md) and the [Determine Matrix action README](.github/actions/determine-matrix/README.md).

## Versioning

Releases are git tags — there is nothing published to a registry. Consumers pin the **commit SHA** of a release, with the tag it came from as a trailing comment:

```yaml
uses: spring-cloud/spring-cloud-github-actions/.github/workflows/deploy.yml@d52d95a… # v1.0.0
```

A SHA is immutable: moving or deleting a tag cannot change what a consumer runs. The comment keeps the pin readable, and **Dependabot maintains both** — every consumer repository already runs the `github-actions` ecosystem, which [supports reusable workflows](https://github.blog/changelog/2023-03-13-dependabot-updates-support-reusable-workflows-for-github-actions/) pinned by SHA and [updates the version comment alongside it](https://github.blog/changelog/2022-10-31-dependabot-now-updates-comments-in-github-actions-workflows-referencing-action-versions/). So later releases reach consumers as Dependabot PRs.

Three refs exist per release:

| Ref | Mutable? | Use it for |
|-----|----------|------------|
| `<sha>` | No | What consumers pin. Written by [rollout-actions-ref](.github/workflows/README-rollout-actions-ref.md). |
| `v1.0.0` | No | Human-readable equivalent of that SHA. Also what the tagged commit's own internal refs use. |
| `v1` | Yes — moves to each new `v1.x.y` | Ad-hoc and manual runs. Nothing migrated follows it. |

Usage examples in the per-action READMEs show `@v1` for readability. Real callers are SHA-pinned by the rollout, which rewrites whatever ref it finds — so a hand-written `@v1` is corrected on the next run rather than left as a moving pin.

Because consumers pin a SHA rather than following `v1`, **rolling back means re-running [rollout-actions-ref](.github/workflows/README-rollout-actions-ref.md) at the previous release**, not moving a tag.

`config/projects.json` is **not** versioned with the code. The [determine-matrix](.github/actions/determine-matrix/README.md) action reads it from `main` via its `config-ref` input, so a pinned consumer gets pinned *behavior* with current project *configuration* — retiring a branch or changing a JDK version takes effect immediately for everyone, whatever they pin.

Internal references are pinned by the release itself. The reusable workflows here call sibling actions by absolute ref, because a relative `./` reference resolves against `$GITHUB_WORKSPACE` — the caller's checkout — both [inside a called reusable workflow](https://github.com/orgs/community/discussions/18601) and [inside a composite action](https://github.com/actions/runner/issues/1348). `uses:` also cannot take an expression, so the release workflow rewrites those refs to the exact version on a detached commit and tags that. The tagged commit therefore differs from `main` by exactly those lines, and `main` keeps `@main` so that day-to-day development tests the code being edited rather than the last release.

### Cutting a release

Run the [Release](.github/workflows/release-spring-cloud-github-action.yml) workflow, which picks the next version, tags it, moves the floating major tag, and publishes a GitHub Release with generated notes.

1. Run it with **dry run** checked (the default) to see the version it resolves, the milestones it would close and open, and confirmation that every bundled action is up to date.
2. Re-run with dry run unchecked. The job pauses for approval from the `release` environment's reviewers before any tag is pushed.

Each release also closes the milestone matching the version just cut and opens the next one, applying the same bump. Releasing `v1.1.0` with a minor bump closes milestone `1.1.0` and opens `1.2.0`; anything still open in the closed milestone is moved forward so it is not stranded. Milestone titles are bare version numbers with no `v` prefix, matching the convention used across Spring Cloud, so tag `v1.1.0` pairs with milestone `1.1.0`.

Releasing requires approval in the `release` environment, and a ruleset restricts `v*` tags so they cannot be pushed by hand. The workflow authenticates with `GH_ACTIONS_REPO_TOKEN`, the same token the rest of this repository uses.
