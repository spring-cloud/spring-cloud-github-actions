# Shared workflow scripts

Helpers required directly by the inline `node` scripts inside workflows, after this
repository is checked out into the runner's workspace.

## Why this is not under `.github/actions`

Everything in `.github/actions` is a `node20` GitHub Action: it has an `action.yml`, npm
dependencies, and a committed `dist/index.js` that [`ncc`](https://github.com/vercel/ncc)
bundles, because an action runs from a *consumer's* checkout where no `npm install` ever
happens.

These files are libraries, not actions. They have no dependencies and no entrypoint — a
workflow step `require`s them by absolute path:

```yaml
env:
  WRAPPER_LIB: ${{ github.workspace }}/ci-actions/.github/scripts/maven-wrapper-properties.js
run: |
  node - << 'JSEOF'
  const W = require(process.env.WRAPPER_LIB);
  JSEOF
```

So there is nothing to bundle. A `dist/` here would be a byte-identical copy of the source
plus one more way for CI to fail.

## `releaser-config.js`

Where the releaser config lives and how to read it: the repository, the branch, the `gh`
fetch, and the `releaser.fixed-versions[...]` parse.

**The repository is always `spring-cloud/spring-cloud-release-commercial`, for OSS trains
too**, and deliberately not derived from whether a release is commercial. That branch holds
the config for every train now, and its train files are plain OSS train files —
`2026_0_0-m1.properties` is `spring-cloud-config=5.1.0-M1` and so on. The OSS repository's
copy stopped at 2025.1.3 and disagrees with reality where the two still overlap: it names
`5.0.3` versions of `spring-cloud-task`, `-netflix`, `-zookeeper` and `-vault` that have no
tags and were never released.

Five places needed this and each carried its own copy. They drifted twice — the properties
file name was upper-cased in two of them, and `spring-release-train-project-ready` was still
reading the OSS repository long after the other four had moved. Callers now keep only their
own error wording, which is the part that genuinely differs.

It has a CLI so composite actions can use it from bash without a second implementation:

```bash
node "$GITHUB_ACTION_PATH/../../scripts/releaser-config.js" 2026.0.0-M1 spring-cloud-config
# -> 5.1.0-M1        (exit 3: no such file; exit 4: project not in it)
```

## `releaser-config-file.js`

The train version to properties file name rule — `2026.0.0-M1` →
`2026_0_0-m1.properties`. The qualifier is lower-cased, the numeric part is not.

Split out from `releaser-config.js` because `update-project-versions` needs the name without
the `gh`-based fetch: it is a `node20` action that resolves the file over
`raw.githubusercontent.com` with a bearer token and has no `gh` available. Also has a CLI,
for the same reason as above.

## `prerelease-rank.js`

The `-M<n>` / `-RC<n>` grammar: ranking a milestone or release candidate against the train
it belongs to (`GA > RC<n> > M<n>`, numerically so `M10` beats `M9`), and advancing a train
to its next release. Shared by the Dependabot milestone and project-board resolution and by
`post-release.yml`, which uses it to name the next round of milestones and boards.

`next(version, promoteTo)` throws on a transition that cannot be meant — a milestone
promoted straight to GA, a release candidate promoted to a release candidate — rather than
returning a version that would go on to name things.

## `boot-compatibility-range.js`

The `compatibilityRange` a `spring-cloud` bom mapping carries on start.spring.io. Anchored
on the numeric base of the Spring Boot version in the release's properties file, with the
floor set by the *phase* rather than that Boot version verbatim, so the bound does not churn
on every milestone.

## `maven-wrapper-properties.js`

The rules by which `update-maven-wrapper.yml` edits `maven-wrapper.properties`. It is shared
because that workflow edits those files from two different places — through the GitHub
contents/git APIs in properties-only mode, and against a real checkout in regenerate mode —
and the two must produce byte-identical results.

It also carries a port of Dependabot's own wrapper-version resolution
(`maven/lib/dependabot/maven/file_parser/wrapper_mojo.rb`): `wrapperVersion`, then a version
parsed out of `wrapperUrl`, then the `Apache Maven Wrapper startup script, version X` banner
in `mvnw`. When all three come up empty Dependabot raises *while parsing*, which aborts that
repository's entire update job — no pull requests at all, not merely no wrapper PR. That is
what the workflow's `check_only` mode predicts, and matching Dependabot's logic exactly is
why it can.

## Tests

```bash
cd .github/scripts
npm install
npm test           # or: npm run test:coverage
```

CI runs them in [test-maven-wrapper-properties.yml](../workflows/test-maven-wrapper-properties.yml),
which also extracts every inline `node` heredoc from `update-maven-wrapper.yml` and
syntax-checks it — a syntax error inside a YAML heredoc is otherwise invisible until the
workflow runs against a real repository.

Every module here is covered; `npm test` runs the lot. A workflow that `require`s one of
them **must check the repository out first** — these resolve under
`GITHUB_WORKSPACE`, or under `GITHUB_ACTION_PATH/../../scripts` from inside a composite
action. That is not caught by YAML validation or by the unit tests; it surfaces at runtime
as `Cannot find module`.
