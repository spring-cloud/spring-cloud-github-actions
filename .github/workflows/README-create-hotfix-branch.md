# create-hotfix-branch

Creates a commercial hotfix branch from an OSS tag, applies all standard commercial branch initialisation steps, and stamps the project version to a hotfix snapshot.

## What it does

1. **Derives names** — strips the leading `v` from the tag and appends `.x` to form the commercial branch name (e.g. `v5.0.1` → `5.0.1.x`). The commercial repo is always the OSS repo with `-commercial` appended.
2. **Initialises the branch** — delegates to [`initialize-commercial-branch`](initialize-commercial-branch.yml), which runs the full suite of commercial setup actions: copy `.settings.xml`, update CI/PR workflows, update licence headers, replace OSS repositories with commercial Broadcom repositories, and update distribution management.
3. **Stamps the project version** — updates the project version in `pom.xml`, `gradle.properties`, and `build.gradle` files to `<current-version>.1-SNAPSHOT` (e.g. `5.0.1` → `5.0.1.1-SNAPSHOT`). Optionally updates dependency versions at the same time.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `oss_repo` | yes | — | OSS repository to copy from (`org/repo-name`) |
| `oss_tag` | yes | — | Tag in the OSS repository to branch from (e.g. `v5.0.1`) |
| `project_version` | no | `<current>.1-SNAPSHOT` | Override the auto-computed hotfix project version |
| `release_train_version` | no | — | Release train version (e.g. `2025.0.1`). When supplied, all dependency version properties are updated from the Spring Cloud release train. Mutually exclusive with `versions`. |
| `versions` | no | — | JSON map of dependency versions to apply directly (e.g. `{"spring-boot":"3.3.0","spring-cloud-commons":"4.1.1"}`). Mutually exclusive with `release_train_version`. |
| `project_version_substitutions` | no | — | JSON map of non-standard version property prefixes to project names (e.g. `{"verifier":"spring-cloud-contract"}`). Only used with `release_train_version`. |

When called as a reusable workflow (`workflow_call`), a `token` secret can also be supplied; if omitted the `GH_ACTIONS_REPO_TOKEN` organisation secret is used.

## Branch and version naming

| OSS tag | Commercial repo | Commercial branch | Default project version |
|---------|----------------|-------------------|------------------------|
| `v5.0.1` | `org/repo-commercial` | `5.0.1.x` | `5.0.1.1-SNAPSHOT` |
| `v3.3.2` | `org/repo-commercial` | `3.3.2.x` | `3.3.2.1-SNAPSHOT` |
| `v2.0.0` | `org/repo-commercial` | `2.0.0.x` | `2.0.0.1-SNAPSHOT` |

## Version update behaviour

The version update step always runs. Exactly which versions are changed depends on the inputs supplied:

| Inputs | Project version | Dependency versions |
|--------|----------------|---------------------|
| Neither `versions` nor `release_train_version` | `<current>.1-SNAPSHOT` | unchanged |
| `project_version` only | explicit override | unchanged |
| `versions` only | `<current>.1-SNAPSHOT` | from `versions` map |
| `versions` + `project_version` | explicit override | from `versions` map |
| `release_train_version` | `<current>.1-SNAPSHOT` | fetched from Spring Cloud release train |
| `release_train_version` + `project_version` | explicit override | fetched from Spring Cloud release train |

When `release_train_version` is used the action fetches the matching `jenkins-releaser-config` properties file from `spring-cloud-release` and derives the dependency versions from it automatically.

## Usage

### Manual dispatch (simplest — auto-computes everything)

Trigger from the GitHub Actions UI or CLI:

```bash
gh workflow run create-hotfix-branch.yml \
  -f oss_repo=spring-cloud/spring-cloud-foo \
  -f oss_tag=v5.0.1
```

This creates `spring-cloud/spring-cloud-foo-commercial` branch `5.0.1.x` and stamps the project version to `5.0.1.1-SNAPSHOT`.

### With an explicit project version

```bash
gh workflow run create-hotfix-branch.yml \
  -f oss_repo=spring-cloud/spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f project_version=5.0.1.2-SNAPSHOT
```

### With dependency versions from a release train

```bash
gh workflow run create-hotfix-branch.yml \
  -f oss_repo=spring-cloud/spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f release_train_version=2025.0.1
```

### With explicit dependency versions (no release train)

```bash
gh workflow run create-hotfix-branch.yml \
  -f oss_repo=spring-cloud/spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f versions='{"spring-boot":"3.3.5","spring-cloud-commons":"4.1.2"}'
```

### As a reusable workflow

```yaml
jobs:
  hotfix:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/create-hotfix-branch.yml@main
    with:
      oss_repo: spring-cloud/spring-cloud-foo
      oss_tag: v5.0.1
      release_train_version: '2025.0.1'
    secrets:
      token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### spring-cloud-contract (with version substitutions)

`spring-cloud-contract` uses `verifierVersion` in `gradle.properties` rather than the standard `springCloudContractVersion`. Pass `project_version_substitutions` to map it correctly:

```yaml
uses: spring-cloud/spring-cloud-github-actions/.github/workflows/create-hotfix-branch.yml@main
with:
  oss_repo: spring-cloud/spring-cloud-contract
  oss_tag: v4.1.5
  release_train_version: '2024.0.5'
  project_version_substitutions: '{"verifier":"spring-cloud-contract"}'
secrets:
  token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Related workflows

| Workflow | Use when |
|----------|----------|
| [`create-commercial-branch`](create-commercial-branch.yml) | Copying an OSS branch (not a tag) to the commercial repo |
| [`initialize-commercial-branch`](initialize-commercial-branch.yml) | Full control over repo names, branch names, and all options |
