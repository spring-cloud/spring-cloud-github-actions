# add-dependabot-branch-entries

Duplicates the entries in a repository's Dependabot config that target one branch,
retargeting the copies at a newly created branch, so Dependabot starts raising PRs
against the new release line.

This is the inverse of what [`retire-branch.yml`](../../workflows/README-retire-branch.md)
does when a line is retired, and it edits the config in the same place: **the
repository's default branch**. Dependabot reads `.github/dependabot.yml` only from
there — a copy on any other branch is inert, which is what separates this action
from [`copy-dependabot-config`](../copy-dependabot-config/README.md).

## Behaviour

1. Clones the default branch and finds `.github/dependabot.yml` or
   `.github/dependabot.yaml`. With neither present it warns and exits 0.
2. If any entry already targets the new branch, it stops — this is what makes a
   re-run safe.
3. Copies every entry that targets the source branch, with `target-branch` set to
   the new branch. The originals are left exactly as they were.
   - When the source branch *is* the default branch, entries with **no**
     `target-branch` are part of the set: an absent `target-branch` implicitly
     means the default branch. Their copies get an explicit one.
   - The copies are produced by merging `{"target-branch": <new>}` rather than
     assigning: inside `yq`'s `+=` argument an assignment to a key the entry does
     not already have is silently dropped, which would leave those copies
     duplicating the originals verbatim.
4. Stages, captures the patch, then commits and pushes to the default branch.

## What it does not do

A copied entry keeps the original's `milestone`. After a train rollover `main`'s
milestone number belongs to the *new* branch's line, so the copy is right and
**`main`'s own entry is left pointing at the old milestone**. Repointing it is a
manual follow-up.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `repository` | yes | | Repository whose config is updated (`org/repo-name`) |
| `new-branch` | yes | | Branch the duplicated entries should target (e.g. `5.0.x`) |
| `source-branch` | no | the default branch | Branch whose entries are duplicated |
| `commit-message` | no | `Add Dependabot entries for <new-branch>` | Commit message |
| `git-user-name` | no | `Spring Builds` | Git author name |
| `git-user-email` | no | `svc.spring-builds@broadcom.com` | Git author email |
| `dry-run` | no | `false` | Stage and capture the patch, commit and push nothing |
| `token` | yes | | Token with `contents: write` on the repository |

## Outputs

| Name | Description |
|---|---|
| `changed` | `true` when entries were added |
| `patch-file` | Path to the captured diff, empty when nothing changed |

## Example

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/add-dependabot-branch-entries@main
  with:
    repository: spring-cloud/spring-cloud-config
    new-branch: 5.0.x
    token:      ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Used by [`setup-next-release-train.yml`](../../workflows/README-setup-next-release-train.md).
