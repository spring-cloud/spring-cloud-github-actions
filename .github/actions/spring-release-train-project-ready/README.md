# Spring Release Train Project Ready Action

A composite GitHub Action that prepares a Spring Cloud project for release train readiness. It checks out the project's release branch, updates all dependency versions from the release train, verifies no pre-release versions remain, commits and pushes the changes, and then triggers the project's `release-train-ready.yml` workflow.

## Description

This action orchestrates the steps required to mark a Spring Cloud project as ready within a release train:

1. **Checkout** the `release/<project-version>` branch of `spring-cloud/<project>`
2. **Update versions** using the `update-project-versions` action, resolving all dependency versions from the jenkins-releaser-config properties file for the given release train
3. **Verify** that no pre-release versions (`-SNAPSHOT`, `-RC*`, `-M*`) remain in any Maven or Gradle build file
4. **Commit and push** the version changes (if any) with the message `"Release <project-version>"`
5. **Trigger** the `release-train-ready.yml` workflow on the project's release branch

If version verification fails (step 3), the action stops immediately — no commit, push, or workflow dispatch occurs.

## Inputs

| Input | Description                                                                                                                                                                                     | Required | Default |
|-------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `project` | The spring-cloud GitHub project name (e.g. `spring-cloud-config`). The action checks out `spring-cloud/<project>` at `release/<project-version>`. Append `-commercial` for commercial variants. | Yes | — |
| `project-version` | The version of the project being released (e.g. `4.2.0`). Identifies the `release/<project-version>` branch.                                                                                    | Yes | — |
| `spring-cloud-release-train-version` | The Spring Cloud release train version matching the jenkins-releaser-config properties file (e.g. `2025.0.0`). Used to resolve dependency versions.                                             | Yes | — |
| `spring-release-train-version` | The Spring release train version to mark this project ready in (e.g. `2026.07`). Passed as the `release-train` input to the project's `release-train-ready.yml` workflow.                       | Yes | — |
| `token` | GitHub token for checkout, push, and workflow dispatch.                                                                                                                                         | Yes | — |

## Usage

### Typical Usage

```yaml
jobs:
  release-train-ready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Mark spring-cloud-config ready in release train
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@main
        with:
          project: spring-cloud-config
          project-version: '4.2.0'
          spring-cloud-release-train-version: '2025.0.0'
          spring-release-train-version: '2026.07'
          token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### Commercial Variant

When the project name ends in `-commercial`, the `commercial` flag is automatically set to `true` when calling `update-project-versions`, so the releaser config is fetched from `spring-cloud-release-commercial` instead of `spring-cloud-release`.

```yaml
- name: Mark spring-cloud-config-commercial ready in release train
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@main
  with:
    project: spring-cloud-config-commercial
    project-version: '4.2.0'
    spring-cloud-release-train-version: '2025.0.0'
    spring-release-train-version: '2026.07'
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### Matrix Strategy Across Multiple Projects

```yaml
jobs:
  release-train-ready:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        project:
          - spring-cloud-config
          - spring-cloud-gateway
          - spring-cloud-commons
    steps:
      - uses: actions/checkout@v4

      - uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@main
        with:
          project: ${{ matrix.project }}
          project-version: '4.2.0'
          spring-cloud-release-train-version: '2025.0.0'
          spring-release-train-version: '2026.07'
          token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## How It Works

### Version Updates

The action passes the following fixed substitutions to `update-project-versions` to handle non-standard version property naming conventions across Spring Cloud projects:

| Property key | Maps to project |
|---|---|
| `spring-cloud-dependencies-parent` | `spring-cloud-build` |
| `verifier` | `spring-cloud-contract` |
| `springBoot` | `spring-boot` |

### Version Verification

After updating, `verify-no-snapshot-versions` scans all `pom.xml`, `gradle.properties`, `build.gradle`, and `build.gradle.kts` files to confirm no pre-release versions remain. If any are found, the action fails with a detailed list of violations and skips the commit, push, and workflow dispatch.

### Commit Author

Changes are committed as:
- **Name:** `spring-builds`
- **Email:** `spring-builds@users.noreply.github.com`

If there are no changes to commit (versions were already at release values), the commit and push steps are skipped, but the `release-train-ready.yml` workflow is still triggered.

### Workflow Dispatch

The action triggers `release-train-ready.yml` via `gh workflow run` with:
- `release-train`: the value of the `spring-release-train-version` input
- `release-train-repository`: `spring-io/release-train` (the default for that workflow)

## Required Token Permissions

The token provided (or the `GH_ACTIONS_REPO_TOKEN` secret) must have:
- **Contents: write** on `spring-cloud/<project>` — to push commits to the release branch
- **Actions: write** on `spring-cloud/<project>` — to dispatch the `release-train-ready.yml` workflow
- **Contents: read** on `spring-cloud/spring-cloud-release` (or `spring-cloud-release-commercial` for commercial projects) — to fetch the jenkins-releaser-config properties file

## License

Apache License 2.0
