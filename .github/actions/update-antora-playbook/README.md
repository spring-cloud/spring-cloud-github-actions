# update-antora-playbook

Adds or removes a commercial branch in the Antora playbook that lives on the
`docs-build` branch of a commercial repository, so documentation builds include
(or stop including) the branch and its release tags. The direction is controlled
by the `operation` input (`add` by default, or `remove`).

## What it does

1. **Checks for the `docs-build` branch** — if the branch does not exist, the
   action emits a visible warning annotation and exits without failing.
2. **Finds `antora-playbook.yml` / `antora-playbook.yaml`** in the root of the
   `docs-build` branch — same graceful warning if absent.
3. **Adds or removes the branch** in `content.sources[].branches`:
   - `operation: add` — adds the branch (skips if already present).
   - `operation: remove` — removes the branch (no-op if not present).
4. **Adjusts tag patterns** in `content.sources[].tags` so that release tags
   from the new branch are matched (**add only** — `remove` leaves tags
   untouched). First it builds a representative release tag for the branch and
   tests it against the existing patterns with the same glob engine Antora uses
   ([picomatch](https://www.npmjs.com/package/picomatch)); if an existing
   pattern already matches, **no tag change is made**. This avoids appending
   redundant entries when the playbook uses a broad expression the range logic
   below doesn't recognise. Only when the representative tag is _not_ already
   covered does it fall back to:

   | Branch form | Representative tag | Strategy when not covered |
   |---|---|---|
   | `X.Y.x` (standard) | `vX.Y.0` | Find the first positive pattern starting with `v{MIN..MAX}.`; expand the major range if `X` is outside it, and/or expand the minor extglob `+({N..M})` if `Y` is outside it. If no range pattern exists, append `vX.+([0-9]).+([0-9])?(-{RC,M}*)`. |
   | `X.Y.Z.x` (hotfix) | `vX.Y.Z.1` | Append `vX.Y.Z.+([0-9])?(-{RC,M}*)`. |

5. **Commits and pushes** to `docs-build` only when changes were actually made.

YAML formatting (comments, quoting styles, inline flow sequences) is preserved
using the [`yaml`](https://www.npmjs.com/package/yaml) Node.js package.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `repository` | yes | — | Commercial repository in `org/repo-name` format |
| `branch` | yes | — | Commercial branch to add to or remove from the playbook |
| `operation` | no | `add` | `add` to register the branch, `remove` to drop it |
| `token` | yes | — | GitHub token with `contents: write` on the repository |
| `docs-build-branch` | no | `docs-build` | Branch holding the Antora playbook |
| `commit-message` | no | operation-specific | Commit message; defaults to an add/remove-specific message when empty |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |

## Usage

```yaml
- name: Update Antora playbook
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-antora-playbook@v1
  with:
    repository: spring-cloud/spring-cloud-contract-commercial
    branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

To remove a branch (e.g. when it is retired or released), set `operation: remove`:

```yaml
- name: Remove branch from Antora playbook
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-antora-playbook@v1
  with:
    repository: spring-cloud/spring-cloud-contract-commercial
    branch: release/4.3.1.1
    operation: remove
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
