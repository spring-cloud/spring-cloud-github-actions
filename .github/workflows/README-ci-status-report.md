# CI Status Report Workflow

A workflow, runnable on demand or on a schedule, that checks the latest `ci.yml`/`ci.yaml`/`ci-release.yml` workflow run for every OSS and commercial branch of every Spring Cloud project, so a branch whose CI has quietly started failing is visible in one place instead of being discovered branch-by-branch. It also automates the "rerun it, it's probably just flaky" step most overnight CI failures actually need — see [Two-phase: detect-and-rerun vs. report](#two-phase-detect-and-rerun-vs-report).

## Description

It:

1. **Builds a matrix** from [`config/projects.json`](../../config/projects.json), expanding each project's `oss` and/or `commercial` section into one entry per branch listed under `branches.scheduled` (the full set of maintained branches, not just the `default` one)
2. **Looks up the latest run** of that branch's CI workflow via `gh api repos/<repo>/actions/workflows/<file>/runs?branch=<branch>`, trying `ci-release.yml`, then `ci.yml`, then `ci.yaml` — `-internal` branches and some OSS `release/*` branches run `ci-release.yml` instead of `ci.yml`/`ci.yaml` (the same convention the [`trigger-branch-ci`](../actions/trigger-branch-ci/action.yml) action already uses), so it's tried first and used whenever it's the one that actually exists on that branch
3. **On the detect-and-rerun run only**, triggers a rerun of just the failed jobs for anything failing, via `gh api .../actions/runs/<id>/rerun-failed-jobs`, then moves on without waiting for it to finish
4. **On the report run only, for branches whose latest run failed**, walks back through that workflow's run history to find when it broke and who broke it (see [Who broke it](#who-broke-it) below)
5. **Writes a summary table** to the job summary showing pass/fail/recovered/still-failing/not-found per project, type, and branch
6. **On the report run only, posts a notification to Google Chat** (if configured) with the counts and a link back to the run

## Triggers

- **`workflow_dispatch`** — run on demand with the inputs below. Always runs as the **report** phase (see below) — a manual click never triggers reruns.
- **`schedule`** — weekdays, twice: a **detect-and-rerun** pass at ~4:00am US Eastern, and the original **report** pass at ~6:07am. Since GitHub Actions cron always runs in UTC and has no notion of DST, each of those two times needs its own pair of cron entries — one at the UTC-4 offset (EDT, March–October) and one at UTC-5 (EST, November–February) — for four `schedule` entries total, not four separate runs a day. The real US DST boundary (2nd Sunday in March / 1st Sunday in November) falls mid-month, so for a few days each side of it a scheduled run fires an hour early or late local time; that's an accepted tradeoff for a status report rather than something worth a date-computing workaround. There's no other scheduled workflow in this repo with a DST convention to follow — [`examples/deploy.yml`](../../examples/deploy.yml)'s schedule runs at a fixed UTC time without accounting for DST at all. Scheduled runs use the input defaults (all projects, `both` repo types, `GH_ACTIONS_REPO_TOKEN`).
- The 6:07 entries use `:07` rather than `:00` — GitHub's docs flag the top of the hour as the most congested time for scheduled workflows and recommend an off-the-hour minute to reduce the chance of a delayed or dropped run. (The first scheduled run after this workflow was added, at `:00`, never appeared in the run history — see the investigation this change came out of.) The 4:00 entries are left on the hour since nothing downstream depends on split-second timing for them.

**The workflow itself always succeeds**, regardless of how many branches are failing or not found — its job is to report status, not to gate anything. Failures and not-found branches are still called out clearly in the job summary (and, on the report run, in the Chat notification), just without turning the run red.

## Two-phase: detect-and-rerun vs. report

Most overnight CI failures turn out to be flaky, not a real regression — someone reruns the failed job by hand and it passes. This workflow automates that:

- **~4:00am (`detect-and-rerun`)**: scans everything, and for each branch whose latest run failed, calls `rerun-failed-jobs` on that same run and moves on immediately — it does **not** wait for the rerun to finish, and it does **not** post to Chat. The job summary is still written (useful for audit trail), just nobody's expected to be watching it.
- **~6:07am (`report`)**: scans everything again — by now the reruns from two hours earlier have generally had time to finish — and this is the run that posts to Chat.

**No state is passed between the two runs.** `rerun-failed-jobs` doesn't create a new workflow run — it re-executes the failed jobs as a new *attempt* of the same run (GitHub increments that run's `run_attempt` in place). So the 6:07 scan, just by fetching "the latest run for this branch" the same way it always has, sees the outcome of the 4am rerun directly on `run_attempt > 1`, with nothing to correlate across runs:

| `conclusion` at 6:07 | `run_attempt` | Report category |
|---|---|---|
| `success` | 1 | ✅ passing (never needed a retry) |
| `success` | >1 | 🔁✅ recovered after rerun (flaky, fixed on retry) |
| `failure` | >1 | ❌ still failing after rerun (the actually-worth-a-look signal) |
| `failure` | 1 | ❌ new failure, no rerun attempted yet (failed after the 4am scan already ran) |

**Why two scheduled runs instead of one run that triggers reruns and waits?** Some of these builds genuinely take up to ~1–2 hours (checked against real run history, not assumed). A single job blocking on `gh run watch` for that long — for potentially several failing branches — risks GitHub's hard 6-hour-per-job ceiling on hosted runners and burns paid runner-minutes sitting idle polling. Two short scheduled scans (each ~5–10 minutes, same cost as today) let wall-clock time between 4am and 6:07am do the waiting for free instead. The tradeoff: the ~2 hour gap is a guess, not a guarantee — see the note on in-progress reruns below.

