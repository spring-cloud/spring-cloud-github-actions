# Spring Cloud GitHub Actions

Shared GitHub Actions workflows and composite actions for Spring Cloud projects. This repository provides reusable automation for building, testing, and deploying Spring Cloud repositories with consistent branch and JDK version handling.

## Contents

- **[Workflows](.github/workflows/)** — Reusable workflows callable from other repositories
- **[Actions](.github/actions/)** — Composite actions used by those workflows (and optionally by callers)
- **[Config](config/)** — Centralized configuration (e.g. branches and JDK versions per project)
- **[Examples](examples/)** — Example caller workflows you can copy into your project

## Workflows

| Workflow | Description | Documentation |
|----------|-------------|----------------|
| [deploy.yml](.github/workflows/deploy.yml) | Build and deploy Spring Cloud projects with matrix builds (branch × JDK). Uses centralized config to decide what to build and deploy. | [Deploy workflow README](.github/workflows/README-deploy.md) |

## Actions

| Action | Description | Documentation |
|--------|-------------|---------------|
| [determine-matrix](.github/actions/determine-matrix/) | Reads [config/projects.json](config/projects.json) and produces a build matrix (branches × JDK versions) for the current repo and event. Supports OSS/commercial, scheduled vs single-branch, and comma-separated branch overrides. | [Determine Matrix README](.github/actions/determine-matrix/README.md) |

## Configuration

- **[config/projects.json](config/projects.json)** — Defines, per project, which branches to build (e.g. for scheduled runs) and which JDK versions to use per branch. Includes separate `oss` and `commercial` sections and a `defaults` fallback. The [determine-matrix](.github/actions/determine-matrix/README.md) action reads this file to build the matrix used by the [deploy](.github/workflows/README-deploy.md) workflow.

## Quick start

1. In your Spring Cloud project, add a workflow that calls the deploy workflow (see [examples/deploy.yml](examples/deploy.yml)).
2. Configure the required secrets in your repository (`ARTIFACTORY_*`, `DOCKERHUB_*`; add `COMMERCIAL_*` for commercial repos).
3. Trigger via push, schedule, or `workflow_dispatch`. The deploy workflow will use this repo’s config and actions to decide what to build and deploy.

For full details on inputs, secrets, and behavior, see the [Deploy workflow README](.github/workflows/README-deploy.md) and the [Determine Matrix action README](.github/actions/determine-matrix/README.md).
