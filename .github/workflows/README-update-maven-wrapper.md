# Update Maven Wrapper Workflow

Opens a pull request against every maintained repository/branch whose Maven wrapper is
behind, so **CI decides whether the upgrade is safe** rather than a bulk push doing it
blind. Defaults to a dry run.

## Why this exists

In August 2026 GitHub enabled a Dependabot experiment, visible as `"maven-wrapper-updater":
true` in every Maven job definition. Dependabot began trying to update the wrapper itself,
and started failing across the estate in two distinct ways:

| Mode | Error | Cause |
|---|---|---|
| **A** | `Non-resolvable parent POM … (absent)` | It shells out to `mvn wrapper:wrapper`, which forces full project-model resolution — and an unpublished `-SNAPSHOT` parent cannot be resolved. Affects OSS and commercial alike. |
| **B** | `Could not determine Maven Wrapper version from wrapperVersion, wrapperUrl, or script files` | `FileParser::WrapperMojo` cannot parse the older wrapper formats — the oldest branches still reference the pre-Apache `io.takari` wrapper. |

Both come from the wrapper being old or inconsistent, so bringing every wrapper up to a
current, uniform version removes both. Mode A returns whenever a new Maven is released and
the wrappers fall behind again — **this workflow running weekly is what keeps that from
becoming an outage.**

The estate was genuinely inconsistent when this was written:

```
spring-cloud-stream@main     Maven 3.6.3    wrapperUrl io.takari:maven-wrapper:0.5.6
spring-cloud-task@main       Maven 3.9.1    wrapperUrl org.apache.maven.wrapper:3.2.0
spring-cloud-zookeeper@main  Maven 3.9.0    wrapperUrl org.apache.maven.wrapper:3.1.1
spring-cloud-commons@main    Maven 3.9.11   wrapperVersion 3.3.4 + distributionType=only-script
```

## Description

1. **`versions`** resolves the target Maven and `maven-wrapper` versions.
2. **`setup`** expands [`config/projects.json`](../../config/projects.json) into one matrix
   entry per repo/branch.
3. **`update`** compares each branch's wrapper and, if behind, creates a branch, commits,
   and opens a PR.
4. **`summary`** reports every combination in one table.

`docs-build` is deliberately out of scope: it is not in `projects.json`, and its Dependabot
config runs the `npm` ecosystem rather than `maven`, so its wrapper is not part of this
problem.

## What it changes

**Only `.mvn/wrapper/maven-wrapper.properties`.** The wrapper JAR and the `mvnw` /
`mvnw.cmd` scripts are left untouched.

- `distributionUrl` → the target Maven version
- `wrapperUrl` → the Apache `maven-wrapper` coordinates at the target version, **only if the
  file already has that key**. This is what migrates the oldest branches off `io.takari` and
  fixes Mode B.
- `wrapperVersion` → the target version, **only if the file already has that key**

Existing comments, licence headers and file shape are preserved — it is a targeted edit, not
a regeneration.

### Why it does not run `mvn wrapper:wrapper`

Regenerating the wrapper properly would mean invoking the wrapper plugin — which is
*precisely* the parent-POM resolution that fails for a SNAPSHOT parent, the very bug being
worked around. A textual edit sidesteps it entirely and is deterministic and reviewable. CI
on the resulting PR is what proves the new Maven actually works.

### The `distributionUrl` has two version numbers

```
https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip
                                                                   ^^^^^^              ^^^^^^
```

Both the directory and the filename carry it, and **both must be rewritten** — changing only
the filename yields a URL that 404s and breaks every build using the wrapper. One regex
captures both so detection and rewriting can never disagree; a file that doesn't match that
shape is reported as `unparsed` rather than being silently treated as up to date. The host
prefix is preserved, so a repository pointing at a mirror keeps pointing at it.

## Target version selection

With `maven_version` empty, the target is the **newest stable 3.9.x** on Maven Central, not
Central's `<latest>` — which is currently `4.0.0-rc-6`. Dependabot itself stays on the stable
line (its logs show *"Filtered out 33 pre-release versions"*), so tracking 3.9.x is what
actually keeps it quiet. Set `maven_version` explicitly to move to a 4.x line deliberately.

> Verify any version you pin by hand actually exists. `3.9.19` looks plausible and does not
> exist — pointing `distributionUrl` at it would 404 on every build.

## DCO

Spring Cloud repositories run a **required DCO check**, so each commit carries a
`Signed-off-by` trailer and sets the commit author and committer explicitly to match it. If
the identity needs to change, both the trailer and the author/committer fields must move
together or DCO fails.

## Triggers

- **`workflow_dispatch`** — on demand, with the inputs below.
- **`schedule`** — Mondays at ~7:00am US Eastern, as two month-selected cron entries (EDT
  `UTC-4` / EST `UTC-5`), following the DST convention used by the other scheduled workflows
  here. Weekly rather than daily because a Maven release is rare and each run can open PRs
  across ~79 branches.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `projects` | Comma-separated project names. Empty processes all of them. | No | `''` |
| `repo_type` | `both`, `oss`, or `commercial` | No | `both` |
| `maven_version` | Target Maven version. Empty uses the newest stable 3.9.x. | No | `''` |
| `wrapper_version` | Target `maven-wrapper` version. Empty uses the newest stable release. | No | `''` |
| `dry_run` | Report what would be opened without creating anything | No | `true` |
| `token` | Needs `contents:write` and `pull-requests:write` on all targets. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

## Statuses

| Status | Meaning |
|---|---|
| `pr-opened` | A PR was created |
| `would-open` | Dry run — a PR would be created |
| `pr-open` | A PR for this target version is already open; nothing done |
| `branch-exists` | The branch exists with no open PR — a previous PR was closed unmerged, so it is **left alone** rather than reopened |
| `up-to-date` | Already on the target |
| `ahead` | Newer than the target; never walked backwards |
| `no-wrapper` | No `.mvn/wrapper/maven-wrapper.properties` on that branch |
| `unparsed` | `distributionUrl` didn't match the expected shape — needs a look |
| `error` | An API call failed; the detail is in the summary |

## Notes

- **These PRs are real Maven upgrades, not cosmetic bumps** — some branches jump from 3.6.3
  or 3.8.4 to 3.9.16. The PR body says so explicitly. Merge only on green CI.
- A `Release Freeze` from [`lock-unlock-branches.yml`](README-lock-branches.md) restricts
  pushes to the frozen release branches, so the PR branch itself is created fine, but the PR
  cannot be merged until the freeze lifts.
- One branch failing never stops the others (`fail-fast: false`, `max-parallel: 8`); errors
  are collected and listed in the summary.
- This addresses the cause. The complementary mitigation is a Dependabot `ignore` rule for
  `org.apache.maven:apache-maven`, which suppresses the symptom regardless of wrapper state —
  see [`README-dependabot-report.md`](README-dependabot-report.md) for how these failures
  surface in the daily report.
