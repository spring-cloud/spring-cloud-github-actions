# update-projects-json

Updates `config/projects.json` in the `spring-cloud-github-actions` repository
when a new commercial branch is initialized. Designed to run as part of the
[`initialize-commercial-branch`](../../workflows/initialize-commercial-branch.yml) workflow.

## What it does

The project entry is located using the OSS repository name (org prefix and
`-commercial` suffix are stripped). If no project-specific entry exists the
`defaults` entry is used instead.

For the resolved project the action:

1. Adds the new commercial branch to `commercial.branches.scheduled`.
2. Optionally updates `commercial.branches.default` to the new branch when
   `set-default-branch` is `true`.
3. Copies `jdkVersions` from the OSS entry into the `commercial` section,
   resolving hotfix branches against their parent branch.
4. Removes the OSS branch from the OSS entry (skipped for hotfix branches, and
   when `remove-oss-branch` is `false`).
5. Commits the updated `projects.json` to the `main` branch of
   `spring-cloud-github-actions` with the message:
   `Update projects.json: add <project> commercial branch <branch>`

No commit is made if the JSON is unchanged.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `oss-repo` | yes | — | OSS repository (`org/repo-name`) |
| `oss-branch` | no | `''` | OSS branch being copied. Leave empty for hotfix branches (use `oss-tag` instead). |
| `commercial-branch` | yes | — | New commercial branch name |
| `set-default-branch` | no | `false` | Set to `true` to update `commercial.branches.default` to the new branch |
| `remove-oss-branch` | no | `true` | Set to `false` to keep the OSS branch in `oss.branches.scheduled` and `oss.jdkVersions`. Used for `-internal` branches, which mirror an OSS branch that keeps building rather than replacing it. |
| `token` | yes | — | GitHub token with `contents: write` on `spring-cloud-github-actions` |

## Usage

```yaml
- name: Update projects.json
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/update-projects-json@main
  with:
    oss-repo: spring-cloud/spring-cloud-build
    oss-branch: 4.3.x
    commercial-branch: 4.3.x
    set-default-branch: 'true'
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

- [`retire-branch-projects-json`](../retire-branch-projects-json/README.md) — removes a branch from `projects.json` when it is retired
