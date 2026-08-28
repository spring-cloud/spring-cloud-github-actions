# retarget-branch-triggers

Rewrites the branch triggers of every GitHub Actions workflow on a branch so they
name that branch instead of the branch it was cut from.

A new release line branch (`5.0.x`, cut from `main`) starts out with `main`'s
workflow files, whose `on.push.branches` / `on.pull_request.branches` still name
`main` — so nothing on the new branch builds. This action fixes that in one commit.

It is the OSS counterpart of
[`update-oss-workflows-to-commercial`](../update-oss-workflows-to-commercial/README.md),
which does the same retargeting but also applies the commercial-only edits
(Artifactory secrets, `runs_on`). This action makes no other change.

## Behaviour

For every `.github/workflows/*.yml` and `*.yaml` on the branch:

1. If the file names the source branch in `on.push.branches`,
   `on.pull_request.branches` or `on.pull_request_target.branches`, or its
   `on.workflow_dispatch.inputs.branches.default` is exactly the source branch,
   the file is rewritten. **Otherwise it is not touched at all** — `yq` reflows a
   flow list it parses (`[ a ]` → `[a]`), so a workflow like `deploy-docs.yml`
   that only ever triggers on `docs-build` would land in the commit as pure
   whitespace churn.
2. Only the list *elements* naming the source branch are replaced, never the
   whole list, so branches like `docs-build` survive.
3. Triggers the file does not declare are left alone. Assigning through a missing
   trigger does not no-op in `yq` — it materialises it, bolting an empty
   `pull_request: branches: []` onto a push-only workflow.

Everything is staged, and the patch is captured, before the decision to commit,
so a dry run reports exactly what a real run would push.

Re-running against an already-retargeted branch is a no-op that reports how many
workflows already trigger on it. A branch whose workflows name neither the source
nor the target branch raises a warning — there is nothing this action can do for it.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `repository` | yes | | Repository containing the branch (`org/repo-name`) |
| `branch` | yes | | Branch whose workflows are retargeted, and the branch committed to |
| `source-branch` | no | `main` | The branch name the triggers currently point at |
| `clone-branch` | no | `''` | Branch to clone and compute the patch from, when it is not `branch` itself. Setting it forces dry-run behaviour |
| `commit-message` | no | `Retarget workflow triggers to <branch> [skip actions]` | Commit message |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |
| `dry-run` | no | `false` | Stage and capture the patch, commit and push nothing |
| `token` | yes | | Token with `contents: write` on the repository |

### `clone-branch`

On a dry run the new branch does not exist yet, so there is nothing to clone.
Pass `clone-branch: main` and the patch is computed from `main` instead: the
branch is cut from `main` unchanged, so it is the same patch. Because committing a
patch computed from another branch would be a silent cross-branch write, setting
`clone-branch` to anything other than `branch` forces `dry-run` on.

## Outputs

| Name | Description |
|---|---|
| `changed` | `true` when at least one workflow file was rewritten |
| `patch-file` | Path to the captured diff, empty when nothing changed |

## Example

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/retarget-branch-triggers@main
  with:
    repository:    spring-cloud/spring-cloud-config
    branch:        5.0.x
    source-branch: main
    token:         ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Used by [`setup-next-release-train.yml`](../../workflows/README-setup-next-release-train.md).
