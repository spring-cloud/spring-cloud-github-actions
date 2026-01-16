# Determine Build Matrix Action

A composite GitHub Action that determines branches and JDK versions for Spring Cloud project builds based on centralized configuration.

## Description

This action reads project configuration from `config/projects.json` in the spring-cloud-github-actions repository and generates a build matrix suitable for GitHub Actions matrix strategy. It supports:

- OSS and commercial repository variants
- Per-project and default configurations
- Scheduled builds (multiple branches) vs single-branch builds
- JDK version mapping per branch
- Detection of JDK 8 availability for deployment logic

## Requirements

- Runs on: `ubuntu-latest` (or any runner with `jq` available)
- Requires: `jq` command-line JSON processor (pre-installed on GitHub-hosted runners)

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository` | Repository name in format `org/repo-name` | Yes | - |
| `event-name` | GitHub event name (schedule, push, workflow_dispatch, etc.) | Yes | - |
| `ref-name` | Git ref name (branch name) | Yes | - |
| `branch` | Optional branch override for single-branch builds | No | `''` |
| `config-ref` | Git ref for spring-cloud-github-actions config | No | `main` |

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `matrix` | JSON matrix for GitHub Actions matrix strategy | `[{"branch":"main","java-version":"17","has-jdk8":false}]` |
| `branches` | Comma-separated list of branches being built | `main,3.3.x,3.2.x` |
| `branch-jdk-mapping` | JSON object mapping branches to JDK versions | `{"main":["17","21","25"],"3.3.x":["17","21"]}` |

## Usage

### Basic Usage

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.determine-matrix.outputs.matrix }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Determine build matrix
        id: determine-matrix
        uses: ./.github/actions/determine-matrix
        with:
          repository: ${{ github.repository }}
          event-name: ${{ github.event_name }}
          ref-name: ${{ github.ref_name }}
          branch: ${{ inputs.branch }}

  build:
    needs: setup
    strategy:
      matrix:
        include: ${{ fromJson(needs.setup.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ matrix.branch }}
      - uses: actions/setup-java@v4
        with:
          java-version: ${{ matrix.java-version }}
      # ... build steps ...
```

### Usage from Other Repositories

Other Spring Cloud repositories can reference this action:

```yaml
- name: Determine build matrix
  id: determine-matrix
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/determine-matrix@main
  with:
    repository: ${{ github.repository }}
    event-name: ${{ github.event_name }}
    ref-name: ${{ github.ref_name }}
    branch: ${{ inputs.branch }}
```

### Using Additional Outputs

```yaml
- name: Determine build matrix
  id: determine-matrix
  uses: ./.github/actions/determine-matrix
  with:
    repository: ${{ github.repository }}
    event-name: ${{ github.event_name }}
    ref-name: ${{ github.ref_name }}
    branch: ${{ inputs.branch }}

- name: Display build info
  run: |
    echo "Building branches: ${{ steps.determine-matrix.outputs.branches }}"
    echo "Branch-JDK mapping: ${{ steps.determine-matrix.outputs.branch-jdk-mapping }}"
```

### Testing with Feature Branch Config

```yaml
- name: Determine build matrix
  id: determine-matrix
  uses: ./.github/actions/determine-matrix
  with:
    repository: ${{ github.repository }}
    event-name: ${{ github.event_name }}
    ref-name: ${{ github.ref_name }}
    branch: ${{ inputs.branch }}
    config-ref: 'feature/new-config-structure'  # Use feature branch config
```

## Configuration

The action reads configuration from `config/projects.json` in the spring-cloud-github-actions repository. The configuration structure is:

```json
{
  "project-name": {
    "oss": {
      "branches": {
        "scheduled": ["main", "3.3.x"],
        "default": ["main"]
      },
      "jdkVersions": {
        "main": ["17", "21", "25"],
        "3.3.x": ["17", "21"],
        "default": ["17", "21", "25"]
      }
    },
    "commercial": {
      "branches": {
        "scheduled": ["3.1.x"],
        "default": ["3.1.x"]
      },
      "jdkVersions": {
        "3.1.x": ["8", "11", "17"],
        "default": ["17", "21"]
      }
    }
  },
  "defaults": {
    "oss": { /* fallback config */ },
    "commercial": { /* fallback config */ }
  }
}
```

## How It Works

1. **Repository Detection**: Extracts repository name and detects commercial vs OSS variant
2. **Config Loading**: Checks out spring-cloud-github-actions repo and reads `config/projects.json`
3. **Branch Determination**:
   - For scheduled runs: builds multiple branches from config
   - For other events: builds single branch (from input or ref-name)
4. **JDK Mapping**: Maps each branch to its configured JDK versions
5. **Matrix Generation**: Creates matrix entries for each branch + JDK combination
6. **Additional Outputs**: Generates branches list and branch-jdk-mapping

## Matrix Entry Format

Each matrix entry contains:
- `branch`: Branch name to build
- `java-version`: JDK version to use
- `has-jdk8`: Boolean indicating if this branch configuration includes JDK 8

The `has-jdk8` flag is used downstream to determine which builds should deploy artifacts and generate documentation (typically JDK 8 if available, otherwise JDK 17).

## Example Complete Workflow

```yaml
name: Deploy

on:
  push:
    branches: [main, '*.x']
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to build'
        required: false

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.determine-matrix.outputs.matrix }}
      branches: ${{ steps.determine-matrix.outputs.branches }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Determine build matrix
        id: determine-matrix
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/determine-matrix@main
        with:
          repository: ${{ github.repository }}
          event-name: ${{ github.event_name }}
          ref-name: ${{ github.ref_name }}
          branch: ${{ inputs.branch }}

  build:
    name: Build ${{ matrix.branch }} (JDK ${{ matrix.java-version }})
    needs: setup
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.setup.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ matrix.branch }}

      - uses: actions/setup-java@v4
        with:
          java-version: ${{ matrix.java-version }}
          distribution: 'temurin'

      - name: Build
        run: ./mvnw clean install -B

      - name: Deploy (only on specific JDK)
        if: ${{ env.SHOULD_DEPLOY == 'true' }}
        run: ./mvnw deploy -B
```

## License

Apache License 2.0
