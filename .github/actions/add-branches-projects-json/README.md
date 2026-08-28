# add-branches-projects-json

Registers newly created release line branches in
[`config/projects.json`](../../../config/projects.json), so scheduled builds start
covering them.

The mirror image of
[`retire-branch-projects-json`](../retire-branch-projects-json/README.md), and it
resolves the project entry and section the same way. It takes the whole set of
branches for a release train **at once**: a train rollover touches ~30 repositories,
and doing this inside a matrix would have those jobs racing to push to this
repository's `main`.

## Behaviour

For each addition, the project key comes from the repository name (org prefix and
`-commercial` suffix stripped) and the section from the suffix — `commercial` for
`-commercial` repositories, `oss` for everything else. Then:

1. The branch is added to the front of `<section>.branches.scheduled` if it is not
   already there.
2. `<section>.jdkVersions[branch]` is set to a **copy** of the source branch's list,
   falling back to the section's `default`, then to the matching section of the
   global `defaults` entry, then to `["17", "21"]`.
3. `branches.default` is left alone. A new release line branch is a maintenance
   line; the branch it was cut from stays the default.
4. A project with no entry in `projects.json` gets one, deep-copied from
   `defaults.<section>`. It is copied rather than shared on purpose:
   `update-projects-json` hands out the shared `defaults` object and then mutates
   it, silently rewriting the fallback every other project relies on.

Every step is a no-op when it has already been applied, so a re-run of a partially
successful rollout makes no commit. All the additions land as a single commit on
`main`.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `additions` | yes | | JSON array of `{"repo": …, "branch": …, "sourceBranch": …}`. `sourceBranch` defaults to `main` |
| `commit-message` | no | `Update projects.json: register N new branch(es)` | Commit message |
| `dry-run` | no | `false` | Write the file and capture the patch, commit and push nothing |
| `token` | yes | | Token with `contents: write` on `spring-cloud-github-actions` |

## Outputs

| Name | Description |
|---|---|
| `changed` | `true` when `projects.json` was modified |
| `patch` | The diff of the staged change, empty when nothing changed |

## Example

```yaml
- uses: ./.github/actions/add-branches-projects-json
  with:
    additions: >-
      [{"repo":"spring-cloud/spring-cloud-config","branch":"5.0.x","sourceBranch":"main"}]
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Used by [`setup-next-release-train.yml`](../../workflows/README-setup-next-release-train.md).

## Development

```bash
npm ci
npm test
npm run build   # rebuilds dist/index.js — verify-dist.yml fails if it is not committed
```
