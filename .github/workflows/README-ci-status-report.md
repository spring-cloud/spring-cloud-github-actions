# CI Status Report Workflow

A workflow, runnable on demand or on a schedule, that checks the latest `ci.yml`/`ci.yaml` workflow run for every OSS and commercial branch of every Spring Cloud project, so a branch whose CI has quietly started failing is visible in one place instead of being discovered branch-by-branch.

## Description

It:

1. **Builds a matrix** from [`config/projects.json`](../../config/projects.json), expanding each project's `oss` and/or `commercial` section into one entry per branch listed under `branches.scheduled` (the full set of maintained branches, not just the `default` one)
2. **Looks up the latest run** of that branch's CI workflow via `gh api repos/<repo>/actions/workflows/<file>/runs?branch=<branch>`, trying `ci.yml` then `ci.yaml`
3. **For branches whose latest run failed**, walks back through that workflow's run history to find when it broke and who broke it (see [Who broke it](#who-broke-it) below)
4. **Writes a summary table** to the job summary showing pass/fail/pending/not-found per project, type, and branch
5. **Posts a notification to Google Chat** (if configured) with the pass/fail counts and a link back to the run

## Triggers

- **`workflow_dispatch`** — run on demand with the inputs below.
- **`schedule`** — weekdays at ~6:07am US Eastern time, in addition to manual dispatch. Since GitHub Actions cron always runs in UTC and has no notion of DST, this is two cron entries selected by month — one at the UTC-4 offset (EDT, March–October) and one at UTC-5 (EST, November–February). The real US DST boundary (2nd Sunday in March / 1st Sunday in November) falls mid-month, so for a few days each side of it the scheduled run fires an hour early or late local time; that's an accepted tradeoff for a status report rather than something worth a date-computing workaround. There's no other scheduled workflow in this repo with a DST convention to follow — [`examples/deploy.yml`](../../examples/deploy.yml)'s schedule runs at a fixed UTC time without accounting for DST at all. Scheduled runs use the input defaults (all projects, `both` repo types, `GH_ACTIONS_REPO_TOKEN`).
- The minute is `:07` rather than `:00` — GitHub's docs flag the top of the hour as the most congested time for scheduled workflows and recommend an off-the-hour minute to reduce the chance of a delayed or dropped run. (The first scheduled run after this workflow was added, at `:00`, never appeared in the run history — see the investigation this change came out of.)

**The workflow itself always succeeds**, regardless of how many branches are failing or not found — its job is to report status, not to gate anything. Failures and not-found branches are still called out clearly in the job summary (and in the Chat notification), just without turning the run red.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `projects` | Comma-separated project names (e.g. `spring-cloud-build,spring-cloud-config`). Empty checks every project. | No | string |
| `repo_type` | Which flavors to check: `both`, `oss`, or `commercial` | No | choice (default: `both`) |
| `token` | Token with read access to all target repos. Falls back to `GH_ACTIONS_REPO_TOKEN`. | No | string |

## Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `GOOGLE_CHAT_WEBHOOK_URL` | Incoming webhook URL for the Google Chat space/channel to notify. If unset, the notification step logs that it's skipping and the workflow still succeeds — this repo has no other Google Chat integration to follow a convention from, so a plain incoming-webhook `POST` was used. | No |

## Output

The job summary contains one row per project/type/branch combination:

| | Project | Type | Branch | Workflow | Status | Run |
|---|---|---|---|---|---|---|
| ✅ | `spring-cloud-build` | oss | `main` | ci.yml | success | [#12](#) |
| ❌ | `spring-cloud-build` | commercial | `4.3.x` | ci.yaml | failure | [#5](#) |
| ❔ | `spring-cloud-sleuth` | commercial | `3.1.x` | - | no runs found | - |

- ✅ latest run succeeded
- ❌ latest run failed — listed again under a **Failing** section with a direct link and, when available, the "who broke it" details below
- ⚠️ latest run was cancelled
- 🔄 latest run is still queued/in progress
- ❔ no `ci.yml` or `ci.yaml` run was found for that branch — listed under **No CI runs found** (no blame lookback — see below)

When `GOOGLE_CHAT_WEBHOOK_URL` is set, the same pass/fail/not-found counts and the same per-branch failing details (including blame, if found) are posted as a Chat message with a `<link|View full report>` back to `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`. Chat uses its own lightweight text formatting (`*bold*`, `<url|text>`) rather than GitHub markdown, so the job summary and the Chat message render the same facts with different syntax.

## Who broke it

For every branch whose latest run **failed**, the `check` job walks backwards through up to the last 100 completed runs of that same workflow (newest-first, which is the API's default order) to find the most recent run that passed and the first run after it that failed — the one where the branch flipped red. It then looks up that run's `head_sha` via `gh api repos/<repo>/commits/<sha>` for the author and commit message. The summary's **Failing** entries gain a second line:

```
- `spring-cloud/spring-cloud-build-commercial`@`4.3.x` — [run #5](#)
  - Failing since **2026-07-20** (9 days, 3 runs) — broke at `abc1234` by **@someuser**: "Break the build"
```

Notes on this:

- **Author** is the commit's linked GitHub `@login` when the commit is associated with a GitHub account, otherwise the raw git author name from the commit.
- **If no passing run is found within the fetched window** (100 completed runs), the branch has been red for at least that long. This is reported as an *approximate* lower bound — e.g. `120 days, 100+ runs` — using the oldest run in that window rather than paging further back. Chronically-red branches are exactly the case where paginating further would be most expensive, so the lookback intentionally stays bounded at one API call's worth of history instead of walking arbitrarily far back.
- **This lookback only runs for branches whose latest run failed** — not for every branch in the matrix, and not for `not-found` branches (there's no run history to walk back through in the first place, since none were ever recorded for that workflow on that branch). This keeps the added API cost proportional to how many branches are actually red, addressing the extra rate-limit pressure the lookback adds (2 extra `gh api` calls per failing branch: one for run history, one for the commit).

## Notes

- This only reports the *latest* run per branch; it does not trigger new CI runs.
- **The workflow always exits successfully**, even when branches are failing or not found — see the note in [Description](#description). Watch the job summary or the Chat notification for failures rather than the run's pass/fail status.
- `max-parallel: 8` keeps the fan-out from saturating the runner pool; `fail-fast: false` so one bad lookup does not abandon the rest.
- The token needs at minimum read access to Actions and Contents (for commit lookups) on every target repository (`GH_ACTIONS_REPO_TOKEN` already covers this for other workflows in this repo).
