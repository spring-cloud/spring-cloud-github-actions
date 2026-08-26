# Verify No Snapshot Versions Action

A GitHub Action that verifies all Maven and Gradle build files in a Spring Cloud project contain only GA release versions — no `-SNAPSHOT`, `-RC<N>`, or `-M<N>` versions anywhere in the build.

## Description

This action recursively scans a project directory for `pom.xml`, `gradle.properties`, `build.gradle(.kts)`, and `settings.gradle(.kts)` files and checks that no version strings contain pre-release suffixes. It is intended to be run as a gate before cutting a release to confirm no unintended pre-release dependencies have been left in the build.

The check is exhaustive rather than location-by-location: **every** version in the file is inspected, wherever it is declared. That matters because a pre-release version pinned somewhere unusual is exactly the kind that survives a release — for example [a `-SNAPSHOT` pinned on a plugin's own `<dependencies>` block in spring-cloud-function](https://github.com/spring-cloud/spring-cloud-function/commit/7d76185e3faa9e05c206278f85132b5c6cf91d94), which no targeted check visits.

**pom.xml**

The whole parsed document is walked, so a violation is reported for:

- Every `<version>` element, at any depth — the project version, `<parent>`, `<dependencies>`, `<dependencyManagement>`, `<build><plugins>`, `<build><pluginManagement>`, a plugin's own `<dependencies>`, `<build><extensions>`, `<reporting>`, and anything nested inside a `<profile>`.
- Every entry of every `<properties>` block, including `<profile><properties>`.

**gradle.properties**

- Every key/value pair.

**build.gradle / build.gradle.kts / settings.gradle / settings.gradle.kts**

- Every string literal, so inline dependency coordinates (`'org.example:my-lib:1.0.0-SNAPSHOT'`) and plugin versions (`id 'x' version '2.0.0-SNAPSHOT'`) are covered alongside the project `version = '...'` declaration. Line (`//`) and block (`/* */`) comments are ignored.

### Which values get checked

A key that names a version outright — `version`, `spring-boot.version`, `spring-cloud-commons-version`, `springBootVersion` — always has its value checked.

Any other key has its value checked only when the value is *shaped* like a version (starts with a digit, no whitespace or `/`). This is what keeps `<repo.url>https://repo.spring.io/libs-snapshot</repo.url>` and `maven { url 'https://repo.spring.io/libs-snapshot' }` from being misread as pre-release versions, while still catching a version held under an unconventional key.

`<version>` elements in a pom are always checked regardless of value shape.

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
| `^.*spring-cloud-contract-gradle-plugin/src/test/.*$` | Gradle plugin test projects |
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
    ^.*spring-cloud-contract-gradle-plugin/src/test/.*$
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
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@v1
```

### With a Non-Default Directory

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Verify no pre-release versions
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@v1
    with:
      directory: 'my-subproject'
```

### Inspecting Violations in a Subsequent Step

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Verify no pre-release versions
    id: verify
    uses: spring-cloud/spring-cloud-github-actions/.github/actions/verify-no-snapshot-versions@v1
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

The annotation also works on any inline `<version>` tag, wherever it appears:

```xml
<dependency>
  <groupId>org.example</groupId>
  <artifactId>some-lib</artifactId>
  <version>2.0.0-M1</version> <!-- @releaser:version-check-off -->
</dependency>
```

Only the annotated entry is suppressed — all other versions in the same file are still checked.

## Suppressing Individual Version Checks in Gradle Files

The same annotation works in `gradle.properties` and `build.gradle(.kts)`; put it in a comment on the same line:

```properties
failsafeVersion=3.0.0-M3 # @releaser:version-check-off
```

```groovy
testImplementation 'org.example:only-milestones:1.0.0-M1' // @releaser:version-check-off
```

## What Is Ignored

- Directories named `target`, `build`, `.gradle`, `node_modules`, and `.git` are skipped entirely.
- Any file whose path matches one of the `exclude-patterns` regexes is skipped (see default patterns above).
- Lines carrying a `@releaser:version-check-off` annotation.
- Values that are not shaped like a version, when held under a key that does not name a version (see [Which values get checked](#which-values-get-checked)) — e.g. `<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>` or a snapshot repository URL.
- Comments in `build.gradle` / `build.gradle.kts`.

## Example Action Log Output

When violations are found the action prints each one and then fails:

```
Error: Found 4 pre-release version(s):
  pom.xml: <version> = 4.2.0-SNAPSHOT
  pom.xml: <properties><spring-boot.version> = 3.3.0-SNAPSHOT
  samples/gcp/pom.xml: <build><plugins><plugin>[org.springframework.boot:spring-boot-maven-plugin]<dependencies><dependency>[org.springframework.cloud:spring-cloud-function-adapter-gcp]<version> = 3.1.0-SNAPSHOT
  gradle.properties: springCloudBusVersion = 4.2.0-SNAPSHOT
Error: 4 pre-release version(s) found. All dependencies must use release versions.
```

The `location` is the full element path to the offending version, with Maven coordinates for `<dependency>`, `<plugin>` and `<extension>` entries and the id for `<profile>`, so a violation can be traced to a specific entry in a large pom.

When the project is clean:

```
All versions are release versions. No pre-release versions found.
```

## License

Apache License 2.0