**If a rerun is still running at 6:07am**, that branch shows ⏳ / "rerun still running" rather than being misreported as pass or fail — check back on the next report run (or dispatch manually) rather than treating it as resolved either way.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `projects` | Comma-separated project names (e.g. `spring-cloud-build,spring-cloud-config`). Empty checks every project. | No | string |
| `repo_type` | Which flavors to check: `both`, `oss`, or `commercial` | No | choice (default: `both`) |
| `token` | Token with read access, and Actions write access (to trigger reruns), on all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL` | Incoming webhook URL for the Google Chat space/channel to notify. If unset, the notification step logs that it's skipping and the workflow still succeeds — this repo has no other Google Chat integration to follow a convention from, so a plain incoming-webhook `POST` was used. | No |

## Output

The job summary contains one row per project/type/branch combination:

| | Project | Type | Branch | Workflow | Status | Run |
|---|---|---|---|---|---|---|
| ✅ | `spring-cloud-build` | oss | `main` | ci.yml | success | [#12](#) |
| 🔁✅ | `spring-cloud-commons` | oss | `main` | ci.yaml | recovered after rerun | [#20](#) |
| ❌ | `spring-cloud-bus` | commercial | `4.3.x` | ci.yaml | still failing after rerun | [#9](#) |
| ❌ | `spring-cloud-config` | oss | `main` | ci.yml | failure | [#30](#) |
| ❔ | `spring-cloud-sleuth` | commercial | `3.1.x` | - | no runs found | - |

- ✅ latest run succeeded, never needed a retry
- 🔁✅ latest run succeeded, but only after the automatic rerun (`run_attempt > 1`) — listed under **Recovered after rerun**; was flaky, not a real issue
- ❌ latest run failed — listed under **Still failing after rerun** if it had already been retried (`run_attempt > 1`, the actually-worth-a-look case, with "who broke it" details below), or under **New failures (no rerun attempted yet)** if it hasn't been retried yet (failed after the detect-and-rerun scan already ran)
- ⚠️ latest run was cancelled
- 🔄 latest run is still queued/in progress (never retried); ⏳ same, but a rerun *is* in progress — check back on the next report run
- ❔ no `ci-release.yml`, `ci.yml`, or `ci.yaml` run was found for that branch — listed under **No CI runs found** (no blame lookback — see below)

On the **report** run only (never on detect-and-rerun — see [Two-phase](#two-phase-detect-and-rerun-vs-report)), when `SPRING_CLOUD_CORE_CI_GCHAT_WEBHOOK_URL` is set, the same counts plus per-branch details for both the failing and the recovered branches are posted as a Chat message with a `<link|View full report>` back to `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`. Chat uses its own lightweight text formatting (`*bold*`, `<url|text>`) rather than GitHub markdown, so the job summary and the Chat message render the same facts with different syntax.

## Who broke it

On the **report** run only, for every branch whose latest run **failed** (both still-failing-after-rerun and brand-new failures), the `check` job walks backwards through up to the last 100 completed runs of that same workflow (newest-first, which is the API's default order) to find the most recent run that passed and the first run after it that failed — the one where the branch flipped red. It then looks up that run's `head_sha` via `gh api repos/<repo>/commits/<sha>` for the author and commit message. The summary's failing entries gain a second line:

```
- `spring-cloud/spring-cloud-build-commercial`@`4.3.x` — [run #5](#)
  - Failing since **2026-07-20** (9 days, 3 runs) — broke at `abc1234` by **@someuser**: "Break the build"
```

Notes on this:

- **Author** is the commit's linked GitHub `@login` when the commit is associated with a GitHub account, otherwise the raw git author name from the commit.
- **If no passing run is found within the fetched window** (100 completed runs), the branch has been red for at least that long. This is reported as an *approximate* lower bound — e.g. `120 days, 100+ runs` — using the oldest run in that window rather than paging further back. Chronically-red branches are exactly the case where paginating further would be most expensive, so the lookback intentionally stays bounded at one API call's worth of history instead of walking arbitrarily far back.
- **This lookback only runs on the report run, for branches whose latest run failed** — not for every branch in the matrix, not on the detect-and-rerun run (whose findings are about to be re-attempted anyway and are never shown anywhere), and not for `not-found` branches (there's no run history to walk back through in the first place, since none were ever recorded for that workflow on that branch). This keeps the added API cost proportional to how many branches are actually reported red, addressing the extra rate-limit pressure the lookback adds (2 extra `gh api` calls per reported-failing branch: one for run history, one for the commit).

## Notes

- This reports the *latest* run per branch (updated in place by the automatic rerun, if any); it does not trigger new CI runs of its own beyond that rerun.
- **The workflow always exits successfully**, even when branches are failing or not found — see the note in [Description](#description). Watch the job summary or the Chat notification for failures rather than the run's pass/fail status.
- `max-parallel: 8` keeps the fan-out from saturating the runner pool; `fail-fast: false` so one bad lookup does not abandon the rest.
- **The token needs Actions *write* access**, not just read, on every target repository — `rerun-failed-jobs` is a mutating call. `GH_ACTIONS_REPO_TOKEN` already covers this for other workflows in this repo, but it's a step up from what this workflow needed before the detect-and-rerun phase was added; read-only access is no longer sufficient. Contents read access is still needed for commit lookups.
- **A rerun triggered at 4am can still be running (or not yet started) by 6:07am.** The report treats that honestly (⏳ / "rerun still running") rather than guessing; there's no automatic follow-up beyond the next scheduled report run or a manual dispatch.
