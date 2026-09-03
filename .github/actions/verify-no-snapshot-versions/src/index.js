const core = require('@actions/core');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

/**
 * Matches the one suffix that must never appear in any release build, milestone
 * and release candidate included:
 *   -SNAPSHOT      (e.g. 4.1.0-SNAPSHOT)
 */
const SNAPSHOT_PATTERN = /-SNAPSHOT$/i;

/**
 * Matches the pre-release suffixes that are forbidden in a GA build but expected
 * in a milestone or release candidate one:
 *   -RC<N>         (e.g. 3.2.0-RC1)
 *   -M<N>          (e.g. 2023.0.0-M1)
 */
const MILESTONE_PATTERN = /-(RC|M)\d+$/i;

/**
 * Matches values that are shaped like a version number: an optional leading `v`,
 * then a digit, then version characters only (no whitespace, no `/`, no `:`).
 *
 * Used to gate values held under keys that are not explicitly named as versions,
 * so that strings such as `https://repo.spring.io/libs-snapshot` are not mistaken
 * for a pre-release version.
 */
const VERSION_SHAPE_PATTERN = /^v?\d[A-Za-z0-9.\-_+]*$/;

/**
 * Elements whose Maven coordinates are worth showing in a violation location so
 * the offending entry can be found quickly in a large pom.
 */
const COORDINATE_ELEMENTS = new Set(['dependency', 'plugin', 'extension']);

const CHECK_OFF_ANNOTATION = '@releaser:version-check-off';

/**
 * Whether milestone and release-candidate versions are tolerated. Set once from the
 * action input at the top of run(), and read by isPreRelease below.
 *
 * Module state rather than a parameter threaded through checkPomFile, walkPomNode,
 * checkGradlePropertiesContent and the rest: the flag is a property of the run, not of
 * any one file, and passing it down eight signatures would obscure them for no gain.
 * isPreRelease still takes an explicit override so the unit tests need no setup.
 */
let allowPrereleaseVersions = false;

/**
 * True when `version` must not appear in the build being verified.
 *
 * -SNAPSHOT always counts. -M<n> and -RC<n> count only when the run is verifying a GA
 * release: a milestone or release-candidate build legitimately carries a mixture of
 * milestone, release-candidate and GA versions, and rejecting them would fail every
 * pre-release the moment it was stamped.
 *
 * Exported for unit testing.
 */
function isPreRelease(version, allowPrerelease = allowPrereleaseVersions) {
  const value = String(version).trim();
  if (SNAPSHOT_PATTERN.test(value)) return true;
  return !allowPrerelease && MILESTONE_PATTERN.test(value);
}

/**
 * True when a value looks like a version number.
 *
 * Exported for unit testing.
 */
function looksLikeVersion(value) {
  return VERSION_SHAPE_PATTERN.test(String(value).trim());
}

/**
 * True for keys that unambiguously hold a version, in any of the casings used
 * across Maven and Gradle builds:
 *   version, spring-boot.version, spring-boot-version, springBootVersion
 *
 * Values under these keys are always checked. Values under any other key are
 * only checked when they are shaped like a version (see looksLikeVersion).
 *
 * Exported for unit testing.
 */
function isVersionKey(key) {
  return /(^|[.\-_])version$/i.test(key) || /Version$/.test(key);
}

