# trigger-branch-ci

Dispatches the `ci.yml` (or `ci.yaml`) workflow for each branch in a supplied
list. Used after commercial branch initialization to kick off a first CI run
on every non-default branch that was set up.

## What it does

For each branch in `non-default-branches` the action tries to dispatch
`ci.yml` via `gh workflow run`. If `ci.yml` is not found it falls back to
`ci.yaml`. If neither file exists on the branch, or the workflow does not have
a `workflow_dispatch` trigger, the action fails with an error message.

An empty or `[]` branch list is a no-op — the action exits successfully without
dispatching anything.

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `non-default-branches` | yes | JSON array of branch names to dispatch CI for (e.g. `["3.3.x","4.3.x"]`) |
| `repository` | yes | Repository to dispatch workflows in (`org/repo-name`) |
| `token` | yes | GitHub token with `actions: write` permission on the repository |

## Usage

```yaml
- name: Trigger CI for non-default branches
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/trigger-branch-ci@main
  with:
    repository: spring-cloud/spring-cloud-foo-commercial
    non-default-branches: '["3.3.x","4.2.x"]'
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

The `non-default-branches` value is typically produced by the
[determine-matrix](../determine-matrix/README.md) action or constructed from
the output of a prior step.
