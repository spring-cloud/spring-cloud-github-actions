# Mark Release Train Ready

Runs [`project-ready.yml`](project-ready.yml) for every project in a release train
whose release branch exists and has not been released yet. It is the counterpart of
[Create Release Branches](README-create-release-branches.md), with the check inverted: that
workflow acts on projects whose branch is missing, this one on projects whose branch is there.

There is no mode. Release branches only exist in the `<project>-commercial` repos, and
`project-ready.yml` only operates on them.

## Inputs

| Input | Notes |
|---|---|
| `spring_cloud_release_train` | The train, as named by the properties file: `2026.1.0`, `2026.0.0-RC1`, `2025.1.4.1`. |
| `spring_release_train` | The Spring train every project joins, e.g. `2026.1`. |

## How it works

1. **plan** reads the train's properties file from
   `spring-cloud-release-commercial@jenkins-releaser-config` (`.github/scripts/release-ready-plan.js`).
   For each project the version has `-SNAPSHOT` stripped and the branch is `release/<version>`.
   A project is planned when no `v<version>` tag exists in its OSS or commercial repo and the
   branch exists in `<project>-commercial`. The rest are listed under *Skipped* in the run summary.
2. **ready** dispatches `project-ready.yml` for each planned project
   (`project=<project>-commercial`) and waits for it, 3 at a time. A failing child fails the
   run but does not stop the others. Re-running only picks up what is left.

The properties file is read as given, with no `-INTERNAL-SNAPSHOT` filter, so a project that
the train is not releasing is left out only because its entry names a release that is already
tagged or whose branch is gone. Check the *Skipped* list on an unfamiliar train.

## Concurrent `projects.json` updates

Each child ends by retiring its branch from `config/projects.json`, so the children push to
`main` at the same time. `retire-branch-projects-json` re-applies its change on the latest
`main` and retries when a push is rejected, as `update-projects-json` does.
