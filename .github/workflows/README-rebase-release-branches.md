# rebase-release-branches

Brings the `release/` and `-internal` branches of every spring-cloud project in a Spring release train up to date with their `.x` branches. Instead of rebasing each project's branches by hand, dispatch this once per train.

## What it does

1. **Plans** — reads `train.yml` from `spring-io/release-train` at the tag named after the train. Each spring-cloud version in it is `release/<version>` in `spring-cloud/<project>-commercial`. Versions are grouped by project and minor line (`5.0.4` and `5.0.4.1` share the `5.0` line), because `-internal` is shared by the whole line.
2. **Rebases** — one job per project and line (up to 5 at once). See below.
3. **Summarizes** — lists what was rebased, what was already up to date, what was skipped, and, first, every project and branch that **must be rebased by hand**.

## What gets rebased

| `deployment-destination` | Steps |
|---|---|
| `maven_central` (OSS release) | 1. `<x.y>.x-internal` in the commercial repo is rebased onto the OSS `<x.y>.x` branch (or `main` when `main` is on that line, as for a new minor). 2. `release/<version>` is rebased onto the rebased `<x.y>.x-internal`. |
| `spring_enterprise` (commercial release) | `release/<version>` is rebased onto the commercial `<x.y>.x` branch. |
| `spring_enterprise`, 4-segment version (hotfix, e.g. `5.0.4.1`) | If the project has an `<x.y>.x-internal` branch it follows the OSS steps: `-internal` is rebased once, then every `release/` branch of that line (`5.0.4` and `5.0.4.1`) onto it. Otherwise it follows the commercial steps. |

Only `-internal` and `release/*` branches are rewritten. The OSS and commercial `.x` branches are bases: they are read and never pushed to.

A `release/` branch following a rewritten `-internal` is rebased with `git rebase --onto <new -internal> <merge-base with old -internal>`, so only its own commits are replayed.

## Conflicts and missing branches

- A rebase that conflicts is aborted. The branch is reported as `conflict` with the conflicting files, and the branches that depend on it (the `release/` branches behind a conflicting `-internal`) as `blocked`. Both appear under **must be rebased by hand** and as warning annotations. The other projects carry on, and the run still succeeds.
- A branch that does not exist is `skipped`. A branch already on its base is `up-to-date`, so re-running after fixing something by hand only does what is left.
- A failed clone or fetch, or a rejected push, is an `error` and fails the run.

## Pushing

Pushes use `--force-with-lease` against the sha that was rebased, so a commit pushed to the branch during the run is not overwritten. With `dry_run` (the default) every rebase is done locally and reported, and nothing is pushed.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `spring_release_train` | yes | — | Release train version, the tag of `spring-io/release-train` to read, e.g. `2026.10.22` |
| `projects` | no | blank | Comma separated projects, e.g. `spring-cloud-config,spring-cloud-bus`. Blank means every spring-cloud project in `train.yml`. Names not in the train are listed as ignored. |
| `dry_run` | no | `true` | Rebase locally and report, without pushing |

Uses the `GH_ACTIONS_REPO_TOKEN` secret.

## Code

[`rebase-plan.js`](../scripts/rebase-plan.js) (plan and report), [`rebase-branches.sh`](../scripts/rebase-branches.sh) (git work for one project and line) and [`rebase-summary.js`](../scripts/rebase-summary.js).
