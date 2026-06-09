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
3. **Locking the branch** — sets `lock_branch: true` on the branch via the
   GitHub Branch Protection API, preventing any further commits from being
   pushed. Existing protection rules (required checks, required reviews, etc.)
   are preserved; only `lock_branch` is added/updated.

## Required token permissions

The token must have the following permissions on the **target** repository:

| Permission | Reason |
|---|---|
| `contents: write` | Commit the updated `dependabot.yml` to the default branch and update `projects.json` |
| `administration: write` | Set branch protection / lock the branch |

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
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/retire-branch.yml@main
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

### Lock branch

Fetches the existing branch protection settings via the GitHub API, then
re-applies them with `lock_branch: true` set. If no protection rules exist,
a minimal rule (all other constraints null/false) with `lock_branch: true` is
created.

Once locked, the branch is visible in the repository with a lock icon and
GitHub will reject any push attempts to it.

## Related workflows

- [`create-commercial-branch.yml`](README-create-commercial-branch.md) — creates a new commercial branch
- [`create-hotfix-branch.yml`](README-create-hotfix-branch.md) — creates a hotfix branch from an OSS tag
