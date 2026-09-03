# mark-branch-merged

Records a branch as already merged into another branch without taking any of its
content, using an `ours` merge.

## Why this exists

[`retarget-branch-triggers`](../retarget-branch-triggers/README.md) pushes one
commit onto a newly cut release line branch, rewriting `main` to `5.0.x` in the
workflow branch triggers. That is the only commit
[`setup-next-release-train.yml`](../../workflows/README-setup-next-release-train.md)
makes on the new branch — the Dependabot entries and the version bump both go to
`main`.

Release lines are then merged **forward** into `main`. At that merge the merge base
is the branch point: `5.0.x` changed the trigger lines, `main` did not, so git takes
`5.0.x`'s side without a conflict and `main`'s own workflows end up triggering on
`5.0.x`.

Running this action straight after the retarget puts the retarget commit into
`main`'s history while leaving `main`'s tree byte-identical. Every later
`git merge 5.0.x` uses that merge as its base, finds nothing to re-apply, and merges
the line's real work cleanly.

## Behaviour

1. Clones `into-branch` and fetches `branch` with an explicit refspec — a
   `--single-branch` clone tracks only `into-branch`.
2. If `branch` is already an ancestor of `into-branch`, stops and reports
   `already-merged`. Re-running is the normal way this happens.
3. `git merge -s ours --no-ff`. The `--no-ff` is redundant — naming a strategy
   already disables the fast-forward — but it is the whole point of the step and
   cheap to state. At this point `branch` is normally a strict descendant of
   `into-branch`, so a fast-forward would move `into-branch` onto the retarget
   commit: exactly what this action prevents.
4. Verifies the merge changed no files before pushing. An `ours` merge must never
   change the tree, and checking here beats discovering otherwise on `main`.
5. Pushes the merge commit to `into-branch`.

Nothing fails hard: every problem is a `::warning::` and `status=failed`, so one
project cannot take down a matrix run.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `repository` | yes | | Repository containing both branches (`org/repo-name`) |
| `branch` | yes | | Branch to record as merged (e.g. `5.0.x`) |
| `into-branch` | no | `main` | Branch the merge is recorded on; also the branch cloned and pushed to |
| `commit-message` | no | `Merge branch '<branch>' into <into-branch> - workflow retarget only, no tree change [skip actions]` | Commit message |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |
| `dry-run` | no | `false` | Merge and verify locally, push nothing |
| `token` | yes | | Token with `contents: write` on the repository |

## Outputs

| Name | Description |
|---|---|
| `status` | `merged` \| `already-merged` \| `would-merge` \| `failed` |

## Example

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/mark-branch-merged@main
  with:
    repository:  spring-cloud/spring-cloud-config
    branch:      5.0.x
    into-branch: main
    token:       ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## If the push is rejected

The commit this action pushes is a merge commit, so a ruleset requiring **linear
history** on `into-branch` will reject it. That is the likeliest cause of a
`failed` status with a push error. Either exempt the release automation actor from
that rule, or drop the rule — and until then, fix `main` by hand after each merge
forward with the revert recipe in
[`docs/release-automation.md`](../../../docs/release-automation.md).

Used by [`setup-next-release-train.yml`](../../workflows/README-setup-next-release-train.md).
