# Extract BOM Versions Action

Fetches the Spring Cloud release train BOM (`pom.xml`) directly from GitHub
and exports all version properties (entries ending in `.version`) as both
action outputs and environment variables for use in subsequent workflow steps.

Supports both the public OSS BOM (`spring-cloud-release`) and the private
commercial BOM (`spring-cloud-release-commercial`).

## Usage

### OSS (public repo — no token required)

```yaml
- name: Extract versions from Spring Cloud BOM
  id: extract-versions
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/extract-bom-versions@main
  with:
    ref: '2023.0.x'

# Access as a JSON output via fromJSON()
- name: Print Spring Boot version
  run: |
    echo "Spring Boot: ${{ fromJSON(steps.extract-versions.outputs.versions)['spring-boot'] }}"

# Or use the exported environment variables directly in shell steps
- name: Update POM versions
  run: |
    mvn versions:set -DnewVersion=$RELEASE_TRAIN_VERSION
    mvn versions:set-property -Dproperty=spring-boot.version -DnewValue=$SPRING_BOOT_VERSION
```

### Commercial (private repo — token required)

```yaml
- name: Extract versions from commercial Spring Cloud BOM
  id: extract-versions
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/extract-bom-versions@main
  with:
    ref: '2023.0.x'
    commercial: 'true'
    token: ${{ secrets.COMMERCIAL_GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `ref` | No | `main` | Branch, tag, or SHA to fetch the BOM from (e.g. `2023.0.x`, `2024.0.x`). |
| `commercial` | No | `false` | When `true`, fetches from `spring-cloud-release-commercial`. A `token` with access to that private repo must be supplied. |
| `token` | No* | `github.token` | GitHub token for fetching the BOM. *Required when `commercial` is `true`. |

## Outputs

| Output | Description |
|--------|-------------|
| `versions` | JSON object of all extracted versions keyed by project name, e.g. `{"spring-boot":"3.2.3","spring-cloud-config":"4.1.1"}` |

## Environment Variables

In addition to the `versions` JSON output, each extracted version is also
exported as an environment variable for convenience in shell steps.

Naming convention: `{PROJECT_NAME}_VERSION` (upper snake case)

| BOM property | Environment variable |
|--------------|----------------------|
| `<version>` (release train) | `RELEASE_TRAIN_VERSION` |
| `<spring-boot.version>` | `SPRING_BOOT_VERSION` |
| `<spring-cloud-config.version>` | `SPRING_CLOUD_CONFIG_VERSION` |
| `<spring-cloud-gateway.version>` | `SPRING_CLOUD_GATEWAY_VERSION` |
| `<spring-cloud-kubernetes.version>` | `SPRING_CLOUD_KUBERNETES_VERSION` |
| *(and so on for every `.version` property in the BOM)* | |

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
cd .github/actions/extract-bom-versions
npm install
```

### Running Unit Tests

Unit tests use Jest and run entirely locally — no GitHub Actions context needed:

```bash
npm test

# With coverage report
npm run test:coverage
```

### Building the Dist Bundle

The `dist/index.js` bundle **must be rebuilt and committed** whenever
`src/index.js` is changed. The `dist-up-to-date` CI job will fail on PRs
if you forget.

```bash
npm run build
git add dist/index.js
git commit -m "chore: rebuild dist"
```

### Integration Testing

Push your branch to GitHub and the `Test - Extract BOM Versions` workflow will
run automatically, executing the full integration test against the real
Spring Cloud BOM.
