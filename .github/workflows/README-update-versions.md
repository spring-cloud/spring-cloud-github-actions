# Update Versions

A dispatchable workflow that runs the [update-project-versions](../actions/update-project-versions/README.md) action against **every OSS or every commercial project on a release train** in one go, then commits and pushes the result.

## Description

[`update-project-versions`](../actions/update-project-versions/README.md) updates one checked-out project: given a release train version, it reads the matching `jenkins-releaser-config` properties file and rewrites the versions in that project's `pom.xml`, `gradle.properties`, and `build.gradle` files. This workflow is the fan-out around it — resolve the project list from the properties file, and for each project resolve a branch, clone it, run the action, and push.

It:

1. **Reads `<release_train_version>.properties`** from the `jenkins-releaser-config` branch of `spring-cloud/spring-cloud-release-commercial` and builds the matrix from its `releaser.fixed-versions[...]` entries
2. **Waits for `raw.githubusercontent.com` to serve that exact file** — see [The raw wait](#the-raw-wait)
3. **Per project**: resolves the target branch, clones it, runs the action, and commits + pushes `Updating project versions to <version>`
4. **Writes a summary table** listing what was pushed, what was already correct, and what failed

Nothing here *creates* a properties file. The file must already exist on `jenkins-releaser-config`; [post-release](README-post-release.md)'s `next-snapshot-config` step is what normally writes the `-snapshot` one, and it can also be committed by hand.

## When to use this instead of post-release

[post-release](README-post-release.md) already applies the next snapshot versions — step 6c of its `merge-back-and-update` job — but only as one part of a full post-release run that also closes milestones, publishes releases, writes the next snapshot properties file, and merges `release/<version>` back into the maintenance branch.

Use this workflow when the versions need to move **on their own**:

- the snapshot bump has to land **before** post-release runs
- post-release was run and its bump failed for some projects, or was skipped because the raw CDN had not caught up, and only the bump needs re-running
- projects need moving onto a train version that is not the one that follows a release — a corrected properties file, a project that was added to the train late, a branch that was created from the wrong versions

For the normal end-of-release path, run [post-release](README-post-release.md) — it does this plus everything else, and running this workflow first is not required.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `release_train_version` | Version whose properties file supplies the versions, e.g. `2025.1.3-SNAPSHOT` or `2025.1.2`. Resolved to a file name exactly the way the action does: `2025.1.3-SNAPSHOT` → `2025_1_3-snapshot.properties`. | Yes | string |
| `commercial` | Update the `-commercial` repositories. Ignored when `projects` is supplied. | No | boolean (default: `false`) |
| `projects` | Comma-separated projects, including the `-commercial` suffix where applicable. Empty processes every project in the file. | No | string |
| `dry_run` | Clone, update, and diff without pushing | No | boolean (default: `true`) |
| `token` | Token with write access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

`spring-boot` is in the properties file so that every project picks up its version, but it is not a Spring Cloud repository — it is never pushed to, and naming it in `projects` is an error.

## OSS or commercial, never both

A run targets one release train, and one train version addresses one line. So `commercial` selects which repositories are updated, and when `projects` is supplied the `-commercial` suffix on the names decides instead — a list mixing both is rejected rather than half-applied. This matches [post-release](README-post-release.md).

The **properties file** is always read from `spring-cloud-release-commercial`, for OSS trains too. That repository holds the releaser config for every train now, which is also why the workflow passes a hardcoded `commercial: 'true'` to the action: that input does nothing in the action except pick which repository the config is fetched from.

## Branch resolution

Each project's branch is derived from **its own version** in the properties file: drop the last segment and append `.x`. This works for both lines — OSS `5.0.4-SNAPSHOT` → `5.0.x`, three-part commercial `4.2.9-SNAPSHOT` → `4.2.x`.

If that branch does not exist:

- **commercial** — the project is skipped. Commercial repos have no `main` to fall back to (`spring-cloud-config-commercial`'s default branch is `4.3.x`).
- **OSS** — falls back to `main`, but only after reading `pom.xml` on `main` and confirming it is on the same `major.minor` line. Otherwise the project is skipped with `version-mismatch` rather than bumping an unrelated major to these versions.

**There is no input to override this.** Between those two rules every branch the workflow targets is covered: the only names in [`projects.json`](../../config/projects.json) that are not `<major>.<minor>.x` are `main`, which the fallback handles, and the `-internal` branches, which this never targets — those are rebased from the OSS branches it does update. An override input would therefore have no correct use, and would be the one way to push a train's versions onto a branch they do not belong on, since a branch given by hand cannot be checked against the version the way a derived one can.

## The raw wait

The action resolves the properties file over `raw.githubusercontent.com`, which is CDN-cached, while the setup job reads it through the API. A file committed moments ago — the common case here, since the usual reason to run this is a snapshot file someone just wrote — can still 404 or serve its previous contents on raw.

So setup polls the raw URL (up to 30 attempts, 10s apart) and compares the **contents**, not the status code: an updated file returns 200 immediately while the CDN is still serving the old version. If raw never agrees with the API, the run **fails before any repository is touched**. Applying stale versions across every project is much worse than waiting, and re-running once the CDN catches up costs nothing.

## Safety

- **`dry_run` defaults to `true`.** A dry run clones every repository, applies the versions, prints `git diff --stat`, and pushes nothing.
- **Nothing is created.** The workflow only rewrites versions in files that already exist, on branches that already exist, from a properties file that already exists.
- **Re-running is safe.** A project already at these versions produces no diff and is reported as `no-changes`, not as a failure — so a partially-failed run can be re-run with `projects` set to just the projects that failed.
- **`fail-fast: false`** so one bad repository does not abandon the rest, and **`max-parallel: 8`** keeps the fan-out from saturating the runner pool.
- **The version update itself is `continue-on-error`**, so a project whose files the action cannot update is recorded and reported instead of failing the leg before it can write its result.

## CI

The commit carries **no `[skip actions]`**, and there is no input to add one — unlike most workflows in this repository, and for the same reason [post-release](README-post-release.md) omits it on its bump: the point of moving a branch onto new versions is to have CI build on them. A run that pushed silently would leave every project's first build on the new versions to whatever happened to come next.

## Suggested sequence

1. **Dry run, one project**: `projects: spring-cloud-config`, `dry_run: true`. Check the diff in the job log.
2. **Dry run, everything**: `dry_run: true`. Check the summary table — every project should show a resolved branch, and the branches should be the ones you expect.
3. **Real run**: `dry_run: false`.
4. Re-run with `projects` set to anything listed under **Not updated** in the summary, once the reason is fixed.
