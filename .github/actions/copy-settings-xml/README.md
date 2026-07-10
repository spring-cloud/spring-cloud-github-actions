# copy-settings-xml

Replaces `.settings.xml` on a target branch with the version from the source
(or default) branch of the same repository. Used during commercial branch
initialization to ensure the new branch has the correct Maven settings.

## What it does

1. Resolves the source branch — if `source-branch` is omitted, the repository's
   default branch is used.
2. Checks whether `.settings.xml` exists on the source branch. If not, the
   action exits successfully with no changes.
3. Checks out the target branch, removes any existing `.settings.xml`, and
   copies the file from the source branch.
4. Commits and pushes the change. If the file on the target branch is already
   identical to the source, no commit is made.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | yes | — | Repository containing both branches (`org/repo-name`) |
| `source-branch` | no | repository default branch | Branch to copy `.settings.xml` from |
| `target-branch` | yes | — | Branch to copy `.settings.xml` to |
| `token` | yes | — | GitHub token with `contents: write` permission on the repository |
| `commit-message` | no | `Updating settings.xml` | Commit message |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |

## Usage

```yaml
- name: Copy settings.xml
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-settings-xml@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    target-branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

To copy from a specific branch rather than the default:

```yaml
- name: Copy settings.xml
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/copy-settings-xml@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    source-branch: main
    target-branch: 4.3.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```
