'use strict';

// The name of a jenkins-releaser-config properties file for a release train version.
//
// Six places needed this rule and each carried its own copy, in two languages, under a
// comment saying it had to stay identical to the others. It did not: post-release.yml and
// spring-release-train-project-ready built 2026_0_0-M1.properties while the action that
// actually reads the file resolved 2026_0_0-m1.properties, so a milestone release validated
// one file and stamped from another. That drift was invisible for years because a GA version
// carries no qualifier at all, which is exactly the case every copy agreed on.
//
// Required by the inline node scripts in the workflows, by update-project-versions, and -
// through the CLI at the bottom - by the composite actions that need it from bash.

// Lower-cases a pre-release qualifier and leaves the numeric part alone, then swaps dots for
// underscores:
//
//   2026.0.0                    -> 2026_0_0.properties
//   2026.0.0-M1                 -> 2026_0_0-m1.properties
//   2026.0.0-RC2                -> 2026_0_0-rc2.properties
//   2026.0.0-SNAPSHOT           -> 2026_0_0-snapshot.properties
//   2026.0.0-INTERNAL-SNAPSHOT  -> 2026_0_0-internal-snapshot.properties
//   2025.1.2.1                  -> 2025_1_2_1.properties
//
// The qualifier is everything from the first `-` followed by a letter, so the whole of
// -INTERNAL-SNAPSHOT is lower-cased rather than just its first word.
const releaserConfigFileName = version => String(version).trim()
  .replace(/-([a-zA-Z].*)$/, (_, q) => '-' + q.toLowerCase())
  .replace(/\./g, '_') + '.properties';

module.exports = { releaserConfigFileName };

// CLI, so a composite action's bash can call this rather than reimplement it:
//
//   file=$(node "$GITHUB_ACTION_PATH/../../scripts/releaser-config-file.js" "$train")
//
// Guarded on require.main so importing the module never runs it.
if (require.main === module) {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('usage: releaser-config-file.js <release-train-version>\n');
    process.exit(2);
  }
  process.stdout.write(releaserConfigFileName(version) + '\n');
}
