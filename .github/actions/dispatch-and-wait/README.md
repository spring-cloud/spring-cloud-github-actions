# dispatch-and-wait

Dispatches a `workflow_dispatch` workflow, waits for the run to complete, and fails the step unless the run's conclusion is `success`.

Used wherever a workflow starts another one and depends on its result: `release-train-join` from the three branch-creation workflows, `release-train-ready` from `spring-release-train-project-ready`, and each per-project run from `create-release-branches`.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repo` | yes | — | Full repository path of the workflow to run (e.g. `spring-cloud/spring-cloud-config-commercial`) |
| `workflow` | yes | — | Workflow file name (e.g. `release-train-join.yml`) |
| `ref` | yes | — | Branch or tag to run the workflow on |
| `inputs` | no | — | Workflow inputs, one `key=value` per line. Everything after the first `=` is the value, passed as a raw string, so values may contain spaces. Blank lines are ignored. |
| `summary-title` | no | — | When set, appends `<summary-title>: succeeded\|FAILED (<conclusion>) - <run url>` to the job's step summary |
| `interval` | no | `10` | Seconds between status checks |
| `token` | yes | — | GitHub token allowed to dispatch and read workflow runs in `repo` |

## Outputs

| Name | Description |
|------|-------------|
| `run-url` | URL of the dispatched run |
| `conclusion` | Conclusion of the run (`success`, `failure`, `cancelled`, ...) |

## Usage

```yaml
- name: Checkout
  uses: actions/checkout@v4

- name: Trigger release-train-join workflow and wait
  uses: ./.github/actions/dispatch-and-wait
  with:
    repo:     spring-cloud/spring-cloud-config-commercial
    workflow: release-train-join.yml
    ref:      release/5.0.4
    inputs: |
      deployment-destination=Spring Enterprise
      release-train=2026.1
      release-train-repository=spring-io/release-train
    token:    ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Notes

- **The run's conclusion decides the result, not `gh run watch`'s exit status.** Right after dispatch, `gh run watch` can exit non-zero before the run has any jobs, even though the run goes on to succeed. The watch is only used to wait: if it returns before the run is `completed`, the action checks the status and watches again.
- The watch's error output is kept in the log rather than discarded, so an early exit is visible.
- The run id is read from the URL `gh workflow run` prints. If that output isn't a run URL, the step fails rather than waiting on nothing.
