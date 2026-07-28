# Spring Cloud GitHub Actions

Shared GitHub Actions workflows and composite actions for Spring Cloud projects. This repository provides reusable automation for building, testing, and deploying Spring Cloud repositories with consistent branch and JDK version handling.

## Contents

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
| [initialize-commercial-branch.yml](.github/workflows/initialize-commercial-branch.yml) | Full-control workflow that creates a new commercial branch from an OSS branch and runs all commercial setup steps (settings, CI/PR workflows, licenses, repositories, distribution management, Antora playbook, projects.json). | [Example](examples/initialize-commercial-branch.yml) |
| [create-commercial-branch.yml](.github/workflows/create-commercial-branch.yml) | Simplified wrapper over `initialize-commercial-branch` for the common case: copies an OSS branch to `<repo>-commercial` using the same branch name. | — |
| [create-hotfix-branch.yml](.github/workflows/create-hotfix-release-branch.yml) | Creates a commercial hotfix `release/[version]` branch directly from an OSS tag, applies all commercial setup steps, stamps the project version, ensures release-train workflows are present, triggers `release-train-join`, and starts CI. | [README](.github/workflows/README-create-hotfix-branch.md) |
| [retire-branch.yml](.github/workflows/retire-branch.yml) | Retires a branch: removes it from `projects.json`, removes its Dependabot entries, and locks the branch via the GitHub API. | [README](.github/workflows/README-retire-branch.md) |
| [run-github-actions-workflow-generator.yml](.github/workflows/run-github-actions-workflow-generator.yml) | Runs the workflow generator across all tracked projects and branches, copying release-train action files and regenerating workflow files. | [README](.github/workflows/run-github-actions-workflow-generator.README.md) |

## Actions

| Action | Description | Documentation |
|--------|-------------|---------------|
| [determine-matrix](.github/actions/determine-matrix/) | Reads [config/projects.json](config/projects.json) and produces a build matrix (branches × JDK versions) for the current repo and event. Supports OSS/commercial, scheduled vs single-branch, and comma-separated branch overrides. | [README](.github/actions/determine-matrix/README.md) |
| [create-commercial-branch](.github/actions/create-commercial-branch/) | Copies the content of an OSS branch into a new orphan branch in a commercial repository, with no OSS git history. Optionally sets the new branch as the repo default. | [README](.github/actions/create-commercial-branch/README.md) |
| [generate-workflows-for-branch](.github/actions/generate-workflows-for-branch/) | Copies release-train action files and runs the workflow generator for a single repository branch. Used by both the generator workflow and `create-hotfix-branch`. | [README](.github/actions/generate-workflows-for-branch/README.md) |
| [create-milestone](.github/actions/create-milestone/) | Creates a milestone in a GitHub repository for a given version if one does not already exist. | [README](.github/actions/create-milestone/README.md) |
| [copy-dependabot-config](.github/actions/copy-dependabot-config/) | Copies `dependabot.yml` / `dependabot.yaml` from one branch to another within the same repository as a separate commit. | [README](.github/actions/copy-dependabot-config/README.md) |
| [copy-settings-xml](.github/actions/copy-settings-xml/) | Replaces `.settings.xml` on a target branch with the version from the source (or default) branch. | [README](.github/actions/copy-settings-xml/README.md) |
| [update-oss-workflows-to-commercial](.github/actions/update-oss-workflows-to-commercial/) | Updates `ci` and `pr` workflow files on a commercial branch: restricts branches, adds `runs_on`, and injects Artifactory secrets. | [README](.github/actions/update-oss-workflows-to-commercial/README.md) |
| [update-license-headers](.github/actions/update-license-headers/) | Replaces Apache License 2.0 headers with the Broadcom license header across all source files, and replaces `LICENSE` / `LICENSE.txt` with the Broadcom license file. | [README](.github/actions/update-license-headers/README.md) |
| [update-commercial-repositories](.github/actions/update-commercial-repositories/) | Replaces `repo.spring.io` OSS repository references with commercial Broadcom Artifactory repositories in all Maven POM and Gradle build files. | [README](.github/actions/update-commercial-repositories/README.md) |
| [update-distribution-management](.github/actions/update-distribution-management/) | Replaces OSS `<distributionManagement>` targets with commercial Broadcom Artifactory repositories and removes Maven Central publishing plugin references. | [README](.github/actions/update-distribution-management/README.md) |
| [update-antora-playbook](.github/actions/update-antora-playbook/) | Registers a new commercial branch in the Antora playbook on the `docs-build` branch, expanding tag patterns as needed. | [README](.github/actions/update-antora-playbook/README.md) |
| [update-projects-json](.github/actions/update-projects-json/) | Updates `config/projects.json` when a new commercial branch is initialized: adds the branch to `scheduled`, copies JDK versions from the OSS entry, and optionally updates the default branch. | [README](.github/actions/update-projects-json/README.md) |
| [retire-branch-projects-json](.github/actions/retire-branch-projects-json/) | Updates `config/projects.json` when a branch is retired: removes it from `scheduled` and `jdkVersions`. Fails fast if the branch is still set as the default. | [README](.github/actions/retire-branch-projects-json/README.md) |
| [trigger-branch-ci](.github/actions/trigger-branch-ci/) | Dispatches the `ci.yml` or `ci.yaml` workflow for each non-default branch in a Spring Cloud project. | [README](.github/actions/trigger-branch-ci/README.md) |
| [set-commercial-creds-env-vars](.github/actions/set-commercial-creds-env-vars/) | Sets `COMMERCIAL_ARTIFACTORY_USERNAME/PASSWORD` environment variables, falling back to read-only credentials during PR builds. | [README](.github/actions/set-commercial-creds-env-vars/README.md) |

## Configuration

- **[config/projects.json](config/projects.json)** — Defines, per project, which branches to build (e.g. for scheduled runs) and which JDK versions to use per branch. Includes separate `oss` and `commercial` sections and a `defaults` fallback. The [determine-matrix](.github/actions/determine-matrix/README.md) action reads this file to build the matrix used by the [deploy](.github/workflows/README-deploy.md) workflow.
- **[config/release-train-actions/](config/release-train-actions/README.md)** — Project-specific and branch-specific overrides for the `release-train-build` and `release-train-test` actions deployed to commercial repositories by the workflow generator. Uses a three-level lookup (branch-specific → project-level → global default).

## Quick start

1. In your Spring Cloud project, add a workflow that calls the deploy workflow (see [examples/deploy.yml](examples/deploy.yml)).
2. Configure the required secrets in your repository (`ARTIFACTORY_*`, `DOCKERHUB_*`; add `COMMERCIAL_*` for commercial repos).
3. Trigger via push, schedule, and/or `workflow_dispatch`. The deploy workflow will use this repo's config and actions to decide what to build and deploy.

For full details on inputs, secrets, and behavior, see the [Deploy workflow README](.github/workflows/README-deploy.md) and the [Determine Matrix action README](.github/actions/determine-matrix/README.md).
