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

### What is out of scope

- **`-internal` branches are skipped.** They are the in-flight development line for the next
  train, so an unsolicited toolchain change there lands in the middle of active work rather
  than on a settled branch. They are filtered out of the matrix, so no runner is spent on
  them, but every one is **named** in the summary under *Skipped* — 12 of the 79
  combinations at the time of writing, which is too many to drop silently. To include them,
  remove the `endsWith('-internal')` check in the `setup` job.
- **`docs-build`** is not in `projects.json`, and its Dependabot config runs the `npm`
  ecosystem rather than `maven`, so its wrapper is not part of this problem.

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

### Why the default does not run `mvn wrapper:wrapper`

Regenerating the wrapper properly means invoking the wrapper plugin — which is *precisely*
the parent-POM resolution that fails for a SNAPSHOT parent, the very bug being worked
around. The textual edit sidesteps it entirely, needs no JDK, no credentials and no
checkout, and produces a one-line diff that is trivial to review. CI on the resulting PR is
what proves the new Maven actually works.

Set [`regenerate`](#regenerate-mode) when you do want the full treatment.

## Regenerate mode

With `regenerate` checked, the workflow checks the branch out, runs

```
mvn -B -N -s .settings.xml -Pspring \
    org.apache.maven.plugins:maven-wrapper-plugin:<wrapper>:wrapper \
    -Dmaven=<maven> -Dtype=<wrapper_type>
```

**The runner's `mvn`, deliberately not `./mvnw`.** Using the wrapper to regenerate the
wrapper is circular: the old wrapper has to boot the old Maven before it can be replaced,
which on the oldest branches means Maven 3.6.3 — exactly the floor `maven-wrapper-plugin`
3.x requires. The runner's Maven is current and carries no such constraint. What has to
match CI is the **settings file and the profile**, not the Maven that writes the files.

and commits whatever the plugin produces — `mvnw`, `mvnw.cmd` and the JAR as well as the
properties. `-N` keeps it to the root project, where the wrapper lives.

This is how you get off the old formats entirely rather than only correcting their version
numbers.

### Wrapper flavours

`-Dtype` selects what the plugin writes. The three differ less than their names suggest —
`bin` and `script` ship a **byte-identical `mvnw`** and differ only in whether the JAR is
committed:

| Flavour | Ships | `mvnw` reads | Bootstrap |
|---|---|---|---|
| **`bin`** (default) | `mvnw`, `mvnw.cmd`, **+ `maven-wrapper.jar`** | `wrapperUrl` | Runs the committed JAR, which downloads Maven |
| `script` | scripts only | `wrapperUrl` | Same script as `bin`, but fetches the JAR first |
| `only-script` | scripts only | `distributionUrl` | Pure shell — no JAR; the script downloads and unpacks Maven itself |

Under `bin`/`script` the script never reads `distributionUrl` at all — the JAR does. Only
`only-script` reads it directly.

**`bin` is the default because it is what the estate already uses**: of the 79 maintained
branches, 75 are `bin` and only 4 are `only-script`. Regenerating as `bin` therefore keeps
each branch's existing shape and produces the smallest diff. Choosing `only-script` would
delete the committed JAR and swap in a different `mvnw` across nearly every branch at once —
a defensible modernisation, but a much larger change to land in one pass.

Either way the plugin drops `.mvn/wrapper/MavenWrapperDownloader.java`, a Takari-era file
present on 45 branches that no current distribution ships. That is safe: the modern script
only uses it as a fallback for downloading the JAR when neither `curl` nor `wget` exists, and
guards it with an existence check — and under `bin` the JAR is committed, so that path never
runs. It is safe **because `mvnw` is replaced in the same commit**; removing the file while
leaving an old Takari script in place would not be.

### Resolving the parent POM

`regenerate` needs the parent POM to resolve — which is the whole reason the default mode
avoids Maven. Two things make it work, and both are easy to get wrong:

- **The branch's own `.settings.xml`**, exactly as that branch's CI builds with it (see
  [`pr.yml`](pr.yml)'s `./mvnw -s .settings.xml ... -Pspring`). It is maintained per branch,
  and it is the only file that names the **OSS** snapshot repository
  (`repo.spring.io/libs-snapshot-local`) — the shared
  [`config/release-ci-settings.xml`](../../config/release-ci-settings.xml) in this repo is
  **commercial-only**, so using it would leave every OSS branch unable to resolve its own
  parent. There is deliberately **no fallback**: a branch without `.settings.xml` would
  resolve against Maven Central alone and fail on its own SNAPSHOT parent, so it reports
  `regenerate-failed` saying exactly that rather than guessing with someone else's settings.
- **`-Pspring`.** The repositories live inside a `spring` profile, so without activating it
  the snapshot repositories are not in play at all and the parent cannot resolve, however
  correct the settings file is.

### Credentials

`.settings.xml` resolves its servers from `${env.*}` placeholders, so the secrets only work
if they reach Maven **as environment variables**:

- `COMMERCIAL_ARTIFACTORY_USERNAME` / `_PASSWORD` are set by this repo's own
  [`set-commercial-creds-env-vars`](../actions/set-commercial-creds-env-vars/action.yml)
  action, which also falls back to the read-only `ARTIFACTORY_*` pair when the read/write
  one is unavailable. It writes to `$GITHUB_ENV`, so it runs as its own step before Maven —
  and the regenerate step deliberately does **not** re-declare those two in its `env:`,
  since a step-level value would override `$GITHUB_ENV` and lose the fallback.
- `CI_DEPLOY_USERNAME` / `_PASSWORD` back the `repo.spring.io` server entry.

Before running Maven, the step prints every `${env.*}` name the branch's `.settings.xml`
refers to and whether it arrived, as `set` or `EMPTY` (names only, never values). An empty
credential otherwise shows up only as a 401, or as a resolution failure that reads like a
missing artifact — neither of which points at the real cause.

The snapshot parents genuinely are published — `spring-cloud-build:5.0.3-SNAPSHOT` resolves
from `repo.spring.io` while Maven Central 404s on it, which is exactly why Dependabot's own
attempt fails: it never gets this settings file.

When resolution still fails, the branch reports `regenerate-failed` with the Maven error
quoted verbatim, so it is not mistaken for a workflow bug, and every other branch carries on.
Maven's full output is streamed to the job log, with the `[ERROR]`/`[WARNING]` lines
repeated under a **Maven failure detail** group — the extracted one-liner is a summary, never
the only record.

### `-N` and import BOMs

`-N` keeps the run to the root project, but it also means sibling modules are not built. That
matters for `spring-cloud-build`, whose root POM imports one of its own modules as a BOM:

```xml
<artifactId>spring-cloud-build-dependencies</artifactId>
<version>${spring-cloud-build.version}</version>
<scope>import</scope>
```

Import-scope BOMs are resolved during model building, so with `-N` that artifact must come
from a repository rather than the reactor. On OSS it does — `spring-cloud-build-dependencies`
snapshots are on `repo.spring.io` and readable anonymously. On commercial it has to come from
the Broadcom repository with credentials, and a branch whose snapshot has not been published
there will report `Non-resolvable import POM` however good the settings file is.

If commercial branches fail this way and OSS ones do not, that asymmetry — not the settings
file — is the thing to look at.

### Extra inputs

| Input | Description | Default |
|---|---|---|
| `regenerate` | Run the wrapper plugin instead of editing the properties file | `false` |
| `wrapper_type` | `bin` (keeps the JAR), `only-script` (no JAR), or `script` — see [Wrapper flavours](#wrapper-flavours) | `bin` |
| `java_version` | JDK used to run the plugin | `17` |

### Branch handling

The PR branch is always cut fresh from the base branch and **force-pushed**. The generated
files come from a checkout of the base, so committing them onto a divergent branch would mix
two states — and since the branch only ever holds this workflow's own generated commit,
replacing it wholesale is the intent. `--force` rather than `--force-with-lease` because the
remote branch was never fetched, which would make a lease check fail on stale info rather
than protect anything.

### Trade-off

| | Default (properties only) | `regenerate: true` |
|---|---|---|
| Diff | 1–2 lines | `mvnw`, `mvnw.cmd`, JAR, properties |
| Needs a JDK, credentials, checkout | No | Yes |
| Can fail on parent resolution | No | Yes — the bug being worked around |
| Modernises the scripts | No | Yes |

Run the default for routine version bumps; run `regenerate` as a deliberate pass when you
want the scripts brought up to date — ideally scoped with `projects` to a few repos at a
time, since the diff is much larger.

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
| `auto_merge` | Merge existing wrapper PRs whose checks have all passed. **Manual runs only** — see [Auto-merge](#auto-merge) | No | `true` |
| `merge_method` | `squash`, `merge`, or `rebase` | No | `squash` |
| `dry_run` | Report what would happen without creating, updating or merging anything | No | `true` |
| `token` | Needs `contents:write` and `pull-requests:write` on all targets. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | `''` |

### Dry run and the schedule

A **manual dispatch defaults to a dry run**, so you can look before anything happens. A
**scheduled run always acts** — a scheduled event carries no inputs, so `dry_run` would
otherwise be its default of `true` and the weekly job would report forever without ever
opening a PR.

## Auto-merge

**The weekly scheduled run never merges.** These are real Maven upgrades, so the schedule
opens and refreshes PRs and a human decides when they land. `auto_merge` applies to a manual
dispatch only — which makes merging every green wrapper PR one deliberate click, rather than
something that happens overnight. To let the schedule merge unattended later, remove the
`github.event_name != 'schedule'` clause from the merge step.

A scheduled run says so in its summary, so an empty Merge column next to open green PRs reads
as policy rather than as merging having quietly failed.

With `auto_merge` enabled on a manual run (the default), a wrapper PR that is **open, already
at the target version, and fully green** is merged with `merge_method` and its head branch
deleted.

Only a PR that was *already* open when the run started is eligible. One opened or moved up in
the same run is deliberately skipped — its checks have not started yet, so merging it would
defeat the point of routing this through CI at all.

Checks are read from `statusCheckRollup` rather than inferred from `mergeStateStatus`, which
conflates failing checks with "needs review" and with a locked branch — the same distinction
[`dependabot-report.yml`](README-dependabot-report.md) makes. A PR is merged only when every
check passes *and* `mergeable` is `MERGEABLE` *and* `mergeStateStatus` is `CLEAN`.

| Merge status | Meaning |
|---|---|
| `merged` | Merged and the head branch deleted |
| `would-merge` | Dry run — it would have been merged |
| `not-merged` | Reported with the reason: failing checks (named), checks still running, conflicts, no checks reported yet, or green-but-`BLOCKED` |
| `error` | The merge call itself failed |

`BLOCKED` with everything green usually means a required review, or a `Release Freeze` on the
base branch. The merge API would refuse it anyway, so it is reported rather than attempted.

Set `auto_merge` to false to only open and update PRs and leave merging to a human.

## Statuses

| Status | Meaning |
|---|---|
| `pr-opened` | A PR was created |
| `pr-updated` | An open PR was moved up to a newer target — see [Rerunning](#rerunning) |
| `regenerate-failed` | `regenerate` mode only — the wrapper plugin failed, with the Maven error quoted |
| `would-open` / `would-update-pr` | Dry run — what would happen |
| `pr-open` | A PR is open and already at the target; nothing done |
| `branch-exists` | The branch exists with no open PR — a previous PR was closed unmerged, so it is **left alone** rather than reopened |
| `up-to-date` | Already on the target |
| `ahead` | Newer than the target; never walked backwards |
| `no-wrapper` | No `.mvn/wrapper/maven-wrapper.properties` on that branch |
| `unparsed` | `distributionUrl` didn't match the expected shape — needs a look |
| `error` | An API call failed; the detail is in the summary |

## Rerunning

The workflow is safe to run repeatedly — it derives everything from current state rather
than from a queue, so rerunning never duplicates work:

| On rerun | Result |
|---|---|
| PR still open at the target, checks green | `pr-open` — merged only on a manual run with `auto_merge` on; a scheduled run leaves it |
| PR still open at the target, checks red or pending | `pr-open` — left for a human |
| PR merged | The branch is now current → `up-to-date` |
| PR open, but a **newer Maven** has since shipped | `pr-updated` — the commit lands on the **existing** PR's branch, moving it up in place |
| PR closed unmerged, branch still present | `branch-exists` — left alone, so a deliberate rejection is not re-litigated |
| PR closed unmerged, branch deleted | A fresh PR is opened. If a branch should never take the upgrade, keep the head branch or pin `maven_version` |

**One PR per repo/branch, always at the current target.** Two details make that hold:

- **The head branch name includes the base branch** — `maven-wrapper-update/<branch>-<maven>`.
  Without the branch component every branch in a repo would share one head ref, so the first
  matrix job would create it and the rest would collide on it; with several maintained
  branches per repo, most would be silently skipped.
- **Existing PRs are matched by prefix and base, not by exact head name.** A PR opened for an
  earlier target is therefore still found, and gets moved up rather than having a second PR
  stacked on top of it. Matching on the exact name would grow a new PR per Maven release,
  all editing the same file and all conflicting with each other once one merged.

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
