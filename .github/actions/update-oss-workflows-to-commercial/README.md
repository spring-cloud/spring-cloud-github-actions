# update-oss-workflows-to-commercial

Updates the `ci` and `pr` GitHub Actions workflow files on a commercial branch with commercial-specific configuration, committing all changes in a single commit.

Relies on `yq` (mikefarah/yq v4), which is pre-installed on GitHub-hosted Ubuntu runners.

## What it changes

### `ci.yml` / `ci.yaml`

| Field | Change |
|-------|--------|
| `on.push.branches` | Replaced with a single-item list containing the input `branch` |
| `on.workflow_dispatch.inputs.branches.default` | Updated to the input `branch` (skipped if the field is absent) |
| `jobs.deploy.with.runs_on` | Set to `ubuntu22-2-8` |

### `pr.yml` / `pr.yaml`

| Field | Change |
|-------|--------|
| `on.pull_request.branches` | Replaced with a single-item list containing the input `branch` |
| `jobs.build.secrets.ARTIFACTORY_USERNAME` | Set to `${{ secrets.ARTIFACTORY_USERNAME \|\| secrets.ARTIFACTORY_RO_USERNAME }}` |
| `jobs.build.secrets.ARTIFACTORY_PASSWORD` | Set to `${{ secrets.ARTIFACTORY_PASSWORD \|\| secrets.ARTIFACTORY_RO_PASSWORD }}` |

If a workflow file is not found the action logs a warning and continues without error.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Commercial repository containing the workflows (`org/repo-name`) |
| `branch` | yes | — | Branch to update the workflow files on |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `updating workflows for commercial repo` | Commit message |
| `git-user-name` | no | `github-actions[bot]` | Git author name |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git author email |

## Usage

```yaml
- name: Checkout spring-cloud-github-actions
  uses: actions/checkout@v4

- name: Update workflows for commercial repo
  uses: ./.github/actions/update-oss-workflows-to-commercial
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    branch: release/3.3.1
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```
