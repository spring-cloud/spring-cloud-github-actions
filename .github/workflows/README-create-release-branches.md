# create-release-branches

Runs one of the single-project branch-creation workflows for every project in a release train that doesn't have its release branch yet. Instead of dispatching `create-oss-release-branch`, `create-commercial-release-branch` or `create-hotfix-release-branch` once per project, dispatch this once per train.

## What it does

1. **Plans** — reads the train's properties file from `spring-cloud-release-commercial@jenkins-releaser-config` (the same file the chosen workflow reads), and for each project derives the branch that workflow would create. A project is skipped if a `v<version>` tag exists in either the OSS or the `-commercial` repo (that version has already been released, e.g. a project this train isn't releasing whose entry still names its previous release), or if the branch already exists in `spring-cloud/<project>-commercial`. Only the rest are kept. The result is written to the step summary as *To create* and *Skipped*, with a reason for each skip.
2. **Creates** — for each remaining project, dispatches the chosen workflow, waits for it, and records the run in the step summary. Up to 5 run at once; a failure in one doesn't stop the others, but fails this run.

Because released versions and existing branches are skipped, re-running with the same inputs after a partial failure only picks up what's left.

The plan logic is [`release-branch-plan.js`](../scripts/release-branch-plan.js).

## Modes

| Mode | Properties file | Branch (and `v<version>` tag) checked | Projects included |
|------|-----------------|----------------|-------------------|
| `create-oss-release-branch` | `<train>-INTERNAL-SNAPSHOT` (the `-M<n>`/`-RC<n>` phase is stripped for the lookup) | `release/<x.y.z>[-M1\|-RC2]` | every project |
| `create-commercial-release-branch` | `<train>` | `release/<x.y.z>` | every project; the source branch is resolved per project with `resolve-release-branch` |
| `create-hotfix-release-branch` | `<train>` | `release/<x.y.z.h>` | only projects with a 4-segment version (e.g. `5.0.4.1-SNAPSHOT`) |

Every key in the file is a project except `spring-boot` and `spring-vault`. `spring-cloud-release` is a project like the rest.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `mode` | yes | — | Which workflow to run for each project (drop-down) |
| `spring_cloud_release_train` | yes | — | Spring Cloud release train, e.g. `2026.1.0` or `2026.0.0-M1` (OSS), `2025.1.2` (hotfix) |
| `spring_release_train` | yes | — | Spring release train every project joins, e.g. `2026.1` |
| `use_tag` | no | `false` | Hotfix only: create each branch from its OSS tag instead of the `-internal` branch |
| `sha` | no | Triggering commit | OSS and hotfix only: commit of this repo to copy release-train action files from |

## Usage

```bash
gh workflow run create-release-branches.yml \
  -f mode=create-oss-release-branch \
  -f spring_cloud_release_train=2026.1.0 \
  -f spring_release_train=2026.1
```

## Related workflows

| Workflow | Use when |
|----------|----------|
| [`create-oss-release-branch`](create-oss-release-branch.yml) | Cutting one project's OSS release branch |
| [`create-commercial-release-branch`](create-commercial-release-branch.yml) | Cutting one project's commercial release branch |
| [`create-hotfix-release-branch`](README-create-hotfix-branch.md) | Cutting one project's hotfix branch |
