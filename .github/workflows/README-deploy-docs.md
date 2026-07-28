# Deploy Docs Workflow

A reusable GitHub Actions workflow that builds the Antora reference documentation for a Spring Cloud project and publishes it. It is called from the `deploy-docs.yml` workflow on each project's `docs-build` branch, and replaces the near-identical job that was previously copy-pasted onto every one of those branches.

## Description

The workflow is designed to be called via `workflow_call` from a project's `docs-build` branch. It:

- **Detects OSS vs commercial** from the repository name using the [is-commercial-repo](../actions/is-commercial-repo/action.yml) action, so a single caller file works in both
- **Builds the Antora site** with Maven, optionally restricted to a single git ref
- **Publishes** to the public docs host (OSS) or to a GCS bucket (commercial)

OSS and commercial builds differ in exactly two places:

| | OSS | Commercial |
|---|---|---|
| Runner | `ubuntu-latest` | `ubuntu22-2-8` |
| Publish | `rsync-antora-reference` + `bust-cloudflare-antora-cache` | `google-github-actions/auth` + `upload-cloud-storage` |

Every other step runs in both. The commercial-only steps are harmless in OSS repositories because each is a no-op when the credentials it needs are absent:

- **Antora git credentials** — Antora reads `~/.git-credentials` when cloning the content sources listed in `antora-playbook.yml`. Commercial playbooks point at a private repository and need it; OSS playbooks do not. The step is skipped when `GH_ACTIONS_REPO_TOKEN` is unset rather than writing a credential entry with an empty token.
- **Maven settings** — only servers with a non-empty username are written to `settings.xml`, so an OSS build does not get blank credentials for `spring-commercial-snapshot`/`spring-commercial-release`. The step is skipped entirely if no credentials are available at all.
- **Collector cache copy** — skipped unless `build/antora/inject-collector-cache-config-extension/.cache` exists.

## Partial builds (`build_refname`)

By default Antora clones every branch and tag matched by `content.sources` in `antora-playbook.yml` and regenerates the entire doc set. Passing `build_refname` narrows the build to a single ref, which is what makes a push to one branch cheap.

The step fetches the ref, reads the project version out of its `pom.xml` without checking it out, and exports `BUILD_REFNAME` and `BUILD_VERSION`. The `partial-build-extension` bundled with `@springio/antora-extensions` reads those two variables at startup and rewrites the content sources to just that ref.

The trigger workflow on each source branch supplies this: a branch push dispatches with `-f build-refname=<branch>` (partial build), while a tag push dispatches with no input (full build, so the new version appears in the version dropdown).

> **Currently OSS only.** The commercial docs build ignores `build_refname` and always does a full rebuild, matching today's behavior. The input is plumbed through, so enabling it is a one-line change to the step's `if:` condition.

If a project's root `pom.xml` omits a top-level `<version>`, the parent's version is used; if neither is present the build fails with a clear error rather than silently producing an empty `BUILD_VERSION`.

## Inputs

| Input | Description | Required | Type |
|-------|-------------|----------|------|
| `build_refname` | Git refname to build (e.g. `4.3.x`). Empty builds everything. OSS only. | No | string |
| `java_version` | JDK version used to run Antora | No | string (default: `17`) |
| `java_distribution` | Java distribution | No | string (default: `temurin`) |
| `runs_on` | Runner override | No | string (default: `ubuntu22-2-8` for commercial, `ubuntu-latest` otherwise) |
| `build_command` | Command used to generate the site | No | string (default: `./mvnw --no-transfer-progress -B antora -Pdocs`) |
| `timeout_minutes` | Timeout for the Antora build step | No | number (default: `60`) |
| `context_root` | Context root for the Cloudflare cache bust (OSS only) | No | string (default: repository name minus any `-commercial` suffix) |
| `site_path` | Path to the generated site | No | string (default: `target/antora/site`) |
| `commercial_docs_host` | GCS bucket for commercial docs | No | string (default: the `COMMERCIAL_DOCS_HOST` variable) |

## Secrets

All secrets are declared optional so callers can use `secrets: inherit`. Each repository only supplies the ones that apply to it.

| Secret | Description | Used by |
|--------|-------------|---------|
| `GRADLE_ENTERPRISE_SECRET_ACCESS_KEY` | Develocity access key | Both |
| `GH_ACTIONS_REPO_TOKEN` | Token Antora uses to clone private content sources | Commercial |
| `ARTIFACTORY_USERNAME` / `ARTIFACTORY_PASSWORD` | Credentials for `repo.spring.io` | Both |
| `COMMERCIAL_ARTIFACTORY_USERNAME` / `COMMERCIAL_ARTIFACTORY_PASSWORD` | Credentials for the commercial Artifactory repositories | Commercial |
| `DOCS_USERNAME` / `DOCS_HOST` / `DOCS_SSH_KEY` / `DOCS_SSH_HOST_KEY` | rsync target for the public docs host | OSS |
| `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_CACHE_TOKEN` | Cloudflare cache invalidation | OSS |
| `COMMERCIAL_DOCS_GCP_BUCKET_JSON` | GCP service account JSON for the docs bucket | Commercial |

## How It Works

1. **Setup job**: runs [is-commercial-repo](../actions/is-commercial-repo/action.yml) and outputs `commercial` and `base-repo-name`. `base-repo-name` feeds both the OSS `context-root` and the commercial GCS destination path, so neither has to be configured per repository.
2. **Deploy docs job**: checkout (`fetch-depth: 5`) → set up the JDK → optional partial-build setup → Antora git credentials → Maven settings → run Antora → copy the collector cache → publish.

The commercial site is uploaded to `<COMMERCIAL_DOCS_HOST>/<base-repo-name>/reference`.

## Usage

Copy [`examples/deploy-docs.yml`](../../examples/deploy-docs.yml) to the `docs-build` branch of your project as `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy Docs
run-name: ${{ format('{0} ({1})', github.workflow, github.event.inputs.build-refname || 'all') }}

on:
  workflow_dispatch:
    inputs:
      build-refname:
        description: Enter git refname to build (e.g., 4.3.x).
        required: false
  push:
    branches: docs-build

permissions: read-all

jobs:
  deploy-docs:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/deploy-docs.yml@main
    with:
      build_refname: ${{ github.event.inputs.build-refname }}
    secrets: inherit
```

The same file works unchanged in OSS and commercial repositories.

## Notes

- **Pinned action versions.** `uses:` does not accept expressions, so the `spring-io/spring-doc-actions` version is pinned in this workflow rather than exposed as an input. It is currently `v0.0.22`; bumping it here updates every project at once. Prior to centralizing, projects had drifted across `v0.0.11`, `v0.0.13`, `v0.0.15`, `v0.0.21`, and `v0.0.22`.
- **Permissions.** The workflow requests `read-all`. Nothing in either publish path needs write access — the OSS publish is rsync over SSH and the commercial publish authenticates with a service account JSON rather than workload identity federation.