async function run() {
  try {
    const directory = path.resolve(core.getInput('directory') || '.');

    allowPrereleaseVersions = core.getBooleanInput('allow-prerelease');
    if (allowPrereleaseVersions) {
      core.info('allow-prerelease is set: -M<n> and -RC<n> versions are permitted. ' +
        '-SNAPSHOT versions are still rejected.');
    }

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

    const collect = (files, checker) => {
      for (const file of files) {
        for (const v of checker(file)) {
          allViolations.push({ file: path.relative(directory, file), ...v });
        }
      }
    };

    collect(findFiles(directory, 'pom.xml', excludePatterns), checkPomFile);
    collect(findFiles(directory, 'gradle.properties', excludePatterns), checkGradlePropertiesFile);
    collect(
      [
        ...findFiles(directory, 'build.gradle', excludePatterns),
        ...findFiles(directory, 'build.gradle.kts', excludePatterns),
        ...findFiles(directory, 'settings.gradle', excludePatterns),
        ...findFiles(directory, 'settings.gradle.kts', excludePatterns),
      ],
      checkBuildGradleFile
    );

    core.setOutput('violations', JSON.stringify(allViolations));

    if (allViolations.length === 0) {
      core.info(allowPrereleaseVersions
        ? 'No -SNAPSHOT versions found.'
        : 'All versions are release versions. No pre-release versions found.');
      return;
    }

    const noun = allowPrereleaseVersions ? 'SNAPSHOT' : 'pre-release';
    core.error(`Found ${allViolations.length} ${noun} version(s):`);
    for (const v of allViolations) {
      core.error(`  ${v.file}: ${v.location} = ${v.version}`);
    }
    core.setFailed(
      `${allViolations.length} ${noun} version(s) found. ` +
      (allowPrereleaseVersions
        ? 'A milestone or release candidate may depend on -M<n> and -RC<n> versions, ' +
          'but never on a -SNAPSHOT.'
        : 'All dependencies must use release versions.')
    );
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// ── pom.xml ────────────────────────────────────────────────────────────────

/**
 * Checks a pom.xml file for pre-release versions.
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
 *
 * The whole parsed document is walked rather than a fixed list of known
 * locations, so EVERY <version> element is checked no matter where it sits —
 * including places a targeted check misses, such as a version pinned on a
 * plugin's own <dependencies>, or anything declared inside a <profile>.
 *
 * Every entry under any <properties> block is checked too. Keys that name a
 * version outright (foo.version, foo-version, fooVersion, version) are always
 * checked; other keys are only checked when the value is shaped like a version,
 * which keeps values such as repository URLs from being misread.
 *
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw XML content of the pom.xml
 * @returns {{ location: string, version: string }[]}
 */
function checkPomContent(content) {
  const { excludedPropertyKeys, excludedVersionValues } = extractVersionCheckOffAnnotations(content);

  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) =>
      name === 'dependency' || name === 'plugin' || name === 'profile' || name === 'extension',
  });
  let parsed;
  try {
    parsed = parser.parse(content);
  } catch {
    return [];
  }

  const project = parsed?.project;
  if (!project) return [];

  const violations = [];
  walkPomNode(project, [], violations, excludedPropertyKeys, excludedVersionValues);
  return violations;
}

/**
 * Recursively walks a parsed POM node, flagging every pre-release <version>
 * element and every pre-release <properties> entry found beneath it.
 *
 * @param {object} node
 * @param {{ name: string, coords?: string }[]} parts - ancestor element path, root <project> excluded
 * @param {{ location: string, version: string }[]} violations - accumulator
 */
function walkPomNode(node, parts, violations, excludedPropertyKeys, excludedVersionValues) {
  for (const [key, rawValue] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue;

    for (const item of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (key === 'version') {
        const value = scalarValue(item);
        if (value === null || excludedVersionValues.has(value) || !isPreRelease(value)) continue;
        violations.push({
          location: renderLocation(parts, { name: 'version' }),
          version: value,
        });
        continue;
      }

      if (!isPlainObject(item)) continue;

      if (key === 'properties') {
        checkPomProperties(
          item,
          [...parts, { name: 'properties' }],
          violations,
          excludedPropertyKeys
        );
        continue;
      }

      walkPomNode(
        item,
        [...parts, elementLabel(key, item)],
        violations,
        excludedPropertyKeys,
        excludedVersionValues
      );
    }
  }
}

/**
 * Checks every entry of a <properties> block (at any depth in the document).
 */
function checkPomProperties(node, parts, violations, excludedPropertyKeys) {
  for (const [key, rawValue] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue;

    for (const item of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      const value = scalarValue(item);

      if (value === null) {
        if (isPlainObject(item)) {
          checkPomProperties(item, [...parts, { name: key }], violations, excludedPropertyKeys);
        }
        continue;
      }

      if (excludedPropertyKeys.has(key)) continue;
      if (!isPreRelease(value)) continue;
      if (!isVersionKey(key) && !looksLikeVersion(value)) continue;

      violations.push({ location: renderLocation(parts, { name: key }), version: value });
    }
  }
}

/**
 * Builds the path label for a single element, appending Maven coordinates for
 * <dependency>, <plugin> and <extension>, and the id for <profile>, so that a
 * violation can be traced to a specific entry.
 */
function elementLabel(name, node) {
  if (name === 'profile' && scalarValue(node.id) !== null) {
    return { name, coords: scalarValue(node.id) };
  }
  if (COORDINATE_ELEMENTS.has(name)) {
    const coords = [node.groupId, node.artifactId]
      .map(scalarValue)
      .filter((v) => v !== null && v !== '')
      .join(':');
    if (coords) return { name, coords };
  }
  return { name };
}

/**
 * Renders an element path as the location string reported in a violation,
 * e.g. <build><plugins><plugin>[org.example:my-plugin]<dependencies><dependency>[g:a]<version>
 */
