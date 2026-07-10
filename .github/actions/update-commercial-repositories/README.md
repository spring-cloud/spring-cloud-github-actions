# update-commercial-repositories

Replaces Spring OSS `repo.spring.io` repository references with the commercial Broadcom Artifactory repositories in all Maven POM files and Gradle build files on a branch, committing the changes in a single commit.

## What it changes

Any `<repositories>` or `<pluginRepositories>` block in a POM file, and any `repositories { }` block in a Gradle file, that contains old (non-commercial) `repo.spring.io` URLs is replaced with the following four repositories:

| ID | URL |
|----|-----|
| `spring-commercial-snapshot` | `https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-dev-local` |
| `spring-commercial-release` | `https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local` |
| `repo-spring-io-spring-commercial-snapshot` | `https://repo.spring.io/artifactory/spring-commercial-snapshot-remote` |
| `repo-spring-io-spring-commercial-release` | `https://repo.spring.io/artifactory/spring-commercial-release-remote` |

### POM files (`.xml`, `.pom`)

Each `<repositories>` and `<pluginRepositories>` block containing old `repo.spring.io` URLs is replaced in its entirety with the four commercial entries above, preserving the surrounding indentation. Blocks that do not reference old `repo.spring.io` URLs are left untouched.

### Gradle files (`.gradle`, `.gradle.kts`)

Within each `repositories { }` block, individual `maven { url '...' }` entries referencing old `repo.spring.io` URLs are removed and replaced with the four commercial entries. Other entries (e.g. `mavenCentral()`, `gradlePluginPortal()`) are preserved.

The action is idempotent — blocks already containing the commercial URLs are skipped.

## Project-specific overrides

For projects that need customised repository handling (e.g. preserving certain existing repositories, using credentials blocks in Gradle), add an override function to the `PROJECT_OVERRIDES` registry in `src/index.js`.

The action derives the project name from the `repository` input by stripping the GitHub organisation and an optional `-commercial` suffix, then looks up a matching entry in `PROJECT_OVERRIDES`. If one is found it **runs first**, handling the files that need special treatment. The default handler then runs for all remaining files — it automatically skips any file the override already updated (idempotent URL check).

### spring-cloud-contract

The built-in `spring-cloud-contract` override handles two special cases:

- **POM `<repositories>` blocks** — adds the four commercial repos and preserves the `spring-milestones` entry alongside them.
- **Gradle `repositories {}` blocks** — replaces old entries with named maven blocks that include a `credentials {}` block:

```groovy
maven {
    name "spring-commercial-release"
    url "https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local"
    credentials {
        username System.env.ARTIFACTORY_USERNAME
        password System.env.ARTIFACTORY_PASSWORD
    }
}
```

### Adding a new project override

Add a new entry to the `PROJECT_OVERRIDES` object in `src/index.js`:

```js
const PROJECT_OVERRIDES = {
  'spring-cloud-contract': springCloudContractUpdate,
  'spring-cloud-foo':      springCloudFooUpdate,   // ← new
};

function springCloudFooUpdate(root) {
  // Walk root, apply transformations, return a Set of updated file paths
  const updated = new Set();
  // ...
  return updated;
}
```

After editing `src/index.js`, rebuild the bundle with `npm run build` and commit `dist/index.js`.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Repository to update (`org/repo-name`) |
| `branch` | yes | — | Branch to update |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `Updating repositories to commercial Broadcom repositories` | Commit message |
| `git-user-name` | no | `github-actions[bot]` | Git author name |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git author email |

## Usage

```yaml
- name: Update repositories to commercial Broadcom repositories
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-commercial-repositories@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

No additional inputs are needed for spring-cloud-contract — the action detects it automatically via the project script.

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

This action is one step in the `initialize-commercial-branch` workflow. When used standalone:

```yaml
jobs:
  update-repos:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout spring-cloud-github-actions
        uses: actions/checkout@v4

      - name: Update repositories to commercial Broadcom repositories
        uses: ./.github/actions/update-commercial-repositories
        with:
          repository: spring-cloud/spring-cloud-foo-commercial
          branch: 4.3.x
          token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

See [initialize-commercial-branch](../../../workflows/initialize-commercial-branch.yml) for the full workflow that orchestrates all commercial branch setup actions.
