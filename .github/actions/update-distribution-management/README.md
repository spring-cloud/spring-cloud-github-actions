# update-distribution-management

Updates Maven POM files on a branch to replace OSS deployment targets with commercial Broadcom Artifactory repositories and remove Maven Central publishing plugin references.

## What it changes

### `<distributionManagement>` sections

Every `<distributionManagement>` block that contains a `<repository>` or `<snapshotRepository>` element has those elements replaced with:

```xml
<repository>
  <id>spring-commercial-release</id>
  <name>Spring Commercial Release Repository</name>
  <url>https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local</url>
</repository>
<snapshotRepository>
  <id>spring-commercial-snapshot</id>
  <name>Spring Commercial Snapshot Repository</name>
  <url>https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-dev-local</url>
</snapshotRepository>
```

Other children of `<distributionManagement>` (e.g. `<site>`, `<downloadUrl>`) are preserved. Blocks that do not contain deployment repository elements — such as the `<distributionManagement>remove</distributionManagement>` marker used by the Maven Release Plugin — are left untouched.

### `central-publishing-maven-plugin` removal

Every `<plugin>` block that references `central-publishing-maven-plugin` is removed. Any `<plugins>`, `<pluginManagement>`, or `<build>` blocks that become empty as a result are also removed. The corresponding `<properties>` entry (e.g. `central-publishing-maven-plugin.version`) is left in place.

### `gradle.publish-plugins.task` property

If a POM file contains:

```xml
<gradle.publish-plugins.task>publishPlugins</gradle.publish-plugins.task>
```

it is updated to:

```xml
<gradle.publish-plugins.task>build</gradle.publish-plugins.task>
```

This prevents the Gradle Plugin Portal publishing task from running in the commercial build.

### Gradle files

Gradle `publishing.repositories` blocks containing old `repo.spring.io` URLs are handled by the [update-commercial-repositories](../update-commercial-repositories) action, not this one.

### Idempotency

`<distributionManagement>` blocks that already contain `spring-commercial` URLs are skipped.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Repository to update (`org/repo-name`) |
| `branch` | yes | — | Branch to update |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `Updating distribution management for commercial repo` | Commit message |
| `git-user-name` | no | `github-actions[bot]` | Git author name |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git author email |

## Usage

```yaml
- name: Update distribution management
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-distribution-management@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Development

The action logic lives in `src/index.js` and is bundled with [ncc](https://github.com/vercel/ncc) into `dist/index.js`. The bundle must be committed alongside any source changes.

```bash
# Install dependencies
npm install

# Run tests
npm test

# Rebuild the bundle after editing src/index.js or package.json
npm run build
```

## Composing with initialize-commercial-branch

This action runs as part of the `initialize-commercial-branch` workflow. See [initialize-commercial-branch](../../../workflows/initialize-commercial-branch.yml) for the full orchestration.
