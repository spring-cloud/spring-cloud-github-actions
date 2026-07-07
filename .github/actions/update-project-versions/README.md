# update-project-versions

A GitHub Action that updates version properties in a project's `pom.xml`, `gradle.properties`, and `build.gradle` files using versions supplied by the [`extract-bom-versions`](../extract-bom-versions/README.md) action or any other source that produces a compatible JSON map.

## What it does

The action walks the `directory` input (default: repo root) recursively and updates:

| File | What is updated |
|---|---|
| `pom.xml` (root) | `<version>` of the project itself |
| `pom.xml` (all) | `<parent><version>` when the parent belongs to this project or is tracked in `versions` |
| `pom.xml` (root **and** child modules) | `<properties>` entries whose key ends in `.version` when the project name is in `versions` |
| `gradle.properties` | Bare `version=` key → `project-version`; `{prefix}Version=` keys → looked up in `versions` via camelCase→kebab-case conversion |
| `build.gradle` / `build.gradle.kts` | `version = '...'` / `version = "..."` declaration → `project-version` |

The following directories are always skipped: `.git`, `node_modules`, `target`, `build`, `.gradle`.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `release-train-version` | ✴️ | — | Release train version (e.g. `2025.1.0`). When supplied the action fetches the matching `jenkins-releaser-config` properties file from `spring-cloud-release` and derives the versions map and project version automatically. Mutually exclusive with `versions`/`project-version`. |
| `commercial` | ❌ | `false` | When `true`, fetches the releaser config from the private `spring-cloud-release-commercial` repository. Requires a `token` with read access to that repo. Only used when `release-train-version` is set. |
| `token` | ❌ | `github.token` | GitHub token used to fetch the releaser config. The default workflow token is sufficient for the public OSS repo; supply a PAT or repository secret when `commercial=true`. |
| `versions` | ✴️ | — | JSON object mapping project names to versions (e.g. `{"spring-boot":"3.2.3","spring-cloud-config":"4.1.1"}`). Typically produced by the `extract-bom-versions` action. Required when `release-train-version` is not set. |
| `project-version` | ✴️ | — | The new version for this project (e.g. `4.1.2`). Used to update the root `pom.xml` `<version>`, child `<parent><version>` when the parent is the root project, the bare `version=` in `gradle.properties`, and the `version = '...'` line in `build.gradle`. Required when `release-train-version` is not set. |
| `directory` | ❌ | `.` | Root directory of the project to update. Defaults to the repository root. |
| `project-version-substitutions` | ❌ | — | JSON object mapping additional version property name prefixes to project names already in the versions map. Only used with `release-train-version`. See [Version name substitutions](#version-name-substitutions). |

✴️ Either `release-train-version` **or** both `versions` and `project-version` must be supplied.

## Usage

### Recommended — supply only the release train version (OSS)

The action fetches the `jenkins-releaser-config` properties file from `spring-cloud-release`,
derives all dependency versions from it, and auto-detects the project version from the
root `pom.xml` `<artifactId>`.

```yaml
jobs:
  update-versions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update project versions
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-project-versions@main
        with:
          release-train-version: '2025.1.0'
```

### Commercial release train

```yaml
- name: Update project versions
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-project-versions@main
  with:
    release-train-version: '2025.1.0'
    commercial: 'true'
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

### Manual — supply versions JSON and project version explicitly

```yaml
jobs:
  update-versions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Extract BOM versions
        id: bom
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/extract-bom-versions@main
        with:
          ref: '2023.0.x'

      - name: Update project versions
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-project-versions@main
        with:
          versions: ${{ steps.bom.outputs.versions }}
          project-version: '4.1.2'
```

### Standalone — supplying versions directly without a BOM lookup

```yaml
- name: Update project versions
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-project-versions@main
  with:
    versions: '{"spring-boot":"3.3.0","spring-cloud-commons":"4.1.1"}'
    project-version: '4.1.2'
    directory: 'my-subproject'
```

## How `release-train-version` works

When `release-train-version` is set (e.g. `2025.1.0`) the action:

1. Converts the version to a filename: `2025.1.0` → `2025_1_0.properties`
2. Fetches that file from the `jenkins-releaser-config` branch of `spring-cloud-release` (or `spring-cloud-release-commercial` when `commercial=true`)
3. Parses all `releaser.fixed-versions[project-name]=version` entries into a versions map
4. Reads the root `pom.xml` `<artifactId>` to auto-detect the project name
5. Uses the version for that project name as the `project-version`

Example properties file entry:
```
releaser.fixed-versions[spring-cloud-config]=5.0.0
releaser.fixed-versions[spring-boot]=4.0.0
```
Running against the `spring-cloud-config` repository would set `project-version=5.0.0` and include all entries in the versions map for updating `<properties>` across all poms.

## How versions are matched

### Maven (`pom.xml`)

A `<properties>` entry like:

```xml
<spring-cloud-config.version>4.1.0</spring-cloud-config.version>
```

is updated when the key without the `.version` suffix (`spring-cloud-config`) is present in the `versions` map.

This applies to **every** `pom.xml` found under `directory`, not just the root. If a child module declares its own `<properties>` block (for example to pin a dependency version locally), those entries are updated by the same rules.

### Gradle (`gradle.properties`)

Property keys follow the camelCase convention used by Spring Cloud projects:

| Property key | Resolved project name | Looked up in `versions` as |
|---|---|---|
| `version` | *(bare — project's own version)* | always updated to `project-version` |
| `springBootVersion` | `springBoot` → `spring-boot` | `versions["spring-boot"]` |
| `springCloudCommonsVersion` | `springCloudCommons` → `spring-cloud-commons` | `versions["spring-cloud-commons"]` |

Only keys matching the pattern `^[a-zA-Z0-9]+Version$` (a camelCase prefix immediately followed by `Version`) are considered. Keys like `releaseVersion` or `versionCode` are intentionally ignored.

## Version name substitutions

Some projects use version property names that don't follow the standard camelCase-to-kebab-case convention. The `project-version-substitutions` input lets you bridge these non-standard names to the correct project entry in the versions map.

For example, `spring-cloud-contract` uses `verifierVersion` in its `gradle.properties` instead of the expected `springCloudContractVersion`. The camelCase-to-kebab conversion of `verifier` is just `verifier`, which has no entry in the versions map. To fix this, pass:

```yaml
- name: Update project versions
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-project-versions@main
  with:
    release-train-version: '2025.1.0'
    project-version-substitutions: '{"verifier":"spring-cloud-contract"}'
```

This adds a synthetic `verifier` entry to the versions map with the same version as `spring-cloud-contract`, so `verifierVersion` in `gradle.properties` is updated correctly.

The format is `{"<property-prefix>": "<existing-project-name>"}`. The value must be a key already present in the parsed versions map; unknown values are silently ignored. This input is only used when `release-train-version` is set.

## Example — Maven multi-module project

Given a `versions` map of `{"spring-boot":"3.2.3","spring-cloud-commons":"4.1.1"}` and `project-version` of `4.1.2`:

**Root `pom.xml` before:**
```xml
<project>
  <artifactId>my-project</artifactId>
  <version>4.1.0</version>
  <properties>
    <spring-boot.version>3.2.2</spring-boot.version>
    <spring-cloud-commons.version>4.1.0</spring-cloud-commons.version>
  </properties>
</project>
```

**Root `pom.xml` after:**
```xml
<project>
  <artifactId>my-project</artifactId>
  <version>4.1.2</version>
  <properties>
    <spring-boot.version>3.2.3</spring-boot.version>
    <spring-cloud-commons.version>4.1.1</spring-cloud-commons.version>
  </properties>
</project>
```

**Child module `pom.xml` before:**
```xml
<project>
  <parent>
    <artifactId>my-project</artifactId>
    <version>4.1.0</version>
  </parent>
  <artifactId>my-project-server</artifactId>
  <properties>
    <spring-boot.version>3.2.2</spring-boot.version>
    <spring-cloud-commons.version>4.1.0</spring-cloud-commons.version>
  </properties>
</project>
```

**Child module `pom.xml` after:**
```xml
<project>
  <parent>
    <artifactId>my-project</artifactId>
    <version>4.1.2</version>
  </parent>
  <artifactId>my-project-server</artifactId>
  <properties>
    <spring-boot.version>3.2.3</spring-boot.version>
    <spring-cloud-commons.version>4.1.1</spring-cloud-commons.version>
  </properties>
</project>
```

Note that the child module's own `<version>` tag is **not** added or modified — `project-version` only stamps the root pom's `<version>`. The `<parent><version>` and any `<properties>` entries are updated in every pom file regardless of depth.

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
cd .github/actions/update-project-versions
npm install
```

### Run unit tests

```bash
npm test
```

All 51 tests should pass. Tests use fixture files under `__tests__/fixtures/` and temporary directories for filesystem write tests, so no fixtures are ever modified.

### Build the distribution bundle

The action runs from `dist/index.js`, which is a self-contained bundle produced by [`@vercel/ncc`](https://github.com/vercel/ncc). **Always rebuild and commit `dist/index.js` after changing `src/index.js`.**

```bash
npm run build
git add dist/index.js dist/licenses.txt
git commit -m "rebuild dist"
```

### Testing Locally

You can run node script for this action against a project checked out locally on your machine.  Here is an example:

```bash
env \
  'INPUT_RELEASE-TRAIN-VERSION=2025.1.0' \
  INPUT_DIRECTORY=/git-repos/spring-cloud/spring-cloud-contract \
  GITHUB_OUTPUT=/dev/null \
  GITHUB_ENV=/dev/null \
  'INPUT_PROJECT-VERSION-SUBSTITUTIONS={"verifier":"spring-cloud-contract", "boot":"spring-boot"}' \
  node src/index.js
```
