# Deploy Workflow

A reusable GitHub Actions workflow for building and deploying Spring Cloud projects. It uses centralized configuration to determine which branches and JDK versions to build, then runs Maven with the appropriate profiles for each matrix combination.

## Description

The workflow is designed to be called from Spring Cloud project repositories via `workflow_call`. It:

- **Determines the build matrix** using the [determine-matrix](../actions/determine-matrix/README.md) action and [`config/projects.json`](../../config/projects.json), supporting both OSS and commercial repository variants
- **Builds each branch × JDK combination** in parallel with a matrix strategy
- **Deploys artifacts and docs** only for designated JDK versions (e.g., JDK 8 when present, otherwise JDK 17), while other JDK versions run `install` only
- **Supports custom build commands** so callers can override the default Maven behavior

The workflow configures Maven settings for Artifactory (OSS and optional commercial), checks out the correct branch, sets up the JDK, and runs either the default Maven deploy/install or a custom command.

## Requirements

- The calling repository must use Maven with a `mvnw` wrapper
- Required secrets must be configured in the calling repository (or passed from the caller)

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `branches` | Branch(es) to build — single branch or comma-separated list (e.g. `main,3.3.x,3.2.x`). Empty uses ref or scheduled config. | No | string |
| `custom_build_command` | Custom run command for the build step (overrides default Maven command). Supports multi-line. | No | string |
| `runs_on` | Runner to use for the build job. | No | string (default: `ubuntu-latest`) |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `ARTIFACTORY_USERNAME` | Username for OSS Artifactory (repo.spring.io) | Yes |
| `ARTIFACTORY_PASSWORD` | Password for OSS Artifactory | Yes |
| `COMMERCIAL_ARTIFACTORY_USERNAME` | Username for commercial Artifactory | No (required for *-commercial repos) |
| `COMMERCIAL_ARTIFACTORY_PASSWORD` | Password for commercial Artifactory | No (required for *-commercial repos) |
| `DOCKERHUB_USERNAME` | Docker Hub username | Yes |
| `DOCKERHUB_TOKEN` | Docker Hub token | Yes |

## How It Works

1. **Setup job**: Runs the [determine-matrix](../actions/determine-matrix/README.md) action to produce a matrix of `branch`, `java-version`, and `has-jdk8` from [`config/projects.json`](../../config/projects.json).
2. **Build job** (matrix): For each matrix entry:
   - Checkout the branch, set up the JDK, configure Maven and Docker Hub
   - Decide whether this combination should deploy (and use the docs profile) based on `has-jdk8` and `java-version`
   - Run either:
     - **Build**: `./mvnw clean install -Pspring -B -U` when not deploying
     - **Build and deploy**: `./mvnw clean deploy -Pdocs,deploy,spring -B -U` for the designated deploy JDK
     - **Custom build command**: The caller-provided command, if set

Deploy and docs are enabled for one JDK per branch (JDK 8 if the branch has JDK 8, otherwise JDK 17).

## Usage

### Basic usage from a Spring Cloud repo

In your project’s `.github/workflows/deploy.yml`:

```yaml
jobs:
  deploy:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/deploy.yml@main
    with:
      branches: ${{ inputs.branches }}
      runs_on: ${{ inputs.runs_on }}
    secrets:
      ARTIFACTORY_USERNAME: ${{ secrets.ARTIFACTORY_USERNAME }}
      ARTIFACTORY_PASSWORD: ${{ secrets.ARTIFACTORY_PASSWORD }}
      DOCKERHUB_USERNAME: ${{ secrets.DOCKERHUB_USERNAME }}
      DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}
```

For commercial projects, also pass `COMMERCIAL_ARTIFACTORY_USERNAME` and `COMMERCIAL_ARTIFACTORY_PASSWORD`.

### Example caller workflow

A full example with `push`, `schedule`, and `workflow_dispatch` (including optional `branches` and `runs_on`) is in [examples/deploy.yml](../../examples/deploy.yml). Copy and adapt that file into your project’s `.github/workflows/deploy.yml`.

### Custom build command

To override the default Maven command:

```yaml
with:
  branches: ${{ inputs.branches }}
  custom_build_command: |
    ./mvnw clean install -B
    ./mvnw verify -B
```

## Configuration

Branch and JDK version behavior is driven by [config/projects.json](../../config/projects.json) and the [determine-matrix](../actions/determine-matrix/README.md) action. The workflow does not define branches or JDK versions itself; it only consumes the matrix produced by that action.

## See also

- [Determine Build Matrix action](../actions/determine-matrix/README.md) — builds the matrix from `config/projects.json`
- [Example caller workflow](../../examples/deploy.yml) — ready-to-adapt workflow for Spring Cloud projects
