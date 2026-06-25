# Verify No Snapshot Versions Action

A GitHub Action that verifies all Maven and Gradle build files in a Spring Cloud project contain only GA release versions — no `-SNAPSHOT`, `-RC<N>`, or `-M<N>` versions in any dependency or version property.

## Description

This action recursively scans a project directory for `pom.xml`, `gradle.properties`, `build.gradle`, and `build.gradle.kts` files and checks that no version strings contain pre-release suffixes. It is intended to be run as a gate before cutting a release to confirm no unintended pre-release dependencies have been left in the build.

The following version locations are checked:

**pom.xml**
- The project's own `<version>`
- `<parent><version>`
- All `<properties>` entries whose key ends in `.version` (e.g. `<spring-boot.version>`)
- Inline `<version>` in `<dependencies>` and `<dependencyManagement>`
- Inline `<version>` in `<build><plugins>` and `<build><pluginManagement>`

**gradle.properties**
- The bare `version` key (project version)
- Any key ending in `Version` (e.g. `springBootVersion`, `springCloudCommonsVersion`)

**build.gradle / build.gradle.kts**
- The `version = '...'` or `version = "..."` project version declaration

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `directory` | Root directory of the project to verify | No | `.` |
| `exclude-patterns` | Newline-separated list of regular expressions. Any file whose absolute path matches one of these patterns is excluded from version checking. | No | See below |

### Default Exclude Patterns

The following patterns are excluded by default:

| Pattern | Purpose |
|---------|---------|
| `^.*\.git/.*$` | Git internals |
| `^.*spring-cloud-contract-maven-plugin/src/test/projects/.*$` | Maven plugin integration test projects |
| `^.*spring-cloud-contract-maven-plugin/target/.*$` | Maven plugin build output |
| `^.*src/test/bats/.*$` | BATS shell test scripts |
| `^.*samples/standalone/[a-z]+/.*$` | Standalone sample projects |

To replace the defaults entirely, supply your own list:

```yaml
with:
  exclude-patterns: |
    ^.*my-custom-exclude/.*$
```

To add patterns on top of the defaults, repeat the defaults and append your own:

```yaml
with:
  exclude-patterns: |
    ^.*\.git/.*$
    ^.*spring-cloud-contract-maven-plugin/src/test/projects/.*$
    ^.*spring-cloud-contract-maven-plugin/target/.*$
    ^.*src/test/bats/.*$
    ^.*samples/standalone/[a-z]+/.*$
    ^.*my-extra-exclude/.*$
```

## Outputs

| Output | Description |
|--------|-------------|
| `violations` | JSON array of violation objects. Each entry has `file`, `location`, and `version` fields. Empty array when all versions are GA releases. |

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Verify no pre-release versions
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@main
```

### With a Non-Default Directory

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Verify no pre-release versions
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@main
    with:
      directory: 'my-subproject'
```

### Inspecting Violations in a Subsequent Step

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Verify no pre-release versions
    id: verify
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@main
    continue-on-error: true

  - name: Print violations
    if: steps.verify.outcome == 'failure'
    run: echo '${{ steps.verify.outputs.violations }}' | jq .
```

## What Gets Flagged

Any version value matching one of these patterns (case-insensitive) is a violation:

| Pattern | Example |
|---------|---------|
| `-SNAPSHOT` | `4.2.0-SNAPSHOT` |
| `-RC<N>` | `3.3.0-RC1`, `3.3.0-RC2` |
| `-M<N>` | `2023.0.0-M1`, `4.2.0-M12` |

## Suppressing Individual Version Checks in pom.xml

If a specific version in a `pom.xml` intentionally uses a pre-release value (for example, a Maven plugin that only ships milestone releases), you can suppress the check for that single entry by adding `<!-- @releaser:version-check-off -->` on the same line:

```xml
<properties>
  <!-- 3.0.0-M3 is the latest stable release of this plugin -->
  <maven-failsafe-plugin.version>3.0.0-M3</maven-failsafe-plugin.version> <!-- @releaser:version-check-off -->
</properties>
```

The annotation also works on inline `<version>` tags inside `<dependencies>`, `<dependencyManagement>`, `<build><plugins>`, and `<build><pluginManagement>`:

```xml
<dependency>
  <groupId>org.example</groupId>
  <artifactId>some-lib</artifactId>
  <version>2.0.0-M1</version> <!-- @releaser:version-check-off -->
</dependency>
```

Only the annotated entry is suppressed — all other versions in the same file are still checked.

## What Is Ignored

- Directories named `target`, `build`, `.gradle`, `node_modules`, and `.git` are skipped entirely.
- Any file whose path matches one of the `exclude-patterns` regexes is skipped (see default patterns above).
- Individual `pom.xml` version entries annotated with `<!-- @releaser:version-check-off -->` on the same line are skipped.
- `pom.xml` properties whose key does not end in `.version` (e.g. `<java.version>17</java.version>`, `<project.build.sourceEncoding>`) are not checked, as they do not hold dependency versions.
- `gradle.properties` keys that do not equal `version` and do not end in `Version` are not checked.

## Example Action Log Output

When violations are found the action prints each one and then fails:

```
Error: Found 3 pre-release version(s):
  pom.xml: <version> = 4.2.0-SNAPSHOT
  pom.xml: <properties><spring-boot.version> = 3.3.0-SNAPSHOT
  gradle.properties: springCloudBusVersion = 4.2.0-SNAPSHOT
Error: 3 pre-release version(s) found. All dependencies must use release versions.
```

When the project is clean:

```
All versions are release versions. No pre-release versions found.
```

## License

Apache License 2.0
