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