function renderLocation(parts, leaf) {
  return [...parts, leaf]
    .map((p) => `<${p.name}>` + (p.coords ? `[${p.coords}]` : ''))
    .join('');
}

/**
 * Returns the text value of a parsed node, or null when the node holds child
 * elements rather than text. Elements carrying attributes are parsed as objects
 * with the text under `#text`.
 */
function scalarValue(item) {
  if (item === null || item === undefined) return null;
  if (Array.isArray(item)) return null;
  if (typeof item === 'object') {
    return item['#text'] === undefined ? null : String(item['#text']).trim();
  }
  return String(item).trim();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── gradle.properties ──────────────────────────────────────────────────────

/**
 * Checks a gradle.properties file for pre-release versions.
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
 *
 * Every key is inspected. Keys that name a version outright are always checked;
 * any other key is checked only when its value is shaped like a version.
 *
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
    if (line.includes(CHECK_OFF_ANNOTATION)) continue;

    const match = line.match(/^([a-zA-Z][a-zA-Z0-9._-]*)\s*=\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (!isPreRelease(value)) continue;
    if (!isVersionKey(key) && !looksLikeVersion(value)) continue;

    violations.push({ location: key, version: value });
  }
  return violations;
}

// ── build.gradle / build.gradle.kts ───────────────────────────────────────

/**
 * Checks a build.gradle, build.gradle.kts or settings.gradle file for
 * pre-release versions.
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
 *
 * Every string literal in the file is inspected rather than only the project
 * `version = '...'` declaration, so inline dependency coordinates and plugin
 * versions are covered too:
 *
 *   version = '4.2.0-SNAPSHOT'                                    → version
 *   springCloudVersion = '2025.0.0-SNAPSHOT'                      → springCloudVersion
 *   implementation 'org.example:my-lib:1.0.0-SNAPSHOT'            → org.example:my-lib
 *   id 'org.example.plugin' version '2.0.0-SNAPSHOT'              → plugin [org.example.plugin]
 *
 * A literal under a key that does not name a version is only flagged when it is
 * shaped like a version, so repository URLs such as
 * 'https://repo.spring.io/libs-snapshot' are left alone.
 *
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw text of the build.gradle file
 * @returns {{ location: string, version: string }[]}
 */
function checkBuildGradleContent(content) {
  const violations = [];
  const stringLiteral = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;

  for (const rawLine of stripBlockComments(content).split('\n')) {
    if (rawLine.includes(CHECK_OFF_ANNOTATION)) continue;

    const line = stripLineComment(rawLine);
    if (!line.trim()) continue;

    for (const match of line.matchAll(stringLiteral)) {
      const literal = match[2];
      const before = line.slice(0, match.index);

      // 1. Dependency coordinates: 'group:artifact:version[:classifier]'
      const coordinates = literal.split(':');
      if (coordinates.length >= 3) {
        const version = coordinates[2].trim();
        if (isPreRelease(version) && looksLikeVersion(version)) {
          violations.push({
            location: `${coordinates[0]}:${coordinates[1]}`,
            version,
          });
        }
        continue;
      }

      if (!isPreRelease(literal)) continue;

      // 2. Assignment: key = 'value'
      const assignment = before.match(/([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*$/);
      if (assignment) {
        const key = assignment[1];
        if (isVersionKey(key) || looksLikeVersion(literal)) {
          violations.push({ location: key, version: literal });
        }
        continue;
      }

      // 3. version keyword: `version '1.0'`, `version("1.0")`, `version: '1.0'`,
      //    `id 'x' version '1.0'`
      if (/\bversion\s*[:(]?\s*$/.test(before)) {
        const pluginId = before.match(/\bid\s*\(?\s*(['"])([^'"]+)\1/);
        violations.push({
          location: pluginId ? `plugin [${pluginId[2]}]` : 'version',
          version: literal,
        });
        continue;
      }

      // 4. Any other literal that is shaped like a version
      if (looksLikeVersion(literal)) {
        violations.push({ location: truncate(line.trim(), 100), version: literal });
      }
    }
  }

  return violations;
}

function stripBlockComments(content) {
  // Preserve newlines so line-oriented handling below is unaffected.
  return content.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

function stripLineComment(line) {
  // Drop `// ...` but leave `https://...` intact.
  return line.replace(/(^|[^:'"\w])\/\/.*$/, '$1');
}

function truncate(str, max) {
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
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
  looksLikeVersion,
  isVersionKey,
  extractVersionCheckOffAnnotations,
  checkPomContent,
  checkGradlePropertiesContent,
  checkBuildGradleContent,
  findFiles,
};

if (require.main === module) {
  run();
}
