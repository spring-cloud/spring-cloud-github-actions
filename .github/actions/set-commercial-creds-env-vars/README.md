# set-commercial-creds-env-vars

Sets `COMMERCIAL_ARTIFACTORY_USERNAME` and `COMMERCIAL_ARTIFACTORY_PASSWORD`
environment variables for the remainder of the job, choosing between
read/write and read-only credentials based on what is available.

## Why this exists

Commercial CI builds have access to full read/write Artifactory credentials
(`COMMERCIAL_ARTIFACTORY_USERNAME` / `COMMERCIAL_ARTIFACTORY_PASSWORD`).
PR builds from forks only have access to read-only credentials
(`ARTIFACTORY_USERNAME` / `ARTIFACTORY_PASSWORD`). This action centralises
the fallback logic so individual job steps do not need to handle it.

## What it does

- If `PASSWORD` is non-empty → sets `COMMERCIAL_ARTIFACTORY_PASSWORD` to `PASSWORD`.
- If `PASSWORD` is empty → sets `COMMERCIAL_ARTIFACTORY_PASSWORD` to `RO_PASSWORD`.
- Same logic applies for `USERNAME` / `RO_USERNAME`.

The variables are written to `$GITHUB_ENV` and are therefore available to all
subsequent steps in the job.

## Inputs

This action has no declared inputs. Credentials are passed via `env` on the
step rather than `with`, so they are never exposed in the Actions UI.

## Usage

```yaml
- name: Set commercial credentials
  env:
    PASSWORD:    ${{ secrets.COMMERCIAL_ARTIFACTORY_PASSWORD }}
    RO_PASSWORD: ${{ secrets.ARTIFACTORY_PASSWORD }}
    USERNAME:    ${{ secrets.COMMERCIAL_ARTIFACTORY_USERNAME }}
    RO_USERNAME: ${{ secrets.ARTIFACTORY_USERNAME }}
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/set-commercial-creds-env-vars@main

- name: Build
  run: ./mvnw verify
  # COMMERCIAL_ARTIFACTORY_USERNAME and COMMERCIAL_ARTIFACTORY_PASSWORD
  # are now available as environment variables
```
