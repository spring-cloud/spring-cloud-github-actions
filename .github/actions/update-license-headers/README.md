# update-license-headers

Replaces Apache License 2.0 headers with the Broadcom license header and
replaces `LICENSE` / `LICENSE.txt` files across all source files on a branch.
Designed to run as part of the
[`initialize-commercial-branch`](../../workflows/initialize-commercial-branch.yml) workflow.

## What it changes

### `checkstyle-header.txt`

Every `checkstyle-header.txt` file found in the repository is overwritten with
the Broadcom copyright header.

### Java source files (`.java`)

The Apache license header block is replaced with the Broadcom header.

### XML files (`.xml`, `.pom`)

The Apache license comment block (`<!-- ... -->`) at the top of each file is
replaced with the Broadcom XML comment header.

### Hash-commented files (`.properties`, `.yml`, `.yaml`, `.gradle`, `.sh`)

The Apache license block (lines beginning with `#`) is replaced with the
Broadcom hash-comment header.

### `LICENSE` / `LICENSE.txt`

Any file named `LICENSE` or `LICENSE.txt` is replaced with the Broadcom
commercial license text.

### Idempotency

Files that already contain the Broadcom header are skipped.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Commercial repository to update (`org/repo-name`) |
| `branch` | yes | — | Branch to update |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `Updating license headers` | Commit message |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |

## Usage

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

The Broadcom `LICENSE.txt` asset is stored alongside the source at `LICENSE.txt`
and is automatically copied to `dist/` by `ncc` during the build.
