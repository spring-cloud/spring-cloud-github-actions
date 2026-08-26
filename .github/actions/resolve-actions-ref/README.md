# resolve-actions-ref

Resolves the ref that generated workflows should point at: the latest published release of the shared actions repository, as a commit SHA plus the tag it came from.

This is the single place that knows how to find the current release. Every surface that writes a ref into another repository uses it, so the lookup exists once.

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `repository` | no | Repository to resolve a release from. Defaults to `spring-cloud/spring-cloud-github-actions`. |
| `ref` | no | Explicit override. When set, it is used verbatim as the tag and resolved to a SHA; when empty, the latest release is looked up. |
| `token` | yes | GitHub token with read access to the actions repository |

## Outputs

| Name | Description |
|------|-------------|
| `tag` | Tag name of the resolved release, or `main` when none exists |
| `sha` | Commit SHA the tag points at, with annotated tags peeled |
| `pinned-ref` | Ready-to-write `"<sha> # <tag>"`, or just `main` when unresolved |

## Usage

```yaml
- name: Resolve the ref to pin to
  id: resolve
  uses: ./.github/actions/resolve-actions-ref
  with:
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}

- run: echo "Pinning to ${{ steps.resolve.outputs.sha }} (${{ steps.resolve.outputs.tag }})"
```

## Notes

- **Uses `repos/{repo}/commits/{tag}` to resolve the SHA**, which peels an annotated tag to the commit it points at. Reading `git/ref/tags/{tag}` instead returns the *tag object's* SHA, which is not a commit and cannot be used in `uses:`.
- **`releases/latest` ignores drafts and prereleases**, so a generated workflow is never pointed at an unpublished release.
- **Falls back to `main` when no release exists** rather than failing, so the action still works before the first release and in forks. Callers that require a real release should check the `tag` output and fail themselves — `rollout-actions-ref.yml` and `rollout-deploy-docs.yml` both do.
- **This is a composite action referencing nothing else**, so it is safe to call from any context. Callers that invoke it by relative path must be running in a checkout of this repository — see the note in [sync-actions-ref](../sync-actions-ref/README.md).
