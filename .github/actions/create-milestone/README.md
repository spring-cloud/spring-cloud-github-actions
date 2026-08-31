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
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/create-milestone@v1
  with:
    repo:    spring-cloud/spring-cloud-config-commercial
    version: 5.0.2.1
    token:   ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Notes

- The `version` input is used as the milestone **title** exactly as supplied — no `v` prefix is added.
- Milestones are read with `--paginate` and `state=all`. Both matter: titles are not unique, the default `state=open` hides an already-closed milestone with the same title, and repositories past a hundred milestones return the newest ones on a later page.
- **A lookup that fails, fails the step.** The listing is captured and its exit status checked before anything is created: a rate limit, a 5xx, or a token that cannot read the repository would otherwise be indistinguishable from "no such milestone", and creating while blind is the only way this action can produce a duplicate.
- Titles are compared with surrounding whitespace trimmed, so a milestone titled `2026.0.0-M1 ` counts as the existing `2026.0.0-M1` rather than being duplicated.
- A repository that already has more than one milestone with the requested title gets a warning naming every number. Nothing is created, and nothing here tries to merge them.
- The token must have write access to the target repository's issues (the `repo` scope on a classic PAT, or `issues: write` on a fine-grained PAT).
