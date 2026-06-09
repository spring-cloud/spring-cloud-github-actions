# update-antora-playbook

Registers a new commercial branch in the Antora playbook that lives on the
`docs-build` branch of a commercial repository, so documentation builds
automatically include the new branch and its release tags.

## What it does

1. **Checks for the `docs-build` branch** — if the branch does not exist, the
   action emits a visible warning annotation and exits without failing.
2. **Finds `antora-playbook.yml` / `antora-playbook.yaml`** in the root of the
   `docs-build` branch — same graceful warning if absent.
3. **Adds the branch** to `content.sources[].branches` (skips if already
   present).
4. **Adjusts tag patterns** in `content.sources[].tags` so that release tags
   from the new branch are matched:

   | Branch form | Expected tags | Strategy |
   |---|---|---|
   | `X.Y.x` (standard) | `vX.Y.0`, `vX.Y.1`, `vX.Y.0-RC1`, … | Find the first positive pattern starting with `v{MIN..MAX}.`; expand the major range if `X` is outside it; expand the minor extglob `+({N..M})` if `Y` is outside it. |
   | `X.Y.Z.x` (hotfix) | `vX.Y.Z.1`, `vX.Y.Z.2`, … | Add `vX.Y.Z.+([0-9])?(-{RC,M}*)` if no 4-part version pattern already exists. |

5. **Commits and pushes** to `docs-build` only when changes were actually made.

YAML formatting (comments, quoting styles, inline flow sequences) is preserved
using the [`yaml`](https://www.npmjs.com/package/yaml) Node.js package.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `repository` | yes | — | Commercial repository in `org/repo-name` format |
| `branch` | yes | — | New commercial branch to register |
| `token` | yes | — | GitHub token with `contents: write` on the repository |
| `docs-build-branch` | no | `docs-build` | Branch holding the Antora playbook |
| `commit-message` | no | `Updating antora playbook for new branch` | Commit message |
| `git-user-name` | no | `github-actions[bot]` | Git author name |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git author email |

## Usage

```yaml
- name: Update Antora playbook
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-antora-playbook@main
  with:
    repository: spring-cloud/spring-cloud-contract-commercial
    branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Examples

### Standard branch (`4.3.x`)

Given:
```yaml
content:
  sources:
    - url: https://github.com/spring-cloud/spring-cloud-contract-commercial
      branches: [ 4.2.x, 4.1.x ]
      tags: [ 'v{4..9}.+({1..9}).+({0..9})?(-{RC,M}*)', '!v4.1.0-M1' ]
```

After running with `branch: 4.3.x`:
```yaml
content:
  sources:
    - url: https://github.com/spring-cloud/spring-cloud-contract-commercial
      branches: [ 4.2.x, 4.1.x, 4.3.x ]
      tags: [ 'v{4..9}.+({1..9}).+({0..9})?(-{RC,M}*)', '!v4.1.0-M1' ]
      # (tag range already covers v4.*)
```

### Major version outside the existing range (`10.0.x`)

Given the same playbook, running with `branch: 10.0.x` expands the major range:
```yaml
tags: [ 'v{4..10}.+({0..9}).+({0..9})?(-{RC,M}*)', '!v4.1.0-M1' ]
```

### Branch with minor version 0 (`5.0.x`) when pattern uses `+({1..9})`

The minor extglob is expanded from `+({1..9})` to `+({0..9})`:
```yaml
tags: [ 'v{4..9}.+({0..9}).+({0..9})?(-{RC,M}*)', '!v4.1.0-M1' ]
```

### Hotfix branch (`5.0.1.x`)

A dedicated 4-part pattern is appended:
```yaml
tags: [ 'v{4..9}.+({1..9}).+({0..9})?(-{RC,M}*)', '!v4.1.0-M1', 'v5.0.1.+([0-9])?(-{RC,M}*)' ]
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
