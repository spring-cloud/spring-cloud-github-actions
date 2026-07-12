# config/release-train-actions

Project-specific and branch-specific overrides for the `release-train-build` and `release-train-test` composite actions deployed to commercial repositories.

## Overview

When the workflow generator runs for a commercial repository branch, the [`generate-workflows-for-branch`](../../.github/actions/generate-workflows-for-branch/README.md) action copies one of the following sources into the target repo as `.github/actions/release-train-build/action.yml` and `.github/actions/release-train-test/action.yml`:

| Priority | Source (in `spring-cloud-github-actions`) |
|----------|------------------------------------------|
| 1 (branch-specific) | `config/release-train-actions/<project>/<branch>/<action>/action.yml` |
| 2 (project-level) | `config/release-train-actions/<project>/<action>/action.yml` |
| 3 (global default) | `.github/actions/<action>/action.yml` |

`<project>` is the OSS project name — strip `spring-cloud/` and `-commercial` from the full repo name.  
`<branch>` is the exact branch name (e.g. `release/5.0.2.1`). Since branch names can contain `/`, they map to nested directories.  
`<action>` is either `release-train-build` or `release-train-test`.

In addition, `.github/actions/release-train-settings.xml` is copied to the root of the commercial repo as `release-train-settings.xml` so that Maven commands can reference `--settings release-train-settings.xml` without an absolute path.

## Directory structure

```
config/release-train-actions/
  <project>/                         ← project-level overrides
    release-train-build/
      action.yml
    release-train-test/
      action.yml
    <branch>/                        ← branch-specific overrides (nested for branch names with /)
      release-train-build/
        action.yml
      release-train-test/
        action.yml
```

### Example

```
config/release-train-actions/
  spring-cloud-kubernetes/
    release-train-build/
      action.yml    ← used for all branches (adds MAVEN_OPTS to skip image builds)
```

## Adding a project-level override

1. Create `config/release-train-actions/<project>/release-train-build/action.yml` (and/or `release-train-test`).
2. Write a standard composite action. The action will be copied verbatim into the target repo, so you can reference `release-train-settings.xml` from the repo root (it is always present).

   ```yaml
   name: Build Release
   runs:
     using: composite
     steps:
       - name: Build Release
         shell: bash
         env:
           MAVEN_OPTS: "-Dskip.build.image=true"
         run: ./mvnw --batch-mode --settings release-train-settings.xml clean deploy \
                --activate-profiles releaseTrain \
                -DaltDeploymentRepository="release-train::default::file://$(pwd)/deployment-repository" \
                -DskipTests
   ```

3. Run [Run GitHub Actions Workflow Generator](../../.github/workflows/run-github-actions-workflow-generator.README.md) (optionally scoped to the affected project) to deploy the override.

## Adding a branch-specific override

1. Create the nested directory corresponding to the branch name:

   ```
   config/release-train-actions/spring-cloud-foo/release/5.0.2.1/release-train-build/action.yml
   ```

2. Follow the same format as a project-level override.
3. Re-run the generator for that branch.

## Global defaults

The global defaults live at:

- `.github/actions/release-train-build/action.yml`
- `.github/actions/release-train-test/action.yml`

These are used for any project/branch that does not have a matching override in this directory. Edit those files to change the default build/test behaviour for all projects.
