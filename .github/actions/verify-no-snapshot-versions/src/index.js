const core = require('@actions/core');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

/**
 * Matches pre-release version suffixes that must not appear in a release build:
 *   -SNAPSHOT      (e.g. 4.1.0-SNAPSHOT)
 *   -RC<N>         (e.g. 3.2.0-RC1)
 *   -M<N>          (e.g. 2023.0.0-M1)
 */
const PRE_RELEASE_PATTERN = /-SNAPSHOT$|-RC\d+$|-M\d+$/i;

function isPreRelease(version) {
  return PRE_RELEASE_PATTERN.test(String(version).trim());
}

async function run() {
  try {
    const directory = path.resolve(core.getInput('directory') || '.');

    if (!fs.existsSync(directory)) {
      core.setFailed(`Directory not found: ${directory}`);
      return;
    }

    const excludePatterns = (core.getInput('exclude-patterns') || '')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => new RegExp(s));

    const allViolations = [];

    const pomFiles = findFiles(directory, 'pom.xml', excludePatterns);
    for (const file of pomFiles) {
      const fileViolations = checkPomFile(file);
      for (const v of fileViolations) {
        allViolations.push({ file: path.relative(directory, file), ...v });
      }
    }

    const gradlePropsFiles = findFiles(directory, 'gradle.properties', excludePatterns);
    for (const file of gradlePropsFiles) {
      const fileViolations = checkGradlePropertiesFile(file);
      for (const v of fileViolations) {
        allViolations.push({ file: path.relative(directory, file), ...v });
      }
    }

    const buildGradleFiles = [
      ...findFiles(directory, 'build.gradle', excludePatterns),
      ...findFiles(directory, 'build.gradle.kts', excludePatterns),
    ];
    for (const file of buildGradleFiles) {
      const fileViolations = checkBuildGradleFile(file);
      for (const v of fileViolations) {
        allViolations.push({ file: path.relative(directory, file), ...v });
      }
    }

    core.setOutput('violations', JSON.stringify(allViolations));

    if (allViolations.length === 0) {
      core.info('All versions are release versions. No pre-release versions found.');
      return;
    }

    core.error(`Found ${allViolations.length} pre-release version(s):`);
    for (const v of allViolations) {
      core.error(`  ${v.file}: ${v.location} = ${v.version}`);
    }
    core.setFailed(
      `${allViolations.length} pre-release version(s) found. All dependencies must use release versions.`
    );
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// ── pom.xml ────────────────────────────────────────────────────────────────

/**
 * Checks a pom.xml file for pre-release versions in:
 *   - The project's own <version>
 *   - The <parent><version>
 *   - All <properties> entries ending in .version
 *   - All <dependency><version> entries (direct and dependency management)
 *   - All <plugin><version> entries (build and plugin management)
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @returns {{ location: string, version: string }[]}
 */
function checkPomFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return checkPomContent(content);
}

/**
 * Scans raw POM XML for elements annotated with <!-- @releaser:version-check-off -->
 * on the same line and returns two sets:
 *
 *   excludedPropertyKeys  – property tag names inside <properties> (e.g. "maven-failsafe-plugin.version")
 *   excludedVersionValues – bare version strings inside <version> tags
 *
 * fast-xml-parser strips comments before we can inspect them, so this pre-scan
 * runs on the raw string.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw XML content of the pom.xml
 * @returns {{ excludedPropertyKeys: Set<string>, excludedVersionValues: Set<string> }}
 */
function extractVersionCheckOffAnnotations(content) {
  const excludedPropertyKeys = new Set();
  const excludedVersionValues = new Set();
  // Matches a single-line element: <tagName>value</tagName> ... <!-- @releaser:version-check-off -->
  const re = /<([a-zA-Z][a-zA-Z0-9.\-_]*)>([^<\n]*)<\/\1>[^\n]*<!--\s*@releaser:version-check-off\s*-->/g;
  for (const match of content.matchAll(re)) {
    const [, tagName, value] = match;
    if (tagName === 'version') {
      excludedVersionValues.add(value.trim());
    } else {
      excludedPropertyKeys.add(tagName);
    }
  }
  return { excludedPropertyKeys, excludedVersionValues };
}

/**
 * Core logic for checking pom.xml content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw XML content of the pom.xml
 * @returns {{ location: string, version: string }[]}
 */
