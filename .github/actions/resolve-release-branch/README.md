# Resolve Release Branch Action

Resolves the maintenance branch a given project version belongs to.

## Description

Three workflows need the same answer to the same question — *which branch does this version
live on?* — and until this action existed they each answered it with their own copy of the
same 60 lines. `post-release.yml` needs it to merge a release branch back, `update-versions.yml`
to push a version bump, and `create-oss-release-branch.yml` to know which OSS branch to cut a
release from.

The rule is:

1. Take the version's line and try `<major>.<minor>.x`. If that branch exists, use it.
2. On a **commercial** repository, stop there. Those repositories have no `main` at all —
   `spring-cloud-config-commercial`'s default branch is `4.3.x` — so there is no sane
   fallback to make.
3. Otherwise fall back to `main`, but only after reading `main`'s `pom.xml` and confirming it
   is on the same `<major>.<minor>` line. Without that check a version whose branch has been
   deleted, or a typo, would quietly act on whatever `main` happens to be.

Step 3 is the part worth keeping in one place. It is why a `5.1.0` release of a project whose
`5.1.x` branch does not exist yet correctly resolves to `main`, while a `3.9.9` release of the
same project is refused rather than silently rewriting `main`.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repo` | Full repository path (e.g. `spring-cloud/spring-cloud-config`) | Yes | |
| `version` | The version whose line is wanted. Any qualifier is stripped first, so `5.0.4-SNAPSHOT`, `5.1.0-INTERNAL-SNAPSHOT`, `5.1.0-M1` and `5.0.3` all resolve the same way. | Yes | |
| `commercial` | Repository is a commercial one, so there is no `main` to fall back to | No | `false` |
| `token` | Token with read access to the repository | Yes | |

## Outputs

| Output | Description |
|--------|-------------|
| `branch` | The resolved branch, or empty when `status` is not `ok` |
| `status` | `ok`, `branch-not-found`, or `version-mismatch` |
| `message` | Why, when `status` is not `ok`. Empty otherwise. |

## It reports, it does not fail

An unresolvable branch exits `0` with a non-`ok` status rather than failing the step. Two of
the three callers run this across a matrix of sixteen-odd projects, and one project that
cannot be resolved should appear as a row in the run summary, not take the whole release
down. A caller that targets a single project — `create-oss-release-branch.yml` — checks the
status itself and fails there.

## Usage

```yaml
- name: Resolve target branch
  id: branch
  uses: ./.github/actions/resolve-release-branch
  with:
    repo: spring-cloud/spring-cloud-config
    version: 5.0.4-SNAPSHOT
    commercial: 'false'
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}

- name: Do the work
  if: steps.branch.outputs.status == 'ok'
  run: echo "Working on ${{ steps.branch.outputs.branch }}"
```

## Examples

| Repository | Version | Result |
|---|---|---|
| `spring-cloud-config` | `5.0.5` | `5.0.x` — the branch exists |
| `spring-cloud-config` | `5.1.0` | `main` — no `5.1.x` yet, and `main` is at `5.1.0-SNAPSHOT` |
| `spring-cloud-config` | `5.1.0-M1` | `main` — the qualifier does not change the line |
| `spring-cloud-config` | `3.9.9` | `version-mismatch` — no `3.9.x`, and `main` is not on that line |
| `spring-cloud-config-commercial` | `4.9.9` | `branch-not-found` — commercial, so no `main` fallback |
