# create-commercial-branch

Creates a branch in a **commercial** Spring Cloud repository by copying the content of a branch or tag from the corresponding **OSS** repository, without carrying over any of the OSS git history.

The new branch is created as a [git orphan branch](https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt---orphanltnewbranchgt) — it has a single initial commit whose tree matches the OSS source, but shares no commit ancestry with the OSS repository.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `oss-repo` | yes | — | OSS repository to copy from (`org/repo-name`) |
| `oss-branch` | one of `oss-branch` / `oss-tag` | — | Branch in the OSS repository to copy |
| `oss-tag` | one of `oss-branch` / `oss-tag` | — | Tag in the OSS repository to copy. When used, `commercial-branch` is required. |
| `commercial-repo` | yes | — | Commercial repository to create the branch in (`org/repo-name`) |
| `commercial-branch` | no (yes when `oss-tag` is used) | same as `oss-branch` | Target branch name in the commercial repository |
| `token` | yes | — | GitHub token with `contents: write` permission on the commercial repo |
| `commit-message` | no | `Initialize <branch> from <oss-repo>@<ref>` | Commit message for the initial commit |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |

`oss-branch` and `oss-tag` are mutually exclusive — exactly one must be provided.

## Outputs

| Name | Description |
|------|-------------|
| `commercial-branch` | The name of the branch that was created (useful when the input defaulted to `oss-branch`) |
| `previous-default-branch` | The default branch of the commercial repo before the new branch was created |

## Usage

From a branch:

```yaml
- name: Create commercial branch
  id: create-branch
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-commercial-branch@v1
  with:
    oss-repo: spring-cloud/spring-cloud-foo
    oss-branch: 3.3.x
    commercial-repo: spring-cloud/spring-cloud-foo-commercial
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

From a tag (commercial branch name is required):

```yaml
- name: Create commercial branch from tag
  id: create-branch
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-commercial-branch@v1
  with:
    oss-repo: spring-cloud/spring-cloud-foo
    oss-tag: v3.3.0
    commercial-repo: spring-cloud/spring-cloud-foo-commercial
    commercial-branch: 3.3.x
    token: ${{ secrets.COMMERCIAL_REPO_TOKEN }}
```

## Notes

- The action will **fail** if the target branch already exists in the commercial repository. Delete it first if you need to recreate it.
- The action performs a **shallow clone** (`--depth 1`) of the OSS repository, so only the files are transferred — not the full commit history.
- The `token` must have `contents: write` (and `workflows: write` if the OSS repo contains workflow files) on the commercial repository. A fine-grained personal access token or a GitHub App token scoped to the commercial repo is recommended.
- To set the new branch as the default and copy a dependabot config, use the [initialize-commercial-branch](../../../../.github/workflows/initialize-commercial-branch.yml) workflow, which composes this action with [copy-dependabot-config](../copy-dependabot-config/) and a `gh repo edit` step in the correct order.