function checkPomContent(content) {
  const { excludedPropertyKeys, excludedVersionValues } = extractVersionCheckOffAnnotations(content);

  const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'dependency' || name === 'plugin' });
  let parsed;
  try {
    parsed = parser.parse(content);
  } catch {
    return [];
  }

  const project = parsed?.project;
  if (!project) return [];

  const violations = [];

  if (project.version && !excludedVersionValues.has(String(project.version).trim()) && isPreRelease(project.version)) {
    violations.push({ location: '<version>', version: String(project.version) });
  }

  if (project.parent?.version && !excludedVersionValues.has(String(project.parent.version).trim()) && isPreRelease(project.parent.version)) {
    violations.push({ location: '<parent><version>', version: String(project.parent.version) });
  }

  const properties = project.properties ?? {};
  for (const [key, value] of Object.entries(properties)) {
    if (excludedPropertyKeys.has(key)) continue;
    if (key.endsWith('.version') && isPreRelease(value)) {
      violations.push({ location: `<properties><${key}>`, version: String(value) });
    }
  }

  checkDependencyVersions(project.dependencies?.dependency, '<dependencies>', violations, excludedVersionValues);
  checkDependencyVersions(
    project.dependencyManagement?.dependencies?.dependency,
    '<dependencyManagement><dependencies>',
    violations,
    excludedVersionValues
  );
  checkPluginVersions(project.build?.plugins?.plugin, '<build><plugins>', violations, excludedVersionValues);
  checkPluginVersions(
    project.build?.pluginManagement?.plugins?.plugin,
    '<build><pluginManagement><plugins>',
    violations,
    excludedVersionValues
  );

  return violations;
}

function checkDependencyVersions(dependencies, context, violations, excludedVersionValues = new Set()) {
  if (!dependencies) return;
  const list = Array.isArray(dependencies) ? dependencies : [dependencies];
  for (const dep of list) {
    if (dep?.version && !excludedVersionValues.has(String(dep.version).trim()) && isPreRelease(dep.version)) {
      const coords = [dep.groupId, dep.artifactId].filter(Boolean).join(':');
      violations.push({
        location: `${context}<dependency>[${coords}]<version>`,
        version: String(dep.version),
      });
    }
  }
}

function checkPluginVersions(plugins, context, violations, excludedVersionValues = new Set()) {
  if (!plugins) return;
  const list = Array.isArray(plugins) ? plugins : [plugins];
  for (const plugin of list) {
    if (plugin?.version && !excludedVersionValues.has(String(plugin.version).trim()) && isPreRelease(plugin.version)) {
      const coords = [plugin.groupId, plugin.artifactId].filter(Boolean).join(':');
      violations.push({
        location: `${context}<plugin>[${coords}]<version>`,
        version: String(plugin.version),
      });
    }
  }
}

// ── gradle.properties ──────────────────────────────────────────────────────

/**
 * Checks a gradle.properties file for pre-release versions.
 *
 * Inspects:
 *   - The bare `version` key (project version)
 *   - Any key ending in `Version` (e.g. springBootVersion, springCloudCommonsVersion)
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @returns {{ location: string, version: string }[]}
 */
function checkGradlePropertiesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return checkGradlePropertiesContent(content);
}

/**
 * Core logic for checking gradle.properties content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw text of the gradle.properties file
 * @returns {{ location: string, version: string }[]}
 */
function checkGradlePropertiesContent(content) {
  const violations = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9.]*)(\s*=\s*)(.+)$/);
    if (!match) continue;

    const [, key, , rawValue] = match;
    const value = rawValue.trim();

    if ((key === 'version' || /Version$/.test(key)) && isPreRelease(value)) {
      violations.push({ location: key, version: value });
    }
  }
  return violations;
}

// ── build.gradle / build.gradle.kts ───────────────────────────────────────

/**
 * Checks a build.gradle or build.gradle.kts file for a pre-release project version.
 *
 * Inspects the `version = '...'` or `version = "..."` declaration.
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @returns {{ location: string, version: string }[]}
 */
function checkBuildGradleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return checkBuildGradleContent(content);
}

/**
 * Core logic for checking build.gradle content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw text of the build.gradle file
 * @returns {{ location: string, version: string }[]}
 */
function checkBuildGradleContent(content) {
  const violations = [];
  const match = content.match(/^version\s*=\s*['"]([^'"]+)['"]/m);
  if (match && isPreRelease(match[1])) {
    violations.push({ location: 'version', version: match[1] });
  }
  return violations;
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Recursively finds all files with the given filename under a directory,
 * skipping common build output and dependency directories, and any file
 * whose path matches one of the provided exclude patterns.
 *
 * @param {string} dir
 * @param {string} filename
 * @param {RegExp[]} excludePatterns - compiled regexes; matching paths are skipped
 *
 * Exported for unit testing.
 */
function findFiles(dir, filename, excludePatterns = []) {
  const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle']);
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const normalizedPath = fullPath.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !excludePatterns.some(re => re.test(normalizedPath + '/'))) {
        results.push(...findFiles(fullPath, filename, excludePatterns));
      }
    } else if (entry.isFile() && entry.name === filename) {
      if (!excludePatterns.some(re => re.test(normalizedPath))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

module.exports = {
  isPreRelease,
  extractVersionCheckOffAnnotations,
  checkPomContent,
  checkGradlePropertiesContent,
  checkBuildGradleContent,
  findFiles,
};

if (require.main === module) {
  run();
}
