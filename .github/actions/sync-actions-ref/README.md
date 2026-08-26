# sync-actions-ref

Repoints every reference to the shared actions repository in one branch of one repository at a given commit SHA, annotated with the release tag it came from:

```yaml
uses: spring-cloud/spring-cloud-github-actions/.github/workflows/deploy.yml@d52d95a… # v1.0.0
```

Idempotent — a branch already on the target ref reports `no-change` and pushes nothing.

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `repository` | yes | Repository to update (e.g. `spring-cloud/spring-cloud-vault`) |
| `branch` | yes | Branch to update |
| `actions-repository` | no | Shared actions repository whose references are rewritten. Defaults to `spring-cloud/spring-cloud-github-actions`. |
| `to-sha` | yes | Commit SHA to pin to, normally from [resolve-actions-ref](../resolve-actions-ref/README.md) |
| `to-tag` | yes | Tag the SHA came from, written as a trailing comment |
| `token` | yes | GitHub token with `contents: write` on the target repository |
| `commit-message` | no | Defaults to ``Pin spring-cloud-github-actions to <tag>`` |
| `dry-run` | no | Render and diff without committing or pushing. Defaults to `false`. |

## Outputs

| Name | Description |
|------|-------------|
| `status` | `updated`, `would-update` (dry run), `no-change`, or `skipped` |
| `files` | Space-separated list of files that changed |

## Usage

Normally driven by [rollout-actions-ref.yml](../../workflows/rollout-actions-ref.yml) rather than called directly:

```yaml
- uses: ./.github/actions/sync-actions-ref
  with:
    repository: spring-cloud/spring-cloud-vault
    branch:     main
    to-sha:     ${{ steps.resolve.outputs.sha }}
    to-tag:     ${{ steps.resolve.outputs.tag }}
    token:      ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Notes

- **Matches on the `uses:` string, not on filenames or line numbers.** Consumers spell these `ci.yml` / `ci.yaml` / `pr.yml` / `pr.yaml` / `maven.yaml`, line numbers differ per branch, and some repositories (notably `spring-cloud-kubernetes`) call `determine-matrix` and `trigger-branch-ci` directly instead of going through `deploy.yml`.
- **The trailing comment is absorbed and rewritten, not appended.** Without that, a second run would leave two `# <tag>` comments on the same line. Getting the comment right the first time matters: Dependabot keeps a *correct* version comment in sync but [will not fix an inaccurate one](https://github.com/dependabot/dependabot-core/issues/7912).
- **Refuses to run when `to-sha` is `main` or empty.** Pinning consumers back to a moving branch is precisely what this action exists to undo, so that is treated as an error rather than a no-op.
- **Clones into a temporary directory rather than using the workspace checkout.** `actions/checkout` writes an `http.https://github.com/.extraheader` credential into the local git config of the repository it checks out, and that header takes precedence over credentials embedded in a remote URL — so running from inside that checkout would authenticate as the caller's `GITHUB_TOKEN` rather than the token given to this action.
- **A branch that cannot be cloned is skipped, not failed.** Retired branches carry `Locked Branches` rulesets with no bypass actors, so a mistargeted push fails by design.
