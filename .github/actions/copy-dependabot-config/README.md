# copy-dependabot-config

Copies a `dependabot.yml` or `dependabot.yaml` file from one branch to another within the same repository, committing it as a separate commit.

If no dependabot config file is found on the source branch, the action exits cleanly without error. If the file already exists on the target branch and is identical, it also exits cleanly without creating an empty commit.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Repository containing both branches (`org/repo-name`) |
| `source-branch` | no | repo default branch | Branch to copy the dependabot config from |
| `target-branch` | yes | — | Branch to copy the dependabot config to |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `adding dependabot yaml` | Commit message |
| `git-user-name` | no | `github-actions[bot]` | Git author name |
| `git-user-email` | no | `github-actions[bot]@users.noreply.github.com` | Git author email |

## Usage

```yaml
- name: Copy dependabot config
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-dependabot-config@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    target-branch: 3.3.x
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

### Specifying an explicit source branch

```yaml
- name: Copy dependabot config
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-dependabot-config@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    source-branch: main
    target-branch: 3.3.x
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

## Composing with create-commercial-branch

These two actions are designed to be layered together in a single workflow:

```yaml
jobs:
  create-branch:
    runs-on: ubuntu-latest
    steps:
      - name: Create commercial branch from OSS
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-commercial-branch@main
        with:
          oss-repo: spring-cloud/spring-cloud-foo
          oss-branch: ${{ inputs.oss_branch }}
          commercial-repo: spring-cloud/spring-cloud-foo-commercial
          set-default-branch: 'true'
          token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}

      - name: Copy dependabot config to new branch
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-dependabot-config@main
        with:
          repository: spring-cloud/spring-cloud-foo-commercial
          target-branch: ${{ inputs.oss_branch }}
          token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```
