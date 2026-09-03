# Setup Next Release Train

Rolls `main` forward in every OSS project when a release train branches.

At a train rollover each OSS repository needs the same set of changes: the line that
just closed gets its own branch, that branch has to start building, Dependabot has
to start watching it, `main` has to move onto the next train's versions, and the new
line needs a first milestone. Doing that by hand across ~30 repositories is the chore
this workflow replaces.

It is the OSS counterpart of
[`create-oss-release-branch.yml`](create-oss-release-branch.yml), which does the
equivalent work on the commercial side.

## What it does

Per project, in one matrix leg:

| # | Step | What happens |
|---|------|--------------|
| 1 | **derive** | Reads the root `pom.xml` on `main` and derives the release line branch from its version: `5.0.4-SNAPSHOT` → `5.0.x`. Also derives the milestone title from the next train's version for the project: `5.1.0-SNAPSHOT` → `5.1.0-M1`. |
| 2 | **branch** | Creates that branch from `main`'s tip. An existing branch is left as it is. |
| 3 | **retarget** | [`retarget-branch-triggers`](../actions/retarget-branch-triggers/README.md) rewrites the new branch's workflow branch triggers so they name it instead of `main`. |
| 3b | **mark merged** | [`mark-branch-merged`](../actions/mark-branch-merged/README.md) records that retarget commit as merged into `main` with an `ours` merge, leaving `main`'s tree untouched. Without it the next merge forward would carry the retarget along and repoint `main`'s own workflows at the new branch — see [Why the `ours` merge](#why-the-ours-merge). |
| 4 | **dependabot** | [`add-dependabot-branch-entries`](../actions/add-dependabot-branch-entries/README.md) duplicates `main`'s Dependabot entries, retargeted at the new branch. The edit lands **on `main`** — Dependabot only reads the config on the default branch. |
| 5 | **versions** | [`update-project-versions`](../actions/update-project-versions/README.md) moves `main` onto the next train's versions, then commits and pushes. Deliberately no `[skip actions]`: the point of the bump is to have CI build on the new snapshots. |
| 6 | **milestone** | [`create-milestone`](../actions/create-milestone/README.md) opens the first milestone of the new line in the OSS repository. |

Then once per run:

| # | Step | What happens |
|---|------|--------------|
| 7 | **register** | [`add-branches-projects-json`](../actions/add-branches-projects-json/README.md) adds every new branch to `config/projects.json` as a **single** commit. In the matrix, eight parallel legs would spend their time losing races to each other pushing to this repository's `main`. |

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `release_train_version` | yes | | The **next** release train version `main` should move to (e.g. `2026.1.0-SNAPSHOT`). Must have a matching properties file on the `jenkins-releaser-config` branch. |
| `projects` | no | `''` | Comma-separated projects to run against. When empty, every project in the properties file is processed. |
| `dry_run` | no | `true` | Nothing is branched, committed, pushed or created — but the summary shows the diffs that would be pushed. |
| `token` | no | `''` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. |

The properties file is read from **`spring-cloud-release-commercial@jenkins-releaser-config`**,
for OSS trains too — that repository holds the releaser config for every train now.
This workflow does not create the file; commit it there first.

Like `update-versions.yml`, the setup job waits until `raw.githubusercontent.com`
serves the file the API returned. Applying a stale properties file across every
repository is far worse than waiting for the CDN.

## Dry runs

`dry_run` is on by default, and a dry run does more than say "would push". Every
mutating step stages its work and captures the diff before deciding to commit, so
the job summary carries a collapsible block per project with the actual patch —
workflow triggers, Dependabot entries and version bumps — plus one for
`config/projects.json`. Blocks are truncated at 200 lines / 20 KB (the step summary
is capped at 1 MB); the untruncated patches are in each leg's `result-setup-*`
artifact.

The new branch does not exist during a dry run, so the retarget step is pointed at
`main` instead. The branch is cut from `main` unchanged, so the patch is identical.

## Re-running

Every step is idempotent, and each reports `no-changes` rather than failing when its
work is already done:

- an existing branch is left alone;
- workflows already pointing at the new branch are not rewritten;
- a Dependabot config that already has entries for the branch is not touched;
- `main` already on the next train's versions produces no commit;
- `create-milestone` checks `state=all` across all pages before creating;
- `projects.json` entries that already exist are skipped.

So the fix for a partial run is to re-run it, ideally with `projects` narrowed to the
list under **❌ Not set up** in the summary.

## Why the `ours` merge

Step 3 is the only commit this workflow makes on the new branch — the Dependabot
entries and the version bump both go to `main`. Release lines are then merged
**forward** into `main`, and at that merge the base is the branch point: the new
branch changed the trigger lines and `main` did not, so git takes the new branch's
side without a conflict. `main`'s own workflows end up triggering on `5.0.x`.

Step 3b prevents it: `git merge -s ours --no-ff` puts the retarget commit into
`main`'s history while leaving `main`'s tree byte-identical, so every later
`git merge 5.0.x` starts from there, finds nothing to re-apply, and brings the
line's real work across cleanly. The step verifies the tree really is unchanged
before it pushes.

## Failure modes

| Reported as | Meaning |
|---|---|
| `no-main-pom` | `pom.xml` could not be read on `main` — the repo may not exist, have no `main`, or not be a Maven project. |
| `no-pom-version` | The root `pom.xml` has no `<version>` outside its `<parent>` block. |
| `bad-pom-version` | `main`'s version is not `<major>.<minor>[.<patch>]`, so no branch name can be derived. |
| `same-line` | `main` and the next train are on the same minor line — there is nothing to branch off. Usually the wrong `release_train_version`. |
| `clone-failed` / branch `failed` | A token permission problem, or a protected-branch rule on `main`. |
| `failed` in **Merged to main** | The `ours` merge could not be pushed to `main`, most likely a ruleset requiring linear history there. `main` will pick up the retarget commit on the next merge forward unless it is fixed by hand. |

A leg that fails one step does not abort the others (`fail-fast: false`), and a
failing project does not stop the rest of the train.

The workflow warns, rather than refuses, when the next train's version for a project
is not a `.0` — the milestone would then be something like `5.0.5-M1`. Check the name
is what you meant.

## Token permissions

`GH_ACTIONS_REPO_TOKEN` needs, across every OSS project repository: `contents: write`
(create the branch, push to it and to `main`), `issues: write` (create milestones),
plus read access to `spring-cloud-release-commercial` for the releaser config, and
`contents: write` on `spring-cloud-github-actions` for `projects.json`.
[`check-token-permissions.yml`](README-check-token-permissions.md) probes most of
these.

## Example

```
release_train_version: 2026.1.0-SNAPSHOT
projects:              spring-cloud-config
dry_run:               true
```

Read the summary, confirm the diffs, then re-run with `dry_run` unchecked — first for
one project, then for the whole train.
