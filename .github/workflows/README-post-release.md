# Post Release Workflow

An on-demand workflow that performs the chores that follow a Spring Cloud release train: verifying every project was actually tagged, closing milestones, publishing GitHub releases, seeding the next snapshot config, opening the next round of milestones, merging release branches back, bumping the maintenance branches to the new snapshot versions, and nudging Dependabot to drop PRs the release has superseded.

Previously all of this was done by hand, repo by repo, for up to 17 projects.

## Description

It:

1. **Reads the properties file** for `release_version` from the `jenkins-releaser-config` branch of `spring-cloud-release` (or `spring-cloud-release-commercial`), validates the inputs, and builds a matrix of `{project, repo, version, tag}`
2. **Verifies a `v<version>` tag exists** for every project — a hard gate, in a single job so an incomplete release produces one consolidated failure naming every missing tag
3. **Closes the release milestone** and **publishes the GitHub release** for each tag
4. **Writes the next `<train>-snapshot.properties` file** to `jenkins-releaser-config`, with every version's last segment bumped and `-SNAPSHOT` appended
5. **Opens a milestone** for each new snapshot version, via the [create-milestone](../actions/create-milestone/README.md) action
6. **Merges `release/<version>` back into the `.x` branch**, applies the new snapshot versions with [update-project-versions](../actions/update-project-versions/README.md), pushes both commits together, and comments `@dependabot recreate` on superseded Dependabot PRs
7. **Writes a summary** covering every phase, with everything that was skipped or blocked called out explicitly

### Gate on existence, never classify

A project listed in the properties file may not have been released *in this train* — its version can be carried over from an earlier one. Rather than trying to detect that, **every mutating step is a no-op when its target already exists**, so the three cases resolve themselves:

| Case | Tag | Release | Milestone |
|------|-----|---------|-----------|
| Released in this train | in the primary repo | created | open → closed |
| Carried over from an earlier train | in the primary repo | already exists → skipped | already closed → skipped |
| No commercial release since the last OSS one | OSS repo only | no tag here → skipped | absent → reported |

This is also what makes re-running the workflow safe, and what lets a `projects`-filtered repair run work after a partial failure.

## Triggers

- **`workflow_dispatch`** only. There is no schedule — this runs when a release train has shipped.

**Defaults to a dry run.** Set `dry_run` to `false` to actually close, create, commit and push.

