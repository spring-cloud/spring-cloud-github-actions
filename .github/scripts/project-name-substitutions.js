'use strict';

// Maps a project's own name/artifactId to the key the jenkins-releaser-config properties
// file actually uses for it, for the handful of cases where they differ — most notably
// spring-cloud-release's root pom.xml artifactId is the historical spring-cloud-starter-build,
// not spring-cloud-release.
//
// This is the canonical source for the map update-project-versions defaults its
// project-version-substitutions input to (for resolving dependency property names, e.g.
// gradle's verifierVersion -> spring-cloud-contract) — update-project-versions/src/index.js
// imports it directly, and ncc bundles this require into dist/, so the published action
// stays standalone (same pattern as releaser-config-file.js). A change here needs
// `npm run build` in .github/actions/update-project-versions before it takes effect there.
//
// Also used directly (no build step) by create-hotfix-release-branch.yml's derive job,
// which needs to resolve a project's own name from its root pom.xml artifactId before any
// directory exists to run update-project-versions against.
const PROJECT_NAME_SUBSTITUTIONS = {
  'spring-cloud-dependencies-parent': 'spring-cloud-build',
  'spring-boot-starter-parent': 'spring-boot',
  'spring-cloud-starter-build': 'spring-cloud-release',
  'spring-cloud': 'spring-cloud-release',
  'verifier': 'spring-cloud-contract',
  'springBoot': 'spring-boot',
};

// Resolves a single name through the map, unchanged if it isn't a known special case.
const resolveProjectName = name => PROJECT_NAME_SUBSTITUTIONS[name] || name;

module.exports = { PROJECT_NAME_SUBSTITUTIONS, resolveProjectName };

// CLI, so a composite action's bash can call this rather than reimplement it:
//
//   project_name=$(node "$GITHUB_ACTION_PATH/../../scripts/project-name-substitutions.js" "$name")
//
// Guarded on require.main so importing the module never runs it.
if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    process.stderr.write('usage: project-name-substitutions.js <name>\n');
    process.exit(2);
  }
  process.stdout.write(resolveProjectName(name) + '\n');
}
