# generate-workflows-for-branch

Composite action that copies release-train action files, runs the [github-actions-workflow-generator](https://github.com/spring-io/github-actions-workflow-generator) against a specific repository branch, and commits any changes.

Used by both [`run-github-actions-workflow-generator.yml`](../../workflows/run-github-actions-workflow-generator.README.md) (via a matrix) and [`create-hotfix-branch.yml`](../../workflows/README-create-hotfix-branch.md) (for on-demand generation of a single branch).

## What It Does

1. Resolves the generator version (latest release or the `generator-version` input).
2. Downloads the generator JAR.
3. Clones the target repo at the specified branch.
4. Copies release-train action files using the three-level lookup described in [Release Train Actions](#release-train-actions).
5. Copies `release-train-settings.xml` to the root of the cloned repo.
6. Runs the generator JAR, producing/updating `.github/workflows/release-train-*.yml`.
7. Commits and pushes any changes with `[skip actions]` in the message so intermediate commits do not trigger CI.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `repo` | yes | — | Full repository path (e.g. `spring-cloud/spring-cloud-stream-commercial`) |
| `branch` | yes | — | Branch to generate workflows for (e.g. `release/5.0.2.1`) |
| `primary-jdk` | no | `17` | Primary JDK version passed to the generator. Use `8` for JDK 8 projects. |
| `generator-version` | no | Latest release | Specific version of the generator JAR to use (e.g. `0.0.5`). |
| `token` | yes | — | GitHub token with write access to the target repository. |

## Outputs

| Output | Description |
|--------|-------------|
| `changed` | `'true'` if workflow files were changed and pushed, `'false'` otherwise. |

## Release Train Actions

The action files placed in the target repo are chosen using a three-level lookup (first match wins):

| Priority | Source path |
|----------|-------------|
| 1 (branch-specific) | `config/release-train-actions/<project>/<branch>/<action>/action.yml` |
| 2 (project-level) | `config/release-train-actions/<project>/<action>/action.yml` |
| 3 (global default) | `.github/actions/<action>/action.yml` |

`<project>` is the OSS project name (without `spring-cloud/` prefix and `-commercial` suffix).  
`<action>` is `release-train-build` or `release-train-test`.

This checkout of `spring-cloud-github-actions` must be on the calling runner before this action executes (use `actions/checkout@v4` with the desired `ref`). The `config/release-train-actions/` directory and `.github/actions/` directory are read from that checkout.

## Usage

### In a workflow with an `actions/checkout` step

```yaml
- name: Checkout spring-cloud-github-actions
  uses: actions/checkout@v4
  # Optionally specify a ref/sha to pin the action files source

- name: Generate workflows for branch
  uses: ./.github/actions/generate-workflows-for-branch
  with:
    repo:        spring-cloud/spring-cloud-stream-commercial
    branch:      release/4.1.5.1
    primary-jdk: '17'
    token:       ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### Checking the output

```yaml
- name: Generate workflows for branch
  id: gen
  uses: ./.github/actions/generate-workflows-for-branch
  with:
    repo:   spring-cloud/spring-cloud-foo-commercial
    branch: release/5.0.2.1
    token:  ${{ secrets.GH_ACTIONS_REPO_TOKEN }}

- name: Report
  run: echo "Changed: ${{ steps.gen.outputs.changed }}"
```

## Adding Project-Level Action Overrides

To customise `release-train-build` or `release-train-test` for a specific project, add an `action.yml` under `config/release-train-actions/`:

```
config/release-train-actions/
  spring-cloud-kubernetes/
    release-train-build/
      action.yml    ← applies to every branch of spring-cloud-kubernetes-commercial
```

For a branch-specific override:

```
config/release-train-actions/
  spring-cloud-foo/
    release/
      5.0.2.1/
        release-train-test/
          action.yml    ← only used for this exact branch
```

After adding the override, run [Run GitHub Actions Workflow Generator](../../workflows/run-github-actions-workflow-generator.README.md) to deploy it.