**The workflow exits non-zero** if any project hit a merge conflict or had no usable branch to update, since those leave a project half-done. Milestones that were not found, releases that already existed, and projects with no release branch are all reported without failing the run.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `release_version` | The release train version that just shipped, e.g. `2025.1.2`, or `2025.1.2.1` for a commercial hotfix. Must be a plain numeric version with 3 or 4 segments. | Yes | string |
| `commercial` | Was this a commercial release? **Ignored when `projects` is supplied.** | No | boolean (default: `false`) |
| `projects` | Comma-separated project names, `-commercial` suffix included where applicable. Empty processes every project in the properties file. See [The projects filter](#the-projects-filter). | No | string |
| `dry_run` | When checked, nothing is created, committed or pushed — but the summary shows what would happen. | No | boolean (default: `true`) |
| `token` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GH_ACTIONS_REPO_TOKEN` | Used whenever the `token` input is empty. Needs write access to every target repository (contents, issues for milestones, and releases), plus read access to `spring-cloud-release-commercial` for commercial runs. | Yes, unless `token` is passed |
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

**The filter does not apply to step 4.** The snapshot properties file is train-wide and stays complete: `update-project-versions` needs the *whole* versions map to update each project's dependency versions, so a file containing only the filtered projects would produce wrong POMs. Step 4 always writes every entry; only the repo-facing steps are filtered.

Note this differs from [ci-status-report](README-ci-status-report.md) and [rollout-deploy-docs](README-rollout-deploy-docs.md), which pair bare project names with a separate `repo_type` input. Here the suffix carries the type, so there is no `repo_type`.

## Hotfix releases

A **4-segment `release_version`** (e.g. `2025.1.2.1`) is treated as a commercial hotfix and **stops after step 3** — verify tags, close the milestone, create the release. Steps 4 onward are skipped: there is no next snapshot train for a hotfix, no new milestone, no version bump, no Dependabot pass, and **no merge-back, because a hotfix has no branch to merge back into** (the `release/<version>` branch is itself the hotfix line).

Commercial trains come in both shapes — `2024_0_8.properties` is a 3-part commercial release whose projects carry 3-part versions and which runs the full sequence, while `2025_1_2_1.properties` is the 4-part hotfix. So the mode is decided by the version's shape, not by the `commercial` input.

## Release notes

Release bodies come from GitHub's own generator (`POST /repos/{repo}/releases/generate-notes`), which is PR-based and honors a project's `.github/release.yml`, then:

- **OSS projects: used verbatim**, reproducing what the existing releases look like — `## :heart: Contributors`, `## What's Changed` with one line per merged PR, `## New Contributors`, and a `**Full Changelog**` compare link.
- **Commercial projects: sanitized.** The contributor sections, the `**Full Changelog**` line, and the ` by @<user> in <url>` suffix on each bullet are stripped, because those PR links point into a private repository and are useless to most readers. This reproduces the existing commercial release bodies.
- **`spring-cloud-release`: gains a `## What's Included` section** listing every project version in the BOM with a link to that project's release, built from the same properties file.

Release **titles** are deliberately not normalized: OSS projects use the bare version (`5.0.4`) while `spring-cloud-release` and every commercial repo use a `v` prefix (`v2025.1.2`, `v4.2.8`), matching what already exists in each.

### When there are no notes to generate

Commercial branches are created as **orphan branches** with no history shared between lines, so the first tag on a new line has no predecessor to diff against. `generate-notes` then returns nothing but a `**Full Changelog**` link, which sanitization strips — leaving an empty body.

In that case the release body becomes a placeholder:

```
Released from tag v5.0.4.1.
```

The actual changes are written up by hand for these releases. This is checked *after* `What's Included` is prepended, so the release train's own release keeps its version list rather than being replaced by the placeholder.

Once a line has more than one tag this resolves itself — `v4.2.9`, which follows `v4.2.8` on the same line, generates a full `What's Changed` list normally.

### Dead links in `What's Included`

Two details, both there to avoid shipping dead links in a release body:

- **It omits `spring-cloud-release` itself.** The hand-written body for v2025.1.2 has a `Spring Cloud Starter Build` line pointing at `spring-cloud/spring-cloud-starter-build`, but that repository does not exist — the link 404s. The other 16 lines match the hand-written body exactly.
- **On a commercial train, each link follows the tag that actually exists.** Some entries in a commercial properties file carry the plain OSS version because that project had no commercial release (`spring-cloud-bus=5.0.2` in `2025_1_2_1.properties`), and `spring-cloud-bus-commercial` has no `v5.0.2` tag. Those entries link to the OSS repository; entries with a real commercial version link to the `-commercial` one.

## Branch resolution

For each project, the branch to merge into and bump is derived by **dropping the last segment of the new snapshot version and appending `.x`** — `5.0.3-SNAPSHOT` → `5.0.x`, and for a 3-part commercial train `4.2.8-SNAPSHOT` → `4.2.x`.

If that branch does not exist:

- **OSS** → falls back to `main`, but only after confirming the root `pom.xml` version (or its `<parent>` version) is on the same `major.minor` line. Otherwise the project is skipped and reported, rather than bumping an unrelated line to these versions.
- **Commercial** → **fails and is reported.** Commercial repositories have no `main` branch at all — `spring-cloud-config-commercial`'s default branch is `4.3.x` — so there is no sane fallback.

## Merge back

The commit each tag points at lives on a `release/<version>` branch, which has to come back to the `.x` branch before anything else touches it.

- **No `release/<version>` branch** → nothing to merge; the run continues to the version bump. Expected for carried-over versions, OSS-fallback entries, and branches already merged and deleted.
- **Already merged** → reported as such, no commit. The merge check is `git merge-base --is-ancestor`, so this is naturally idempotent.
- **Conflict** → the merge is aborted, and **the version bump, the push and the Dependabot pass are all skipped for that project**. Other projects continue. The summary flags it under **Blocked on a manual merge** and the run exits non-zero. Resolve it by hand, then re-run with `projects` set to just the affected projects.

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

## Output

The job summary has one table per phase. Because most steps are no-ops when their target already exists, the icons distinguish *did it* from *it was already done* — otherwise a run that changed nothing would look identical to one that did all the work.

- ✅ done — closed, created, merged, pushed
- ➖ already done — already closed, already exists, already merged, nothing to push
- 🔎 dry run — would close, would create, would push
- ⏭️ deliberately skipped — e.g. satisfied by the OSS tag
- ❔ nothing found — no milestone to close, no version for this project
- ❌ needs attention — merge conflict, no usable branch

Followed by explicit sections for anything that needs a human: **Blocked on a manual merge**, **No branch to update**, **No milestone found to close**, **Satisfied by the OSS tag**, and **No release branch to merge**.

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

- **`spring-boot` is in every properties file but is not a Spring Cloud repository**, so it is excluded from tag checks, milestones, releases and branch updates. It *is* bumped in the snapshot properties file, matching the existing files.
- Pre-release qualifiers (`-M1`, `-RC1`) are rejected rather than half-handled — bumping the patch of `2025.1.0-RC1` produces a version nobody wants, and post-release chores are not run for milestones or release candidates.
- `update-project-versions` is called with `release-train-version` rather than an explicit versions map, because only that path applies `project-version-substitutions` (which maps `spring-cloud-dependencies-parent` → `spring-cloud-build`, `verifierVersion` → `spring-cloud-contract`, and so on). That path resolves over `raw.githubusercontent.com`, which is CDN-cached, so after committing the snapshot file the workflow waits for the raw URL to serve it before any project is updated. If the CDN never catches up, version updates are skipped rather than applied from a stale file, and the run can simply be repeated.
- Tag existence is checked with `git/matching-refs` and an exact comparison, not a plain `git/refs/tags/<tag>` lookup, which would also prefix-match `v5.0.20` when asked for `v5.0.2`.
- `max-parallel: 8` keeps the fan-out from saturating the runner pool; `fail-fast: false` so one bad project does not abandon the rest.
- Step 5 (new milestones) and step 6 (merge back and bump) run in parallel — neither depends on the other.

## Related workflows

- [release-train-ready.yml](release-train-ready.yml) — marks a single project ready in a Spring release train, reading the same `jenkins-releaser-config` properties files
- [create-hotfix-release-branch.yml](README-create-hotfix-branch.md) — creates the commercial `release/<version>` branches this workflow later merges back
