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
- name: Update workflows for commercial repo
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-oss-workflows-to-commercial@v1
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    branch: 3.3.x
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

## Composing with initialize-commercial-branch

This action is designed to be used alongside the other commercial branch actions:

```yaml
jobs:
  initialize:
    runs-on: ubuntu-latest
    steps:
      - name: Create commercial branch from OSS
        id: create-branch
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-commercial-branch@v1
        with:
          oss-repo: spring-cloud/spring-cloud-foo
          oss-branch: 3.3.x
          commercial-repo: spring-cloud/spring-cloud-foo-commercial
          token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}

      - name: Update workflows for commercial repo
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-oss-workflows-to-commercial@v1
        with:
          repository: spring-cloud/spring-cloud-foo-commercial
          branch: ${{ steps.create-branch.outputs.commercial-branch }}
          token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}

      - name: Copy dependabot config to new branch
        if: ${{ inputs.set_default_branch }}
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-dependabot-config@v1
        with:
          repository: spring-cloud/spring-cloud-foo-commercial
          source-branch: ${{ steps.create-branch.outputs.previous-default-branch }}
          target-branch: ${{ steps.create-branch.outputs.commercial-branch }}
          token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```
