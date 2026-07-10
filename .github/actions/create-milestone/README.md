# create-milestone

Creates a milestone with the given title in a GitHub repository if one does not already exist. The step is idempotent — if a milestone with the same title is already present it logs the existing number and exits cleanly.

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `repo` | yes | Full repository path (e.g. `spring-cloud/spring-cloud-config-commercial`) |
| `version` | yes | Milestone title / version string (e.g. `5.0.2.1`) |
| `token` | yes | GitHub token with `repo` scope (needs milestone write access) |

## Usage

```yaml
- name: Checkout
  uses: actions/checkout@v4

- name: Create milestone if missing
  uses: ./.github/actions/create-milestone
  with:
    repo:    spring-cloud/spring-cloud-config-commercial
    version: ${{ steps.setup.outputs.release-version }}
    token:   ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Or from a reusable action reference:

```yaml
- name: Create milestone if missing
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-milestone@main
  with:
    repo:    spring-cloud/spring-cloud-config-commercial
    version: 5.0.2.1
    token:   ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Notes

- The `version` input is used as the milestone **title** exactly as supplied — no `v` prefix is added.
- Milestones are searched by title with `per_page=100`. If a repository has more than 100 open milestones the check may not find an existing one; close old milestones to avoid duplicates in that unlikely case.
- The token must have write access to the target repository's issues (the `repo` scope on a classic PAT, or `issues: write` on a fine-grained PAT).
