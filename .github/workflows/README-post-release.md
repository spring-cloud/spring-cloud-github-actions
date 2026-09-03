# Post Release Workflow

An on-demand workflow that performs the chores that follow a Spring Cloud release train: verifying every project was actually tagged, seeding the next snapshot config, opening the next round of milestones, merging release branches back from the commercial repo, bumping the maintenance branches to the new snapshot versions, pushing the release tags into the OSS repos, closing milestones, publishing GitHub releases, nudging Dependabot to drop PRs the release has superseded, opening the website PR that documents the released versions — with the announcement blog post too, on an OSS train — and bumping the Spring Cloud version on start.spring.io.

Previously all of this was done by hand, repo by repo, for up to 17 projects.

## Description

It:

1. **Reads the properties file** for `release_version` from the `jenkins-releaser-config` branch of `spring-cloud-release-commercial` — for OSS trains too, see [Where the releaser config lives](#where-the-releaser-config-lives) — validates the inputs, and builds a matrix of `{project, repo, ossRepo, commercialRepo, version, tag}`
2. **Verifies a `v<version>` tag exists** for every project, in the commercial repo — see [Where the release branch and the tag live](#where-the-release-branch-and-the-tag-live) — a hard gate, in a single job so an incomplete release produces one consolidated failure naming every missing tag
3. **Writes the next `<train>-snapshot.properties` file** to `jenkins-releaser-config`, with every version's last segment bumped and `-SNAPSHOT` appended — creating it, or **overwriting an existing one whose versions do not match**
4. **Opens a milestone** for each new snapshot version, via the [create-milestone](../actions/create-milestone/README.md) action
5. **Merges `release/<version>` back into the `.x` branch** from the commercial repo, applies the new snapshot versions with [update-project-versions](../actions/update-project-versions/README.md), pushes both commits together, and comments `@dependabot recreate` on superseded Dependabot PRs
6. **Closes the release milestone** and **publishes the GitHub release** for each tag — nothing is published for a project whose merge back did not land, see [Releases wait for the merge back](#releases-wait-for-the-merge-back); `skip_close_milestones` leaves the milestones open and still publishes the releases
7. **Opens a PR against the website content repository** — the blog post and the `documentation.json` version bumps on the OSS site, a new `documentation.json` entry per released project on the commercial one, see [The website PR](#the-website-pr)
8. **Opens a PR against [start.spring.io](https://github.com/spring-io/start.spring.io)** bumping the Spring Cloud version the Initializr offers — OSS only, see [The start.spring.io PR](#the-startspringio-pr)
9. **Rolls the release train's GitHub Project board** over to the next version — OSS only, see [The release board](#the-release-board)
10. **Writes a summary** covering every phase, with everything that was skipped or blocked called out explicitly

Step 5's version bump also exists on its own, as [update-versions](README-update-versions.md) — for when the projects have to move to a train's versions before, or independently of, a post-release run. The normal end-of-release path is still this workflow; running that one first is not required.

### Where the release branch and the tag live

**The release branch is always in the commercial repo, for OSS releases too.** An OSS release is built in `<project>-commercial`: [create-oss-release-branch](create-oss-release-branch.yml) pushes the OSS branch there as `<major>.<minor>.x-internal` (full history, deliberately not an orphan) and cuts `release/<version>` from it. The build and the staging happen on that branch, in that repository.

**The tag is not.** The release pushes it to whichever repo the release belongs to: a commercial release tags `<project>-commercial`, and an OSS release tags the OSS repo directly. **Nothing in this workflow copies a tag between repositories**, and step 2 looks in a different place for each flavour:

| Run | Step 2 looks in | `resolvedIn` |
|-----|-----------------|--------------|
| OSS | the OSS repo, and only there | `oss` |
| commercial | `<project>-commercial`, falling back to the OSS repo | `commercial`, or `oss-fallback` |

The commercial fallback means that project has had no commercial release since the last OSS one, so its properties entry carries the plain OSS version and there is nothing in the commercial repo to attach a release to.

### The tagged commit arrives before the branch it belongs on

For an OSS release the tag is in the OSS repo but **the commit it points at was built on the release branch in the commercial repo**, so it lands as unreachable history — real, fetchable by SHA, on no branch. `spring-cloud-build` `v5.0.3` is the worked example: the tag resolves to `7d5f99b` in `spring-cloud/spring-cloud-build`, that commit is the tip of `release/5.0.3` in `spring-cloud/spring-cloud-build-commercial`, and comparing it against `5.0.x` in the OSS repo returns a 404.

**Step 5's merge is what fixes that**, bringing the release branch onto the maintenance branch and making the tagged commit reachable. **That is why step 6 still waits on step 5**: release notes are generated from the tag, and generating them against a commit on no branch is not something to find out about afterwards.

#### Releases wait for the merge back

**A project whose merge back did not land gets no release**, reported as `merge-incomplete` and listed under **Releases held back**. Publishing anyway would attach notes generated from history that is on no branch, and announce a version the maintenance branch has not received.

"Landed" means the merge reached the remote, which takes both halves of step 5 — the merge *and* the push, since they go up together in one push:

| | `mergeStatus` | `pushStatus` |
|---|---|---|
| real run | `merged`, `already-merged`, `no-release-branch` | `pushed`, `nothing-to-push`, `would-push` |
| dry run | `merged`, `already-merged`, `no-release-branch` | *not checked* |

Anything else does not count, including a clean merge whose version bump failed — that leaves the merge in the runner's clone and nowhere else.

**A dry run is judged on the merge alone.** It merges in the runner's clone and pushes nothing, and the version bump is skipped too, because no snapshot file was committed for it to resolve versions from — so `pushStatus` is `skipped` for every project on every dry run and carries no information about what a real run would do. The merge status still does: a conflict, a failed clone or an unreadable release branch are real answers on a dry run, and still hold the release back.

Each held-back entry in the summary names **why**, not just the project. The merge back table can read as healthy while a release is held back — a clean merge whose push never happened, say — and two sections of the same report appearing to disagree is worse than either being terse.

A matrix leg cannot read another matrix leg's outputs, so step 6 gets step 5's verdict by downloading the `result-mergeback-*` artifacts it already uploads and finding the record for its own project. **No merge-back record at all means it goes ahead** — that is a hotfix run, where the merge back is skipped by design and the release is the whole point.

**Publishing is still gated on the tag existing in the target repo.** `POST /releases` with a `tag_name` that does not exist does not fail — it *creates* the tag, at the default branch head, silently stamping `v<version>` onto whatever `main` happened to be. Step 2 has already proved the tag is there, so the re-check in step 6 should never fire; it stays because the cost of being wrong is a bogus tag on a public repo and the cost of the check is one API call.

### Gate on existence, never classify

A project listed in the properties file may not have been released *in this train* — its version can be carried over from an earlier one. Rather than trying to detect that, **every mutating step is a no-op when its target already exists**, so the three cases resolve themselves:

| Case | Tag | Release | Milestone |
|------|-----|---------|-----------|
| Released in this train | pushed to its own repo by the release; the commit it names becomes reachable when step 5 merges | created | open → closed |
| Carried over from an earlier train | already in the primary repo | already exists → skipped | already closed → skipped |
| No commercial release since the last OSS one | OSS repo only | no tag here → skipped | absent → reported |

This is also what makes re-running the workflow safe, and what lets a `projects`-filtered repair run work after a partial failure.

## Triggers

- **`workflow_dispatch`** only. There is no schedule — this runs when a release train has shipped.

Each run is named for what it targets, so the Actions list distinguishes them at a glance:

```
Post Release - 2025.1.2
Post Release - 2024.0.8 (commercial)
Post Release - 2025.1.2.1 (commercial) - Dry Run
Post Release - 2025.1.2 [spring-cloud-config,spring-cloud-build] - Dry Run
```

`(commercial)` appears only when `projects` is empty. With a filter the `commercial` input is ignored — the type is derived from the project names — so printing it could contradict what the run actually did, and the `-commercial` suffix on the listed names already shows which line it is.

**Defaults to a dry run.** Set `dry_run` to `false` to actually close, create, commit and push.

**The workflow exits non-zero** if any project hit a merge conflict, could not be reached by git at all, had no usable branch to update, had its release held back because the merge back did not land, or could not be published because its tag never reached the repo, since those leave a project half-done. The count is of distinct repositories, not of findings — one merge conflict blocks the merge *and* holds back the release, and that is one thing to go and fix. Milestones that were not found, releases that already existed, and projects with no release branch are all reported without failing the run.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `release_version` | The release train version that just shipped, e.g. `2025.1.2`, `2026.0.0-M1` or `2026.0.0-RC1`, or `2025.1.2.1` for a commercial hotfix. Three or four numeric segments, optionally with an `-M<n>` or `-RC<n>` qualifier. | Yes | string |
| `promote_to` | Where the train goes next. `none` stays in the current phase (`M1` → `M2`, `RC1` → `RC2`); `RC` moves a milestone train to `RC1`; `GA` moves a release candidate train to its final version. Ignored for GA and hotfix releases, which always bump the last segment. See [Milestone and release candidate releases](#milestone-and-release-candidate-releases). | No | choice (default: `none`) |
| `commercial` | Was this a commercial release? **Ignored when `projects` is supplied.** | No | boolean (default: `false`) |
| `projects` | Comma-separated project names, `-commercial` suffix included where applicable. Empty processes every project in the properties file. See [The projects filter](#the-projects-filter). | No | string |
| `skip_close_milestones` | Leave the release milestones open. Nothing else changes — the releases are still published, the next round of milestones is still opened, and the merge back still runs. Use it when issues are still being moved between milestones, then re-run with it unchecked (closing a milestone is idempotent, and everything else is a no-op the second time). | No | boolean (default: `false`) |
| `skip_website_pr` | Skip the [website PR](#the-website-pr). It is already skipped for a run with `projects` set. | No | boolean (default: `false`) |
| `skip_start_site_pr` | Skip the [start.spring.io PR](#the-startspringio-pr). It is already skipped for a commercial run, a hotfix, and a run with `projects` set. | No | boolean (default: `false`) |
| `skip_release_board` | Skip [rolling the release board](#the-release-board) over to the next train. Same exclusions. | No | boolean (default: `false`) |
| `dry_run` | When checked, nothing is created, committed or pushed — but the summary shows what would happen. | No | boolean (default: `true`) |
| `token` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GH_ACTIONS_REPO_TOKEN` | Used whenever the `token` input is empty. Needs the **`project` scope** for the release board, write access to every target repository (contents, issues for milestones, and releases), plus write access to `spring-cloud-release-commercial` — required on **every** run, OSS included, since the releaser config lives there — and, for the website PR, push and pull-request access to `spring-io/spring-website-content` on an OSS run or `spring-io/spring-website-commercial-content` on a commercial one, plus `spring-io/start.spring.io` on an OSS run. | Yes, unless `token` is passed |
| `SPRING_CLOUD_CORE_POST_RELEASE_GCHAT_WEBHOOK` | Incoming webhook URL for the Google Chat space to notify when the run finishes. If unset, the step logs that it is skipping and the run still succeeds. Never used on a dry run. | No |

Cross-repo writes rely entirely on this token — the workflow's own `permissions:` block is `contents: read`.

## The projects filter

Scopes the run to a subset, for repairing a project a full run missed or handling one that landed late. **The properties file is still the source of every version**; `projects` only narrows which entries are acted on.

```
projects: spring-cloud-config,spring-cloud-build
projects: spring-cloud-config-commercial,spring-cloud-gateway-commercial
```

- **Commerciality is derived from the names**, not from the `commercial` input — `spring-cloud-config-commercial` is commercial, `spring-cloud-build` is OSS. When `projects` is supplied, `commercial` is ignored and the run logs that it was.
- **The list must be all commercial or all OSS.** A mixed list fails the workflow before any repository is touched:
  ```
  ERROR: projects mixes commercial and OSS projects.
    commercial: spring-cloud-config-commercial
    oss:        spring-cloud-build, spring-cloud-gateway
  A run targets one release train, so every project must be the same type.
  ```
  This is a correctness requirement rather than a convenience check: the derived type selects *which properties file is read*, and one `release_version` cannot name both the OSS train (`2025.1.2`) and the commercial one (`2025.1.2.1`). A mixed list would silently read the wrong file and resolve every project to a wrong version.
- The properties-file key is the name with `-commercial` stripped — keys are always bare (`releaser.fixed-versions[spring-cloud-config]`) even in the commercial file.
- A listed project that is not in the properties file fails the run, naming it and listing the known projects, rather than silently doing nothing.
- Empty entries are dropped, so a trailing comma (`spring-cloud-config,`) is accepted — matching how [ci-status-report](README-ci-status-report.md) and [rollout-deploy-docs](README-rollout-deploy-docs.md) parse the same input.

**The filter does not apply to step 3.** The snapshot properties file is train-wide and stays complete: `update-project-versions` needs the *whole* versions map to update each project's dependency versions, so a file containing only the filtered projects would produce wrong POMs. Step 3 always writes every entry; only the repo-facing steps are filtered.

## Where the releaser config lives

**Always `spring-cloud/spring-cloud-release-commercial`, on the `jenkins-releaser-config` branch — including for OSS trains.** That repository holds the releaser config for every train, so the location is deliberately *not* derived from the `commercial` input.

`commercial` still decides everything else: which project repositories are acted on (`<project>` vs `<project>-commercial`), whether release notes are sanitized, the OSS tag fallback, and whether a missing `.x` branch falls back to `main`.

This also applies to the version bump in step 5c. [update-project-versions](../actions/update-project-versions/README.md) picks its config source from its own `commercial` input, and that input does nothing else in the action — so the workflow passes a hardcoded `true`. Passing the run's actual flavour would send an OSS run to `spring-cloud-release`, where the file no longer is.

`spring-cloud/spring-cloud-release` may still contain older copies of the same filenames, and they can disagree. When this changed, `2025_1_3.properties` existed in both, with four projects differing:

| Project | `spring-cloud-release` | `spring-cloud-release-commercial` |
|---|---|---|
| `spring-cloud-netflix` | 5.0.3 | 5.0.2 |
| `spring-cloud-task` | 5.0.3 | 5.0.2 |
| `spring-cloud-vault` | 5.0.3 | 5.0.2 |
| `spring-cloud-zookeeper` | 5.0.3 | 5.0.2 |

Only the commercial repository's values are correct — `v5.0.2` is tagged in each of those four OSS repos and `v5.0.3` does not exist, so a run against the old location would have failed the tag gate on all four.

## The next snapshot properties file

The correct contents are **always computed from the release properties file**, and the target is written whether or not it already exists. An existing snapshot file may have been seeded by hand, or by an earlier run against a different release, so trusting it would leave every downstream project bumped to the wrong versions.

| Situation | Status | What happens |
|---|---|---|
| Target absent | `created` | Written as a new file |
| Target exists, versions differ | `updated` | Overwritten with the computed versions |
| Target exists, already byte-identical | `unchanged` | Nothing committed — avoids an empty commit |

An update sends the existing blob `sha` with the `PUT`. That is what makes the Contents API replace rather than create, and it also makes the write fail rather than clobber if someone else changed the file between the read and the write.

Only the file for *this* run's next version is touched. Other `-snapshot.properties` files on the branch — older trains, other lines — are left alone.

### Not to be confused with `-internal-snapshot.properties`

The same branch also holds files like `2025_1_3-internal-snapshot.properties`, whose versions carry an `-INTERNAL-SNAPSHOT` suffix. **This workflow neither reads nor writes those.** They belong to [create-oss-release-branch](create-oss-release-branch.yml), which uses them to rewrite a new release branch's versions from `-SNAPSHOT` to `-INTERNAL-SNAPSHOT`, and looks them up by the train version being started (`2026.1.0` → `2026_1_0-internal-snapshot.properties`) rather than by a patch-bumped next version.

So the two conventions coexist without overlapping:

| File | Written by | Purpose |
|---|---|---|
| `<next>-snapshot.properties` | this workflow, step 3 | next patch versions, `-SNAPSHOT` |
| `<train>-internal-snapshot.properties` | maintained separately | `-INTERNAL-SNAPSHOT` stamps for a new OSS release branch |

Note this differs from [ci-status-report](README-ci-status-report.md) and [rollout-deploy-docs](README-rollout-deploy-docs.md), which pair bare project names with a separate `repo_type` input. Here the suffix carries the type, so there is no `repo_type`.

## Milestone and release candidate releases

A train ships `2026.0.0-M1`, then `-M2`, then `-RC1`, and only finally `2026.0.0`. This
workflow runs after every one of them, but a pre-release is not a small GA release — one
thing is fundamentally different, and most of the special-casing follows from it:

> **The train does not advance during a pre-release cycle.** `5.1.x` stays on
> `5.1.0-SNAPSHOT` from M1 all the way to GA.

So on a pre-release run:

| Step | GA release | Milestone / RC release |
|------|-----------|------------------------|
| Verify tags | runs | runs |
| Next snapshot properties file | written | **skipped** — the train has not moved, so there is no new file |
| New milestones | `5.1.1` | `5.1.0-M2` |
| Merge back | runs | **runs** |
| Version bump on the maintenance branch | pushed | **skipped** — the branch is already on the right snapshot |
| Close milestone, publish release | runs | runs, flagged `prerelease` and **not** marked *Latest* |
| Website PR | runs | runs, with milestone wording and a `PRERELEASE` entry — see below |
| start.spring.io PR | runs | runs, if the bom declares a milestone repository |
| Release board | rolls over | rolls over |

### Naming the next release

`M1` → `M2` and `RC1` → `RC2` are arithmetic, so they are derived. Moving from milestones
to release candidates, and from release candidates to GA, is a decision somebody makes —
that is what `promote_to` is for:

| `release_version` | `promote_to` | Next |
|-------------------|--------------|------|
| `2026.0.0-M1` | `none` | `2026.0.0-M2` |
| `2026.0.0-M2` | `RC` | `2026.0.0-RC1` |
| `2026.0.0-RC1` | `none` | `2026.0.0-RC2` |
| `2026.0.0-RC2` | `GA` | `2026.0.0` |
| `2025.1.2` | ignored | `2025.1.3` |

A transition that cannot be meant fails the run rather than producing a version that would
go on to name milestones and project boards: a milestone cannot be promoted straight to GA
(set `promote_to=RC` first), and a release candidate cannot be promoted to a release
candidate. The rules live in
[`.github/scripts/prerelease-rank.js`](../scripts/prerelease-rank.js), shared with the
Dependabot triage that resolves milestones and boards by the same grammar.

### Where the GA release picks the train back up

The GA run is an ordinary run: `next_snapshot_config` writes
`2026_0_1-snapshot.properties`, the maintenance branch is bumped to `2026.0.1-SNAPSHOT`,
and the site entry that has been carrying the pre-releases is promoted in place to
`GENERAL_AVAILABILITY`. Note that `promote_to=GA` on the **RC2** run only names the *next*
release; it is the run with `release_version: 2026.0.0` that actually moves the train on.

### One `documentation.json` entry per line, promoted in place

The site carries exactly one entry for a line while it is in pre-release, rewritten at each
step rather than accumulating:

| Release | The `5.1` entry afterwards |
|---------|----------------------------|
| `5.1.0-M1` | created — `PRERELEASE`, `5.1.0-M1`, `ref: .../reference/5.1/` |
| `5.1.0-M2` | rewritten — `PRERELEASE`, `5.1.0-M2` |
| `5.1.0-RC1` | rewritten — `PRERELEASE`, `5.1.0-RC1` |
| `5.1.0` | rewritten — `GENERAL_AVAILABILITY`, `5.1.0`, and `current` moves onto it |

The first one is cloned from **the same line's `SNAPSHOT` entry**, not from the previous
line's GA entry. On this site a pre-release entry's `ref` is keyed to the line rather than
the version — compare spring-data-jpa:

```
PRERELEASE  4.2.0-M1        ref .../reference/4.2/
SNAPSHOT    4.2.0-SNAPSHOT  ref .../reference/4.2-SNAPSHOT/
```

so turning the snapshot entry into the pre-release entry is one substitution,
`<line>-SNAPSHOT` → `<line>`. Cloning the previous line's GA entry would leave the `ref` on
*that* line: substituting `5.0.5` → `5.1.0-M1` never touches a ref reading
`.../reference/5.0/`, and the new milestone would quietly point at the old line's docs.
That path still exists as a fallback for a line with no snapshot entry, and it substitutes
the line token as well as the version.

The `SNAPSHOT` entry itself is left alone during the pre-release cycle — `main` has not
moved — and `current` stays `false` until the GA release, which is the first time the line
is what the site should point people at.

### Releases are not marked Latest

A pre-release is published with `prerelease: true` and `make_latest: "false"`. Without the
second of those, GitHub promotes the newest release by date, so publishing `5.1.0-M1` would
put it above the current 5.0.x GA on every project page and in the API that downstream
tooling reads to find the current version.

### The version gate

`spring-release-train-project-ready` runs
[`verify-no-snapshot-versions`](../actions/verify-no-snapshot-versions/README.md) after
stamping the release versions. That action rejects `-M<n>` and `-RC<n>` by default, which
would fail every pre-release the moment it was stamped, so it is passed
`allow-prerelease` when the version being released is one. `-SNAPSHOT` is still rejected.

---

## Hotfix releases

A **4-segment `release_version`** (e.g. `2025.1.2.1`) is treated as a commercial hotfix and **runs only steps 1, 2, 6 and 7** — verify tags, close the milestone, create the release, document the versions on the commercial site. Steps 3, 4 and 5 are skipped: there is no next snapshot train for a hotfix, no new milestone, no version bump, no Dependabot pass, and **no merge-back, because a hotfix has no branch to merge back into** (the `release/<version>` branch is itself the hotfix line).

Step 7 does run, and has to: a hotfix is a commercial release like any other, and the commercial site documents every one of them — the `2025.0.2.1` and `2025.1.1.1` entries in `project/spring-cloud/documentation.json` are hotfixes. That is why the job is not gated on step 3, which a hotfix skips outright; nothing the commercial site needs comes from it.

Because the merge back is skipped for a hotfix, step 6 cannot simply `needs:` it — a skipped dependency would skip the release step too, and closing the milestone and publishing the release is the whole of a hotfix run. It is gated on `!cancelled()` instead. A hotfix is always commercial, so its tag is already in the repo being published to and needs no push.

Commercial trains come in both shapes — `2024_0_8.properties` is a 3-part commercial release whose projects carry 3-part versions and which runs the full sequence, while `2025_1_2_1.properties` is the 4-part hotfix. So the mode is decided by the version's shape, not by the `commercial` input.

## Release notes

Release bodies come from GitHub's own generator (`POST /repos/{repo}/releases/generate-notes`), which is PR-based and honors a project's `.github/release.yml`, then:

- **OSS projects: used verbatim**, reproducing what the existing releases look like — `## :heart: Contributors`, `## What's Changed` with one line per merged PR, `## New Contributors`, and a `**Full Changelog**` compare link.
- **Commercial projects: sanitized.** The contributor sections, the `**Full Changelog**` line, and the ` by @<user> in <url>` suffix on each bullet are stripped, because those PR links point into a private repository and are useless to most readers. This reproduces the existing commercial release bodies.
- **`spring-cloud-release`: gains a `## What's Included` section** listing every project version in the BOM, built from the same properties file. On an OSS train each line links to that project's release; on a commercial one it does not — see [Links in `What's Included`](#links-in-whats-included).

Release **titles** are deliberately not normalized: OSS projects use the bare version (`5.0.4`) while `spring-cloud-release` and every commercial repo use a `v` prefix (`v2025.1.2`, `v4.2.8`), matching what already exists in each.

### When there are no notes to generate

`generate-notes` is **PR-based**: it lists merged pull requests between the previous tag and this one. When it finds none, it returns nothing but a `**Full Changelog**` link — which sanitization strips, leaving an empty body. The release body then becomes a placeholder:

```
Released from tag v3.2.17.
```

**The changes for these releases have to be written up by hand.** There is nothing for the workflow to recover: the information simply is not in the PR history.

Two distinct situations produce it, and both occur in practice:

- **No merged PRs in the range.** The changes landed as direct commits rather than through pull requests. `generate-notes` finds the predecessor perfectly well — for `spring-cloud-function-commercial` v3.2.17 it returned `compare/v3.2.16...v3.2.17` — but there are no PRs in it to list. This is the common case, and it is unrelated to how old the line is.
- **No predecessor tag at all.** Commercial branches are created as **orphan branches** with no history shared between lines, so the first tag on a new line has nothing to diff against — `compare v4.2.8...v5.0.4.1` returns `404 No common ancestor`. Here `generate-notes` emits `commits/<tag>` rather than a `compare/` link.

The check runs *after* `What's Included` is prepended, so the release train's own release keeps its version list rather than being replaced by the placeholder.

Neither situation is something a later run fixes, and a line having many tags is no guarantee against it — `spring-cloud-gateway-commercial` v3.1.14 got a placeholder despite v3.1.11 through v3.1.13 existing. Where a project does merge its work through PRs, notes generate normally: `v4.2.9`, 42 commits after `v4.2.8` on the same line, produced a full `What's Changed` list of 8 entries.

### Links in `What's Included`

Two details, both there to avoid shipping links that do not work for whoever is reading:

- **It omits `spring-cloud-release` itself.** The hand-written body for v2025.1.2 has a `Spring Cloud Starter Build` line pointing at `spring-cloud/spring-cloud-starter-build`, but that repository does not exist — the link 404s. The other 16 lines match the hand-written body exactly.
- **A commercial train gets no issue links at all**, just the module and its version:

  ```
   - Spring Cloud Config `4.3.5`
   - Spring Cloud Bus `4.3.3`
  ```

  An issue link on a commercial release would point into the private `<project>-commercial` repositories, and the people reading commercial release notes are exactly the ones without access to those. A row of links that 404 for its audience is worse than no links, and the module and version — the part anyone actually needs — are still there. This also removes one tag-existence API call per module from every commercial run, since nothing has to work out which repository a link should point at any more.

## Branch resolution

For each project, the branch to merge into and bump is derived by **dropping the last segment of the new snapshot version and appending `.x`** — `5.0.3-SNAPSHOT` → `5.0.x`, and for a 3-part commercial train `4.2.8-SNAPSHOT` → `4.2.x`.

If that branch does not exist:

- **OSS** → falls back to `main`, but only after confirming the root `pom.xml` version (or its `<parent>` version) is on the same `major.minor` line. Otherwise the project is skipped and reported, rather than bumping an unrelated line to these versions.
- **Commercial** → **fails and is reported.** Commercial repositories have no `main` branch at all — `spring-cloud-config-commercial`'s default branch is `4.3.x` — so there is no sane fallback.

## Merge back

The commit each tag points at lives on a `release/<version>` branch, which has to come back to the `.x` branch before anything else touches it.

- **No `release/<version>` branch** → nothing to merge; the run continues to the version bump. Expected for carried-over versions, OSS-fallback entries, and branches already merged and deleted.
- **Already merged** → reported as such, no commit. The merge check is `git merge-base --is-ancestor`, so this is naturally idempotent.
- **Conflict** → the merge is aborted, and **the version bump, the push and the Dependabot pass are all skipped for that project**. Other projects continue. The summary flags it under **Blocked on a manual merge** and the run exits non-zero. Resolve it by hand, then re-run with `projects` set to just the affected projects. **The GitHub release is held back too**, since the tagged commit stays unreachable until the merge lands — see [Releases wait for the merge back](#releases-wait-for-the-merge-back).
- **Git could not reach the repository** → `clone-failed` or `branch-fetch-failed`, reported under **Could not reach the repository**, counted as a problem, and nothing else is done for that project. See below.

### Remote reads are retried, and always end in a status

Every remote read in this step — the clone, the `ls-remote` for the release branch, and the fetch of it — is **retried three times** with a 10s and then 20s wait. Sixteen legs clone a private repo apiece, at once, every run, and github.com fails often enough at that rate that a single HTTP 401 or 5xx during ref advertisement is a blip rather than an answer.

If all three attempts fail, the step **records a status and exits 0** rather than dying. That distinction matters more than it looks: GitHub runs `run:` steps under `bash -e` whatever the script sets, so an unguarded `git` failure aborts the step — and a step that aborts records no status at all, which the summary can only render as `⏭️ skipped`. A project that was never touched would then read exactly like one that needed nothing doing, in a table where `skipped` is otherwise the normal, healthy state.

The `ls-remote` is checked the same way for a related reason. `--exit-code` exits **2** when the remote answered and has no such branch — a real answer, and the common one — while any other non-zero is a transport failure. Treating the two alike would skip the merge for a project whose release branch was there all along, bump it anyway, and call the run a success.

**`already-merged` alongside `would-push` is not a contradiction.** The Merge column answers "did `release/<version>` need merging into `.x`", and the Push column answers "is there anything to push at all" — and the version bump is a commit in its own right. Most runs show exactly that pair, because the merge has usually happened already while the snapshot bump has not. `nothing-to-push` means the branch was already at the new versions too. The summary says so under the table.

The merge commit and the version-bump commit go up in a **single push**: one CI run per project, and if anything fails in between, nothing is pushed and the branch is left untouched so the whole project can simply be re-run. The `release/<version>` branch is left in place, not deleted.

### CI and PR workflow files are preserved across the merge

When a release branch is created, [spring-release-train-project-ready](../actions/spring-release-train-project-ready/README.md) **deletes** `ci.yml`, `ci.yaml`, `pr.yml`, `pr.yaml` (and `ci-release.yml`, `release-ci-settings.xml`) from it, so the release branch does not run normal CI. Merging that branch back would carry the deletion onto the maintenance branch and leave it with no CI at all.

This is not hypothetical — `spring-cloud-config-commercial`'s `4.3.x` has `ci.yml` and `pr.yml` today, and `release/4.3.5` has neither.

So, around the merge:

1. **Before merging**, the `.x` branch's copies of `ci.yml`, `ci.yaml`, `pr.yml` and `pr.yaml` are saved outside the clone. A file that is not on the branch is logged and skipped.
2. **After a clean merge**, any of those files the merge *removed* is restored and committed as a separate commit — `Restoring ci.yml pr.yml removed by the release/4.3.5 merge` — so the log shows plainly that they came back and why.
3. A file the release branch **modified** rather than deleted is left alone; that is a real change worth keeping.

The summary's merge-back table has a **CI files restored** column, and notes how many projects needed a restore.

Only `ci` and `pr` are handled. `ci-release.yml` and `release-ci-settings.xml` are also deleted from release branches but are **not** restored — they are release-branch scaffolding rather than something the maintenance branch needs.

If the merge conflicts on one of these files — because the release branch deleted it and the `.x` branch has since modified it, which git cannot resolve on its own — the project is blocked like any other conflict. The summary lists the conflicting paths and calls this case out specifically, since the resolution is almost always "keep the `.x` branch's version".

The version-bump commit message deliberately **omits `[skip actions]`**, unlike most workflows in this repo — the point of pushing new snapshot versions is to start CI on them.

## Dependabot

There is no public API to trigger a Dependabot run, so the workflow uses the supported comment command. For each project it lists open PRs authored by `app/dependabot` against the branch it just pushed, keeps the ones whose title mentions **both** a project name and a version from this release, and comments `@dependabot recreate`. Dependabot re-evaluates and closes any PR whose bump the push already satisfied. Matching on both name and version means unrelated bumps are left alone.

This only runs for projects that were actually pushed to.

## The website PR

One PR, on a branch named `spring-cloud-<version>`, against whichever content repository this run's flavour belongs to:

| Run | Repository | Contents |
|-----|------------|----------|
| OSS | [spring-io/spring-website-content](https://github.com/spring-io/spring-website-content) | the [blog post](#the-blog-post-oss-only), and [`documentation.json` bumped in place](#documentationjson-on-the-oss-site) |
| commercial | [spring-io/spring-website-commercial-content](https://github.com/spring-io/spring-website-commercial-content) | [one new `documentation.json` entry](#documentationjson-on-the-commercial-site) per released project |

**The two sites record their versions in ways that have nothing in common beyond the file name**, so the two halves share only the plumbing — clone, branch, commit, PR. The OSS site lists the versions currently being documented and is edited in place; the commercial site is an archive in which every release ever made keeps its own entry, so a release appends to it.

**It is skipped** when `projects` is set and when `skip_website_pr` is checked. This is a train-wide statement about a release, so a partial one would be wrong rather than merely incomplete.

It runs **after** the releases are published, because every row of the blog post's module table links to a release page this workflow creates.

### The blog post (OSS only)

Commercial releases are not announced on the commercial site — it has no blog — so a commercial run's PR is the documentation entries and nothing else.

Written to `blog/<year>/<month>/spring-cloud-<version-dashed>-has-been-released.md`, following the hand-written posts exactly — the boilerplate, the Maven and Gradle snippets, and the module table are reproduced byte for byte with the version substituted.

Everything derivable is filled in:

| Part | Where it comes from |
|------|---------------------|
| Version, Maven Central link, release notes wiki link | `release_version` |
| `This release is based on Spring Boot X` | the `spring-boot` entry in the properties file |
| The module table, and one `###` heading per project | the projects whose version changed in this release, see below |
| `publishedAt` | the date the workflow runs |

The rest **cannot** be derived and is left as a placeholder for the team to write in the PR. **The PR body lists every one of them as a checklist**, in the order they appear in the file:

- **`author`** — written as `TODO`. It is whoever writes the post up, which is not necessarily whoever ran the release.
- **`publishedAt`** — the date the workflow ran, so it needs changing if the post goes out on another day.
- **The train codename.** The title reads `Spring Cloud 2025.0.4 (aka CODENAME) Has Been Released` — "Northfields", "Oakwood" and the rest are recorded nowhere this workflow reads. The file name deliberately leaves the codename out rather than carrying the placeholder into a published URL, so renaming the file to `...-aka-<codename>-has-been-released.md` is on the checklist too.
- **The Spring Boot line**, which only ever says which version the train is based on. The recent posts say more than that.
- **Notable changes.** Each project that shipped gets a `### Spring Cloud X` heading with `TODO` under it. Delete the ones with nothing worth calling out.

When a post for this version already exists the checklist is left out entirely, and the PR body says the PR carries nothing but the documentation versions.

A post for this version anywhere under `blog/` means one already exists — a re-run after the first PR merged, or an announcement written by hand — and it is never overwritten. The documentation updates still go ahead.

### Which projects the blog post lists

The `###` headings and the module table cover the projects whose version **changed in this release**, matching the hand-written posts, which do not list a project that was carried over untouched.

That comparison is against the most recent earlier properties file on the same train line — whatever it happens to be, not necessarily the direct predecessor, since those are routinely missing (there is no `2025_0_3.properties`) and a hotfix file such as `2025_0_2_1.properties` describes the state of the train just as well. **With no earlier file at all, every project is listed** and the summary says so: an over-long list is edited down in the PR, whereas a project silently dropped from the announcement is not noticed.

`spring-cloud-release` is listed in the table as **Spring Cloud Starter Build**, as it always has been, but linked to its own release rather than to `spring-cloud-starter-build`, which does not exist. It gets no `###` heading — it is the BOM.

In both cases `spring-cloud-release` maps to `project/spring-cloud/`, and `spring-cloud-build` has no page on either site and is skipped.

### `documentation.json` on the OSS site

Applied to **every** project in the train, not just the ones that changed. Each `project/<name>/documentation.json` holds one `GENERAL_AVAILABILITY` and one `SNAPSHOT` entry per `major.minor` line, so the released version's line picks out exactly two entries:

- the GA entry becomes the released version — `4.3.5` → `4.3.6`
- the SNAPSHOT entry becomes the new snapshot version from step 3 — `4.3.6-SNAPSHOT` → `4.3.7-SNAPSHOT`

A project whose version did not change simply produces no diff, so there is nothing to filter.

These files are **edited as text, not parsed and reserialized** — they are not formatted alike across projects (some write `"version" : x`, others `"version": x`), so reserializing one would bury two version bumps under a whole-file reindentation. A version that appears more than once in a file is reported as `ambiguous` and left for a human rather than half-edited.

### `documentation.json` on the commercial site

Nothing is edited. Every commercial release keeps its own `GENERAL_AVAILABILITY` entry — there are no `SNAPSHOT` entries and no `current` flag — so a release **appends one entry per project**:

```json
  {
    "version": "5.0.2.1",
    "api": "",
    "ref": "https://docs.enterprise.spring.io/spring-cloud-config/reference/",
    "githubTag": "v5.0.2.1",
    "status": "GENERAL_AVAILABILITY"
  }
```

**Only projects with a tag of their own in the commercial repo** get one. On a commercial train some properties entries carry the plain OSS version because that project has had no commercial release since the last OSS one — step 2 marks those `oss-fallback` — and there is no commercial documentation of them to add. A version that is **already listed is left exactly as it is**, which is what makes a re-run, or a version carried over from an earlier train, a no-op without any comparison against a previous properties file.

The new entry is **cloned from an existing entry**, as raw text with the version substituted everywhere it appears, rather than assembled from fields. There is no single shape to assemble:

- field order differs between files — `spring-cloud-gateway` writes `version` first, `spring-cloud-task` writes `api` first
- `githubTag` carries a `v` prefix in most files, but not all of `spring-cloud-gateway`'s
- `ref` comes in two shapes, and which one is right is decided by the docs layout, not the project:

  | Shape | Example | Means |
  |---|---|---|
  | versioned | `.../spring-cloud-config/docs/4.0.11/reference/html/index.html` | the pre-Antora layout, where every version was published under its own path |
  | version-free | `.../spring-cloud-config/reference/` | Antora, which does not put the version in the URL |

Cloning an existing entry inherits all of that for free. Which entry, in order:

1. **The newest entry on the same `major.minor` line.** Same line, same docs layout, so whichever shape its `ref` has is the right one — and if it is versioned, substituting this version into the path is correct.
2. **The newest entry with a version-free `ref`**, when the line has no entry yet. A new line means a new release, a new release means Antora, and Antora means the `ref` must not carry a version — so an Antora entry is the template even when a pre-Antora one is newer. This is the ordinary case for the first commercial release of a line and needs no review: the `ref` it copies has no version in it, so it is correct exactly as it stands.
3. **The newest entry of any kind**, when the file has nothing but pre-Antora entries. The substituted `ref` then points at a versioned path that the Antora layout does not serve, so this is the one case that **is** flagged, in both the PR body and the summary. Every project in a current train already has an Antora entry, so it should only come up for a project being documented with Antora for the first time — or a long-retired one, which is why `spring-cloud-cloudfoundry`, `spring-cloud-dataflow` and `spring-cloud-sleuth` are the only three files it would apply to today.

The PR body's table names the entry each one was cloned from either way, so the provenance is always visible without a warning attached to it.

It is **spliced in at line level**, next to the newest entry on its line, on whichever side keeps that group's own ordering: the groups are contiguous but not consistently sorted (the `4.1` group in `spring-cloud-config` runs `4.1.10`, `4.1.9`, `4.1.8`), and following the local direction keeps the change to one added block sitting with its siblings instead of a reordering of the file. A line with no entries yet goes at the end. Every file in that repository is laid out identically — one entry per `  {` … `  }` block, one field per line — which is what makes that safe; a file that is not is reported as `unrecognised-format` and left alone. After the splice the result is re-parsed and checked to be the same JSON plus exactly one entry before it is written.

### Re-runs

**If the branch already exists in the website repo, the job does nothing** beyond reporting it and linking the PR. Almost certainly it is there from an earlier run of this workflow, and on an OSS run the notable-changes sections written into that PR since are the one part of it nobody can regenerate — force-pushing over them is not a trade worth making. Delete the branch to have it rebuilt.

### Seeing the changes

**The diff is written to the Website PR job's own summary**, one collapsed `<details>` block per file with its `+`/`−` counts, so a dry run can be read on the run page without downloading anything. It is written on every run, not just dry ones — on a real run the PR shows the same thing, but the summary is there before you go looking for it.

Blocks are fenced with more backticks than they contain, because the blog post is itself full of ``` fences. GitHub rejects a step summary over 1 MiB outright — losing the whole report rather than the tail of it — so files are added until 900 KB and anything left out is named as a count, pointing at the artifact. A sixteen-project OSS run comes to about 18 KB, so that only matters if something has gone very strange.

The complete diff is also uploaded as the `website-changes` artifact, and on a dry run the PR body is printed to the log.

## The start.spring.io PR

A one-line PR against [spring-io/start.spring.io](https://github.com/spring-io/start.spring.io), on a branch named `<version>-release`, titled `Upgrade to Spring Cloud <version>` — the shape of [PR #2139](https://github.com/spring-io/start.spring.io/pull/2139).

**OSS only.** start.spring.io serves the public Initializr, so a commercial version has no place in it. Also skipped for a hotfix, when `projects` is set, and when `skip_start_site_pr` is checked.

The version lives in `start-site/src/main/resources/application.yml`, in one mapping under the `spring-cloud` bom. Each mapping pins a Spring Cloud version to a range of Spring Boot versions:

```yaml
      spring-cloud:
        groupId: org.springframework.cloud
        artifactId: spring-cloud-dependencies
        versionProperty: spring-cloud.version
        order: 50
        mappings:
          - compatibilityRange: "[4.0.0,4.2.0-M1)"
            version: 2025.1.2
```

The mapping already on the released train's `major.minor` line is bumped, and nothing else — the `compatibilityRange` is untouched.

**Scoped to that bom by reading the file, not by pattern.** Half a dozen boms in that file are called `spring-cloud`-something — `spring-cloud-azure`, `spring-cloud-gcp`, `spring-cloud-services`, `solace-spring-cloud` — and each has `version:` lines of its own. The block is found by its unique `artifactId: spring-cloud-dependencies` line, then bounded by indentation: its key is the nearest line above indented less than it, and the block runs to the next line indented no further than that key. Only `version:` lines inside those bounds are considered, so a reindentation upstream cannot silently retarget this at a neighbour.

### When the line has no mapping

**No PR is opened, and the run says so.** A new mapping needs a `compatibilityRange` declaring which Spring Boot versions the train supports, and that is a judgement nothing here can make.

This is not hypothetical: as of writing, the only mapping is `[4.0.0,4.2.0-M1) → 2025.1.2`, so a `2025.1.x` release bumps it and **a `2025.0.x` release has nothing to bump** — Boot 3.5 has aged off the site. It happens the other way round too, for the first release of a brand-new train line.

The summary gets its own **start.spring.io PR** section spelling out the reason and listing what is currently mapped, and the Google Chat message carries a `Needs attention` bullet and a ⚠️ header.

**It does not fail the run.** Nothing is half-done — the workflow made the right decision and reported it — and a train line that has legitimately aged off the site would otherwise turn every one of its releases red. Everything that *does* fail the run still does.

### Other outcomes

| Status | Meaning |
|--------|---------|
| `created` / `would-create` | the mapping was bumped; the diff is in the job's own summary |
| `already-current` | the mapping already names this version — a re-run, or a hand-made PR that already landed |
| `branch-exists` | `<version>-release` is already in the repo; it is left alone and the existing PR is linked |
| `no-mapping` | ⚠️ nothing to bump, see above |
| `file-not-found` / `bom-not-found` | ❌ `application.yml` moved, or the `spring-cloud` bom is no longer identifiable in it |

## The release board

Rolls the org-level GitHub Project from the train just released to the next one: `2025.1.3` → `2025.1.4`. **OSS only** — the boards are OSS by design, the same assumption [dependabot-scan](README-dependabot-report.md) makes — and never on a filtered run, since a board covers the whole train.

Boards are found **by title**, which is how everything else here resolves them: a board is titled with its train version, and both versions are already computed by steps 1 and 3.

It runs **after step 4**, because carrying an item over re-milestones it and the milestone it moves to is the one step 4 opens.

### 1. The new board

`copyProjectV2` rather than a fresh project. GitHub's copy carries over "the same views, custom fields, draft issues and associated field values, configured workflows (except any auto-add workflows), and insights" — which is the whole of "modelled after the old one". It explicitly does **not** carry "the original project's items, collaborators, or team and repository links", so the rest is done by hand:

- **Public** — set with `updateProjectV2(public: true)`, since a copy is not.
- **Access** — see below.
- **Auto-add workflows are not copied.** If the old board had one, it needs recreating.

If a board titled with the next version already exists — a re-run, or one made by hand — it is used as-is rather than duplicated.

That check is by **exact title**, deliberately: a train ships `2026.0.0-M1`, then `-M2`, then `-RC1`, then GA, and each of those is its own board, so a board for one is not a board for the next. (Matching a train to a board it merely *belongs* to is a different question, and the [triage](README-dependabot-triage.md) side answers it with `.github/scripts/prerelease-rank.js`.)

Two things guard the check itself, because the only way this job can produce a second board is by creating one while it cannot see the first:

- **A listing that did not finish is fatal.** The org is past its hundredth project, so the boards are paged. If the page cap is reached with more still to come, the job stops with `board-listing-incomplete` and creates nothing — a partial listing cannot tell "no board with this title" from "did not get that far".
- **The listing is repeated immediately before the copy.** Minutes of teams, fields and items work sit between the first listing and the mutation — long enough for a concurrent run to have made the board. If it appeared in the meantime the job stops with `board-created-elsewhere`; re-run to fill it.

### Access, and what the API cannot tell us

**`ProjectV2Collaborator` exists in the GraphQL schema only as a mutation input.** Nothing in the API returns a board's collaborators, so the old board's permissions cannot be read back. What *is* readable is `ProjectV2.teams`, the teams a board is linked to — but not what role any of them holds.

So access on the new board is assembled from two sources:

| | Role |
|---|---|
| `spring-cloud-core-developers` | `ADMIN` — always, whatever the old board had |
| `spring-cloud-core` | `WRITER` — always |
| any other team linked to the old board | `WRITER`, because its real role is not knowable |

Every team granted access is listed in the summary with the role it got and why, so an inherited team that should have had something other than `WRITER` is visible rather than silent. **Individual user collaborators are not recoverable at all** and are not reproduced.

### 2. Carrying the work over

Items whose Status is **Todo** or **In Progress** move to the new board. Everything else — `Done`, and whatever else a board has grown — stays on the board being closed.

There is no "change an item's project" operation: in Projects v2 an issue or PR can sit on many boards at once, so board membership is not a field to overwrite. Adding to the new board and removing from the old *is* what the Projects picker on an issue does, and it is two calls. **They are made in that order deliberately** — if the removal fails the item is on both boards, which is visible and fixable, whereas the other order can leave it on neither.

The Status field is found **by shape, not by name**: the single-select field whose options include the columns being carried over. A board whose field is called something else still works, and one whose options have been renamed is reported rather than half-moved. Option IDs are per-board, so the column is matched across by name.

**Draft issues cannot be moved** — they belong to a board, not a repository, so there is no content ID to add. These boards do not use them; if any turn up in a carried-over column they are reported and the old board is left open.

### 3. Milestones

Each carried-over item is re-milestoned to its repository's new milestone — the version step 3 wrote to the snapshot file, which is what step 4 opened a milestone for. Following [what triage already does](README-dependabot-triage.md), **a milestone somebody chose deliberately is never overwritten**:

| Current milestone | Action |
|---|---|
| none | set to the new one |
| the train just released (e.g. `5.0.3`) | set to the new one |
| anything else | left alone, and reported |
| — (repo not in this train) | left alone |

A repo with no such milestone — it was not part of the last release, so step 4 opened nothing — is reported and the item keeps what it had.

**Everything left alone is listed in the summary, not just counted**, under **Milestones left alone — worth a look**. Declining to touch a milestone is the right call and also the one outcome here nobody discovers on their own: the item moves to the new board and quietly keeps a milestone from an old train, with nothing failing and nothing to notice. Each entry names the milestone it kept, what this train would have wanted, and the item's title.

**A closed milestone is flagged with a ⚠️.** The board query already carries each milestone's state back, so the list can distinguish the two cases the rule cannot: an item pinned to a *closed* milestone from an earlier train is drift, while one pointing at a *future* release is somebody's decision. The `2025.1.3` run had exactly one of the former — an issue still on a `5.0.2` milestone closed months earlier — and it went unnoticed precisely because it was counted rather than listed. The Google Chat message carries the count for the same reason.

### 4. Closing the old board

Only **when everything got across**. If any item failed to move, or a draft was left behind, the old board stays open and the summary says so: closing a board that still holds unfinished work hides it, and hiding it is worse than leaving something to look at.

## Output

The job summary has one table per phase. Because most steps are no-ops when their target already exists, the icons distinguish *did it* from *it was already done* — otherwise a run that changed nothing would look identical to one that did all the work.

- ✅ done — closed, created, merged, pushed
- ➖ already done — already closed, already exists, already merged, nothing to push
- 🔎 dry run — would close, would create, would push
- ⏭️ deliberately skipped — e.g. satisfied by the OSS tag, or a milestone left open by `skip_close_milestones`
- ❔ nothing found — no milestone to close, no version for this project
- ❌ needs attention — merge conflict, no usable branch

Followed by a **Website PR** section — the PR link, the blog post path, how many `documentation.json` files were touched, which properties file the module list was compared against on an OSS run, any entry whose `ref` had to be cloned from a pre-Antora one on a commercial run, and a pointer to the [full diff](#seeing-the-changes) in the Website PR job's own summary — a **start.spring.io PR** section, a **Release board** section, and then explicit sections for anything that needs a human: **Blocked on a manual merge**, **Could not reach the repository**, **Releases held back**, **No branch to update**, **No milestone found to close**, **Satisfied by the OSS tag**, and **No release branch to merge**.

### Google Chat notification

When `SPRING_CLOUD_CORE_POST_RELEASE_GCHAT_WEBHOOK` is set and the run is **not** a dry run, a summary is posted to Google Chat, ending with a request to write up anything the generated notes cannot capture:

```
⚠️ *Post Release — 2025.1.2* (OSS)

Milestones closed: 7 closed, 10 none found
Releases: 1 already existed, 6 published, 10 skipped (OSS tag)
Next snapshot: 2025.1.3 (2025_1_3-snapshot.properties created)
New milestones: 5 already existed, 12 created
Merge back: 6 already merged, 1 BLOCKED by a conflict, 9 merged, 1 not reached
Version bumps: 6 already up to date, 9 pushed, 2 not reached
CI/PR workflow files kept from the maintenance branch: 8 project(s)
Dependabot: 18 PR(s) asked to recreate

*2 project(s) need attention:*
• spring-cloud/spring-cloud-config-commercial — blocked on a manual merge of release/5.0.4 into 5.0.x

*Please update your project's release notes* with anything that needs calling
out — CVEs, breaking changes, deprecations, or other notable fixes. ...

<https://…/actions/runs/123|View the full report>
```

Notes on this:

- **Skipped entirely for a dry run.** There is nothing to announce, and asking people to write up release notes would be misleading when no release was published.
- **Still posted when the run is red** — the message is built before the summary step exits non-zero, because a blocked project is exactly when people need to see it.
- Chat uses its own lightweight formatting (`*bold*`, `<url|text>`, no tables) rather than GitHub markdown, so the message is built separately from the job summary. Same approach as [ci-status-report](README-ci-status-report.md).
- Per-phase counts are produced by **grouping on whatever status values are present**, not by listing the expected ones, so a status nobody enumerated appears under its raw name rather than being silently dropped. The counts always add up to the number of projects.

## Notes

- **Milestone lookups are paginated, and that is not optional.** There is no "get a milestone by title" endpoint, so every milestone check here lists them — and several of these repositories are well past a hundred milestones (`spring-cloud-release` has 167, `spring-cloud-config` 154, `spring-cloud-commons` 151). The list API returns them **sorted by due date ascending**, so an unpaginated `per_page=100` read drops exactly the newest ones: the release just made and the one after it. A run against `2025.1.3` reported `not-found` for five repositories whose milestones were plainly there. Every lookup now uses `--paginate` — `--slurp` in the Node steps, since gh refuses `--slurp` together with `--jq`, and `jq -s add` in the shell ones.
- **`spring-boot` is in every properties file but is not a Spring Cloud repository**, so it is excluded from tag checks, milestones, releases and branch updates. It *is* bumped in the snapshot properties file, matching the existing files.
- Pre-release qualifiers (`-M1`, `-RC1`) are rejected rather than half-handled — bumping the patch of `2025.1.0-RC1` produces a version nobody wants, and post-release chores are not run for milestones or release candidates.
- `update-project-versions` is called with `release-train-version` rather than an explicit versions map, because only that path applies `project-version-substitutions` (which maps `spring-cloud-dependencies-parent` → `spring-cloud-build`, `verifierVersion` → `spring-cloud-contract`, and so on). That path resolves over `raw.githubusercontent.com`, which is CDN-cached, so after committing the snapshot file the workflow waits for the raw URL to serve it before any project is updated. If the CDN never catches up, version updates are skipped rather than applied from a stale file, and the run can simply be repeated.
- Tag existence is checked with `git/matching-refs` and an exact comparison, not a plain `git/refs/tags/<tag>` lookup, which would also prefix-match `v5.0.20` when asked for `v5.0.2`.
- `max-parallel: 8` keeps the fan-out from saturating the runner pool; `fail-fast: false` so one bad project does not abandon the rest.
- Step 4 (new milestones) and step 5 (merge back and bump) run in parallel — neither depends on the other. Step 6 waits on step 5, because that is what makes the tagged commit reachable, and steps 7 and 8 wait on step 6 — the blog post links to the releases it publishes, and neither PR should be opened for a release that did not complete.

## Related workflows

- [release-train-ready.yml](release-train-ready.yml) — marks a single project ready in a Spring release train, reading the same `jenkins-releaser-config` properties files
- [create-hotfix-release-branch.yml](README-create-hotfix-branch.md) — creates the commercial `release/<version>` branches this workflow later merges back
