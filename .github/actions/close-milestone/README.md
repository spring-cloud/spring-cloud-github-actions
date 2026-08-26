# close-milestone

Closes the milestone with the given title, optionally moving any issues still open in it to another milestone first. The step is idempotent and forgiving — a milestone that is missing or already closed is reported and skipped rather than failing, so it is safe to run after a tag has already been pushed.

## Inputs

| Name | Required | Description |
|------|----------|-------------|
| `repo` | yes | Full repository path (e.g. `spring-cloud/spring-cloud-github-actions`) |
| `version` | yes | Milestone title / version string to close (e.g. `1.0.0`) |
| `migrate-to` | no | Title of the milestone to move still-open issues into before closing. Must already exist. Empty (default) closes without moving anything. |
| `token` | yes | GitHub token with `repo` scope (needs milestone and issue write access) |
| `dry-run` | no | Report what would happen without changing anything. Defaults to `false`. |

## Usage

```yaml
- name: Checkout
  uses: actions/checkout@v4

- name: Close the released milestone
  uses: ./.github/actions/close-milestone
  with:
    repo:       ${{ github.repository }}
    version:    1.0.0
    migrate-to: 1.1.0
    token:      ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Or from a reusable action reference:

```yaml
- name: Close the released milestone
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/close-milestone@v1
  with:
    repo:    spring-cloud/spring-cloud-github-actions
    version: 1.0.0
    token:   ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Notes

- The `version` input is the milestone **title** exactly as supplied — no `v` prefix is added or stripped. Spring Cloud milestone titles are bare version numbers, so a `v1.0.0` tag pairs with a `1.0.0` milestone.
- **Create the `migrate-to` milestone before calling this action.** If it does not exist the step fails rather than silently stranding the issues; [create-milestone](../create-milestone/README.md) is idempotent, so calling it first is always safe.
- Open pull requests are moved along with open issues — the GitHub issues API returns both, and a PR still targeting the released milestone should roll forward the same way an issue does.
- Milestones are read with `--paginate` and `state=all`. Both matter: titles are not unique, the default `state=open` hides an already-closed milestone, and repositories past a hundred milestones return the newest ones on a later page.
- Without `migrate-to`, open issues are left in the closed milestone and a warning is emitted — GitHub permits this, but the work is easy to lose track of.
