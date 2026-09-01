# update-license-headers

Replaces Apache License 2.0 headers with the Broadcom license header, for the file types
that [`spd migrate-license`](https://github.com/spring-io/spring-devkit) does **not**
cover. Designed to run as part of the
[`initialize-commercial-branch`](../../workflows/initialize-commercial-branch.yml)
workflow, immediately after `spd migrate-license`.

## Division of labour with spring-devkit

`spd migrate-license` owns everything below, and this action deliberately skips it:

| Owned by devkit | Why |
|---|---|
| `.java`, `.kt`, `.kts` (incl. `build.gradle.kts`), `.groovy`, `.gradle` | Preserves each file's original copyright year instead of hardcoding one |
| `.properties` | Same |
| Any file named `LICENSE` (any case, extension, location) | Replaced with the Broadcom Foundation Agreement bundled in devkit |
| `checkstyle-header.txt` | Handles both the plain `RegexpHeaderCheck` and spring-javaformat escaped dialects |
| `.idea/copyright` profiles | Not handled here at all |

devkit also skips third-party source that a `checkstyle-suppressions.xml` excludes from
every check (`checks=".*"`) — code the project does not own the copyright to.

## What this action changes

### Block-comment sources devkit ignores

`.js`, `.mjs`, `.ts`, `.tsx`, `.jsx`, `.scala`, `.c`, `.cpp`, `.cc`, `.h`, `.hpp`,
`.cs`, `.go`, `.swift` — the leading Apache block comment is replaced with the Broadcom
header.

### XML files

`.xml`, `.html`, `.htm`, `.xsl`, `.xsd`, `.wsdl`, `.fxml`, `.xhtml`, `.svg`, `.pom` — the
Apache comment block (`<!-- ... -->`) is replaced with the Broadcom XML comment, keeping
any `<?xml ?>` declaration first. In Maven POMs, an Apache `<licenses>` block is also
rewritten into a Broadcom `<license><comments>` block.

### Hash-commented files

`.yml`, `.yaml`, `.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.pl`, `.tf`, `.toml` — the Apache
`#` block is replaced with the Broadcom hash-comment header, preserving any shebang line.

### Idempotency

Files with no `Licensed under the Apache License` marker — including ones already
carrying the Broadcom header — are left untouched.

> **Known limitation:** the copyright year in the Broadcom header written by *this*
> action is hardcoded to 2012. devkit preserves the original year for the files it owns;
> the two will disagree until this action learns to do the same, or devkit grows XML/YAML
> support.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `directory` | no | — | Path to an already checked-out tree to update in place. When set, the action does not clone, commit or push. Takes precedence over `repository`/`branch`/`token`. |
| `repository` | unless `directory` | — | Commercial repository to update (`org/repo-name`) |
| `branch` | unless `directory` | — | Branch to update |
| `token` | unless `directory` | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `Updating license headers [skip actions]` | Commit message. Unused with `directory`. |
| `git-user-name` | no | `Spring Builds` | Git author name. Unused with `directory`. |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email. Unused with `directory`. |

## Outputs

| Name | Description |
|------|-------------|
| `files-changed` | Number of files whose license header was rewritten |

## Usage

In place, alongside `spd migrate-license` (how `initialize-commercial-branch` uses it):

```yaml
- name: Update the headers devkit does not own
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-license-headers@v1
  with:
    directory: ${{ runner.temp }}/_license_repo
```

Standalone against a branch:

```yaml
- name: Update license headers
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-license-headers@v1
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
