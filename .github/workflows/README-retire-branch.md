# retire-branch workflow

Retires a branch that is no longer actively maintained by:

1. **Updating `projects.json`** — removes the branch from `scheduled` and
   `jdkVersions` in `config/projects.json` in the `spring-cloud-github-actions`
   repository. Fails fast if the branch is set as the default, preventing
   accidental retirement of an active branch.
2. **Removing Dependabot entries** — removes every entry in the repository's
   `dependabot.yml` whose `target-branch` matches the retiring branch and
   commits the change to the default branch. If no entries remain after
   removal, the `dependabot.yml` file is deleted entirely.
3. **Removing the branch from the Antora playbook** — removes the branch from
   `content.sources.branches` in `antora-playbook.yml` on the repo's
   `docs-build` branch so it is no longer included in documentation builds.
   No-op when the docs-build branch, playbook, or branch entry is absent.
4. **Locking the branch** — adds `refs/heads/<branch>` to the repository
   ruleset named `Locked Branches`, preventing any further commits from being
   pushed. The ruleset is created if the repository does not have one yet, and
   a branch already listed in it is left alone.

## Required token permissions

The token must have the following permissions on the **target** repository:

| Permission | Reason |
|---|---|
| `contents: write` | Commit the updated `dependabot.yml` to the default branch and update `projects.json` |
| `administration: write` | Create and update the repository ruleset that locks the branch |

## Inputs

### `workflow_dispatch` (manual run)

| Input | Required | Description |
|---|---|---|
| `repo` | yes | Repository in `org/repo-name` format |
| `branch` | yes | Branch to retire |
| `token` | no | Override token (falls back to `GH_ACTIONS_REPO_TOKEN`) |

### `workflow_call` (reusable)

| Input | Required | Description |
|---|---|---|
| `repo` | yes | Repository in `org/repo-name` format |
| `branch` | yes | Branch to retire |

| Secret | Required | Description |
|---|---|---|
| `token` | no | Falls back to `GH_ACTIONS_REPO_TOKEN` |

## Usage examples

### Manual trigger

Run from the GitHub Actions UI by selecting **Retire Branch**, then supplying
the repository and branch name.

### Reusable workflow call

```yaml
jobs:
  retire:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/retire-branch.yml@v1
    with:
      repo: spring-cloud/spring-cloud-circuitbreaker-commercial
      branch: 3.1.x
    secrets: inherit
```

## What happens in each step

### Update projects.json

Clones `spring-cloud-github-actions` and runs the
[`retire-branch-projects-json`](../actions/retire-branch-projects-json/README.md)
action to update `config/projects.json`:

- For `-commercial` repos → modifies the `commercial` section of the project entry.
- For OSS repos → modifies the `oss` section.
- If the branch is listed in `branches.default` → **fails the workflow** before
  making any other changes.
- If the branch is not found in `scheduled` or `jdkVersions` → logs a message
  and skips that operation.

### Remove Dependabot entries

The workflow clones the **default branch** of the target repository (that is
where `dependabot.yml` is read by GitHub) and uses `yq` to delete every
`updates[]` entry whose `target-branch` equals the retiring branch.

- If no `dependabot.yml` / `dependabot.yaml` is found → logs a message and
  skips.
- If no entries match the branch → logs a message and skips.
- If entries are removed and none remain → deletes the file.
- Changes are committed with the message:
  `Remove Dependabot entries for retired branch <branch>`

### Remove branch from Antora playbook

Runs the [`update-antora-playbook`](../actions/update-antora-playbook/README.md)
action with `operation: remove`, which clones the `docs-build` branch and drops
the branch from `content.sources.branches` in `antora-playbook.yml`.

- If the `docs-build` branch does not exist → emits a warning and skips.
- If no `antora-playbook.yml` / `antora-playbook.yaml` is found → warns and skips.
- If the branch is not present in `content.sources.branches` → logs a message
  and skips (no commit).
- Tag patterns are left untouched.

### Lock branch

Every retired branch in a repository accumulates in a single repository ruleset
named `Locked Branches`, so what is retired is auditable in one place.

The step lists the repository's rulesets and looks for that name, filtering on
`source_type == "Repository"` — organization-level rulesets are returned by the
same endpoint but cannot be written through the repository API. If it is absent,
the ruleset is created targeting this branch, with rules blocking `creation`,
`update` (`update_allows_fetch_and_merge: false`), `deletion` and
`non_fast_forward`. If it exists, the branch's ref is appended to
`conditions.ref_name.include` and the ruleset is written back — the update
endpoint is a `PUT` and requires the complete ruleset body, so the existing one
is fetched and re-sent with the new include list. A branch already in the list
is a no-op.

Once locked, GitHub will reject any push attempts to the branch.

[lock-branches.yml](README-lock-branches.md) also locks branches, but through a
separate `Release Freeze` ruleset that it deletes again — a temporary freeze
during a release, as opposed to the permanent retirement here. The two never
touch each other's ruleset, and rulesets are additive, so a branch that is both
retired and frozen stays locked when the freeze is lifted.

## Related workflows

- [`create-commercial-branch.yml`](README-create-commercial-branch.md) — creates a new commercial branch
- [`create-hotfix-release-branch.yml`](README-create-hotfix-branch.md) — creates a hotfix branch from an OSS tag
- [`lock-unlock-branches.yml`](README-lock-branches.md) — temporarily freezes branches during a release, via a separate ruleset
