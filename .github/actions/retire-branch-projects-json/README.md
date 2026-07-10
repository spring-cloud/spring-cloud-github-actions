# retire-branch-projects-json

Updates `config/projects.json` in the `spring-cloud-github-actions` repository
when a branch is retired. Designed to run as the first step in the
[`retire-branch`](../../workflows/README-retire-branch.md) workflow so that it
can catch configuration errors before any irreversible changes are made.

## Behaviour

The project entry is located using the repository name (org prefix and
`-commercial` suffix are stripped). If no project-specific entry exists the
`defaults` entry is used instead.

Which section is modified depends on the repository:

| Repository type | Section modified |
|---|---|
| `org/spring-cloud-foo-commercial` | `commercial` |
| `org/spring-cloud-foo` | `oss` |

For the resolved section the action:

1. **Fails** (exit 1) if the branch is listed in `branches.default` — prevents
   retiring a branch that is still the active default.
2. **Removes** the branch from `branches.scheduled` if present; logs and skips
   if not found.
3. **Removes** the branch from `jdkVersions` if present; logs and skips if not
   found.
4. Commits the updated `projects.json` to the `main` branch of
   `spring-cloud-github-actions` with the message:
   `Update projects.json: retire <project> branch <branch>`

No commit is made if neither `scheduled` nor `jdkVersions` contained the branch.

## Inputs

| Name | Required | Description |
|---|---|---|
| `repo` | yes | Repository containing the retiring branch (`org/repo-name`) |
| `branch` | yes | Branch being retired |
| `token` | yes | GitHub token with `contents: write` on `spring-cloud-github-actions` |

## Usage

```yaml
- name: Update projects.json
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/retire-branch-projects-json@main
  with:
    repo: spring-cloud/spring-cloud-build-commercial
    branch: 4.1.x
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Development

The action logic lives in `src/index.js` and is bundled with [ncc](https://github.com/vercel/ncc) into `dist/index.js`. The bundle must be committed alongside any source changes.

```bash
# Install dependencies
npm install

# Run tests
npm test

# Rebuild the bundle after editing src/index.js or package.json
npm run build
```

## Related

- [`update-projects-json`](../update-projects-json/README.md) — adds a branch to `projects.json` when a commercial branch is initialized
- [`retire-branch` workflow](../../workflows/README-retire-branch.md)
