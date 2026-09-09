const core = require('@actions/core');
const { releaserConfigFileName } = require('../../../scripts/releaser-config-file');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');

const OSS_RELEASE_REPO = 'spring-cloud/spring-cloud-release';
const COMMERCIAL_RELEASE_REPO = 'spring-cloud/spring-cloud-release-commercial';
const RELEASER_CONFIG_BRANCH = 'jenkins-releaser-config';

async function run() {
  try {
    const releaseTrainVersion = core.getInput('release-train-version');
    const commercial = core.getInput('commercial') === 'true';
    const token = core.getInput('token');
    const directory = path.resolve(core.getInput('directory') || '.');

    if (!fs.existsSync(directory)) {
      core.setFailed(`Directory not found: ${directory}`);
      return;
    }

    let versions;
    let projectVersion;

    const substitutionsInput = core.getInput('project-version-substitutions');
    let substitutions = {};
    if (substitutionsInput) {
      try {
        substitutions = JSON.parse(substitutionsInput);
      } catch {
        core.setFailed('Invalid JSON supplied for the project-version-substitutions input');
        return;
      }
    }

    if (releaseTrainVersion) {
      // ── Fetch versions from the jenkins-releaser-config properties file ──────
      const url = getReleaserConfigUrl(commercial, releaseTrainVersion);
      core.info(`Fetching releaser config from ${url}`);
      const content = await fetchReleaserConfig(url, token);
      versions = parseReleaserConfig(content, substitutions);

      // Auto-detect the project name from the root pom.xml <artifactId>
      const projectName = detectProjectName(directory);
      core.info(`Detected project name: ${projectName}`);

      projectVersion = versions[projectName];
      if (!projectVersion) {
        core.setFailed(
          `Project '${projectName}' was not found in the releaser config for release train ${releaseTrainVersion}. ` +
          `Ensure the root pom.xml artifactId matches a key in the properties file.`
        );
        return;
      }
      core.info(`Project version: ${projectVersion}`);
    } else {
      // ── Use the explicitly supplied versions JSON and project-version ─────────
      const versionsInput = core.getInput('versions');
      if (!versionsInput) {
        core.setFailed('Either release-train-version or versions must be provided');
        return;
      }
      try {
        versions = JSON.parse(versionsInput);
      } catch {
        core.setFailed('Invalid JSON supplied for the versions input');
        return;
      }

      projectVersion = core.getInput('project-version');
      if (!projectVersion) {
        core.setFailed('Either release-train-version or project-version must be provided');
        return;
      }
    }

    // ── Maven ───────────────────────────────────────────────────────────────
    const pomFiles = findFiles(directory, 'pom.xml');
    if (pomFiles.length > 0) {
      core.info(`Found ${pomFiles.length} pom.xml file(s)`);
      const rootPom = path.join(directory, 'pom.xml');

      // Capture the current root version before any files are modified so that
      // non-root poms with a matching explicit <version> can be detected reliably.
      let currentRootVersion = null;
      let rootArtifactId = null;
      if (fs.existsSync(rootPom)) {
        const rootParser = new XMLParser({ ignoreAttributes: false });
        const rootParsed = rootParser.parse(fs.readFileSync(rootPom, 'utf-8'));
        currentRootVersion = rootParsed?.project?.version
          ? String(rootParsed.project.version)
          : null;
        rootArtifactId = rootParsed?.project?.artifactId
          ? String(rootParsed.project.artifactId)
          : null;
      }

      // Pre-scan all pom files to collect every artifactId that belongs to this
      // project. This lets isChildOfRoot recognise intermediate aggregate parent poms
      // (e.g. spring-cloud-function-adapter-parent inside spring-cloud-function-adapters/)
      // so that their child poms have their parent version updated correctly.
      const internalArtifactIds = new Set();
      if (rootArtifactId) internalArtifactIds.add(rootArtifactId);
      const pomParser = new XMLParser({ ignoreAttributes: false });
      for (const file of pomFiles) {
        const parsed = pomParser.parse(fs.readFileSync(file, 'utf-8'));
        const aid = parsed?.project?.artifactId;
        if (aid) internalArtifactIds.add(String(aid));
      }

      for (const file of pomFiles) {
        const isRoot = path.resolve(file) === path.resolve(rootPom);
        const { changed, updatedProperties, skippedProperties } = updatePomFile(
          file,
          isRoot,
          projectVersion,
          versions,
          currentRootVersion,
          rootArtifactId,
          internalArtifactIds
        );
        if (changed) {
          core.info(`Updated ${path.relative(directory, file)}: ${updatedProperties.join(', ')}`);
        }
        // Reported even when nothing changed: a property left alone on purpose is the kind
        // of thing that otherwise looks like the bump silently missing one.
        if (skippedProperties.length) {
          core.info(`Left alone in ${path.relative(directory, file)} ` +
            `(@releaser:version-check-off): ${skippedProperties.join(', ')}`);
        }
      }
    }

    // ── Gradle ──────────────────────────────────────────────────────────────
    const gradlePropsFiles = findFiles(directory, 'gradle.properties');
    if (gradlePropsFiles.length > 0) {
      core.info(`Found ${gradlePropsFiles.length} gradle.properties file(s)`);
      for (const file of gradlePropsFiles) {
        const { changed, updatedProperties } = updateGradlePropertiesFile(
          file,
          projectVersion,
          versions
        );
        if (changed) {
          core.info(`Updated ${path.relative(directory, file)}: ${updatedProperties.join(', ')}`);
        }
      }
    }

    // ── build.gradle / build.gradle.kts ────────────────────────────────────
    // The project version declaration, plus any `{prefix}Version` properties declared in an
    // ext block rather than in gradle.properties.
    const buildGradleFiles = [
      ...findFiles(directory, 'build.gradle'),
      ...findFiles(directory, 'build.gradle.kts'),
    ];
    if (buildGradleFiles.length > 0) {
      core.info(`Found ${buildGradleFiles.length} build.gradle file(s)`);
      for (const file of buildGradleFiles) {
        const { changed, updatedProperties } = updateBuildGradleVersion(
          file,
          projectVersion,
          versions
        );
        if (changed) {
          core.info(`Updated ${path.relative(directory, file)}: ` +
            ['version', ...updatedProperties].join(', '));
        } else {
          core.info(`No changes to ${path.relative(directory, file)}`);
        }
      }
    }

    // ── Release train docs ──────────────────────────────────────────────────
    // spring-cloud-release commits the Antora pages that GenerateReleaseTrainDocs renders
    // from spring-cloud-dependencies/pom.xml, and the published site serves the committed
    // copy rather than regenerating it. The release tags the branch tip without ever
    // running that generator, so without this the tagged docs still link to the snapshots
    // the branch was developing against. No other project has this directory, which is
    // what the existence checks are for.
    const docsPagesDir = path.join(directory, 'docs', 'modules', 'ROOT', 'pages');
    if (fs.existsSync(docsPagesDir)) {
      const linksFile = path.join(docsPagesDir, '_spring-cloud-links.adoc');
      if (fs.existsSync(linksFile)) {
        const { changed, updatedProjects } = updateReleaseTrainLinksFile(linksFile, versions);
        if (changed) {
          core.info(`Updated ${path.relative(directory, linksFile)}: ${updatedProjects.join(', ')}`);
        } else {
          core.info(`No changes to ${path.relative(directory, linksFile)}`);
        }
      }
      const indexFile = path.join(docsPagesDir, 'index.adoc');
      if (fs.existsSync(indexFile)) {
        const { changed, updatedProperties } = updateReleaseTrainIndexFile(indexFile, versions);
        if (changed) {
          core.info(`Updated ${path.relative(directory, indexFile)}: ${updatedProperties.join(', ')}`);
        }
      }
    }

    const totalFiles = pomFiles.length + gradlePropsFiles.length + buildGradleFiles.length;
    if (totalFiles === 0) {
      core.warning(`No pom.xml, gradle.properties, or build.gradle files found under ${directory}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// ── Releaser config ─────────────────────────────────────────────────────────

/**
 * Converts a release train version string to the properties filename used in the
 * jenkins-releaser-config branch of spring-cloud-release.
 * e.g. "2025.1.0" → "2025_1_0.properties"
 *
 * Exported for unit testing.
 */
// Re-exported under its original name so the tests and the rest of this file are unchanged.
// The rule itself lives in .github/scripts/releaser-config-file.js because six places need
// it - this action, three workflows and two composite actions - and each used to carry its
// own copy. ncc bundles this require into dist/, so the published action stays standalone.
const releaseTrainVersionToFileName = releaserConfigFileName;

/**
 * Builds the raw GitHub URL for the releaser config properties file.
 *
 * Exported for unit testing.
 */
function getReleaserConfigUrl(commercial, version) {
  const repo = commercial ? COMMERCIAL_RELEASE_REPO : OSS_RELEASE_REPO;
  const fileName = releaseTrainVersionToFileName(version);
  return `https://raw.githubusercontent.com/${repo}/${RELEASER_CONFIG_BRANCH}/${fileName}`;
}

/**
 * Fetches the releaser config properties file from GitHub.
 * Passes the token as a Bearer header so that private (commercial) repos are accessible.
 *
 * Exported for unit testing.
 */
async function fetchReleaserConfig(url, token) {
  const headers = { Accept: 'text/plain' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? ' — ensure the token has read access to the repository'
        : '';
    throw new Error(
      `Failed to fetch releaser config (HTTP ${response.status}: ${response.statusText})${hint}`
    );
  }
  return response.text();
}

/**
 * Parses a jenkins-releaser-config properties file into a versions map.
 *
 * Only lines matching `releaser.fixed-versions[project-name]=version` are read;
 * all other lines (blank lines, comments, unrelated properties) are ignored.
 *
 * Example input line:
 *   releaser.fixed-versions[spring-boot]=3.2.3
 *
 * Exported for unit testing.
 *
 * @param {string} content - raw text of the properties file
 * @returns {Record<string, string>} e.g. { "spring-boot": "3.2.3", ... }
 */
function parseReleaserConfig(content, substitutions = {}) {
  const versions = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^releaser\.fixed-versions\[([^\]]+)\]=(.+)$/);
    if (match) {
      const projectName = match[1].trim();
      const version = match[2].trim();
      versions[projectName] = version;
    }
  }
  for (const [key, value] of Object.entries(substitutions)) {
    if (versions[value] !== undefined) {
      versions[key] = versions[value];
    }
  }
  return versions;
}

/**
 * Reads the root pom.xml in the given directory and returns its <artifactId>
 * to use as the project name when looking up the project version in the
 * releaser config.
 *
 * Exported for unit testing.
 *
 * @param {string} directory - root directory of the project
 * @returns {string} the artifactId of the root pom
 */
function detectProjectName(directory) {
  const rootPomPath = path.join(directory, 'pom.xml');
  if (!fs.existsSync(rootPomPath)) {
    throw new Error(
      `No root pom.xml found in ${directory} — cannot auto-detect project name. ` +
      `Supply the project-version input explicitly if this project does not use Maven.`
    );
  }
  const content = fs.readFileSync(rootPomPath, 'utf-8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(content);
  const artifactId = parsed?.project?.artifactId;
  if (!artifactId) {
    throw new Error(
      'Could not auto-detect project name: no <artifactId> found in root pom.xml'
    );
  }
  return artifactIdToProjectName(String(artifactId));
}

// ── pom.xml ────────────────────────────────────────────────────────────────

/**
 * Updates version entries in a pom.xml file.
 *
 * For the root pom:
 *   - Updates the project <version> (skipping the <parent> block)
 *
 * For non-root poms whose own <version> matches currentRootVersion:
 *   - Also updates the project <version> (e.g. BOM / dependencies modules that
 *     carry an explicit <version> equal to the root project version, such as
 *     spring-cloud-circuitbreaker-dependencies)
 *
 * For all pom files (root and child modules):
 *   - Updates <parent><version> when the parent artifactId is in the versions map
 *   - Updates <properties> entries ending in .version that match the versions map
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @param {boolean} isRoot - true when this is the root pom.xml of the project
 * @param {string} projectVersion
 * @param {Record<string, string>} versions
 * @param {string|null} currentRootVersion - the root pom's version before any edits;
 *   non-root poms whose own <version> equals this value will also have it updated
 * @param {Set<string>|null} internalArtifactIds - set of all artifactIds found in
 *   this project's pom files; used to recognise intermediate parent poms as internal
 */
function updatePomFile(filePath, isRoot, projectVersion, versions, currentRootVersion = null, rootArtifactId = null, internalArtifactIds = null) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let updated = content;
  const updatedProperties = [];
  const skippedProperties = [];

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(content);
  const project = parsed?.project;

  if (!project) {
    return { changed: false, updatedProperties: [], skippedProperties: [] };
  }

  // 1. Update the project's own <version>, skipping the <parent> block.
  //    - Always in the root pom.
  //    - In non-root poms whose explicit <version> matches currentRootVersion
  //      (e.g. spring-cloud-circuitbreaker-dependencies carries its own <version>
  //      equal to the project version even though it is not the root pom).
  const ownVersion = project.version ? String(project.version) : null;
  const shouldUpdateOwnVersion =
    ownVersion != null &&
    (isRoot || (currentRootVersion != null && ownVersion === currentRootVersion));

  if (shouldUpdateOwnVersion) {
    const prev = updated;
    updated = replaceProjectVersion(updated, ownVersion, projectVersion);
    if (updated !== prev) {
      updatedProperties.push(`version: ${projectVersion}`);
    }
  }

  // 2. Update <parent><version> when the parent artifactId is tracked in the versions map.
  //    In multi-module projects each child pom has a <parent> pointing back to the root
  //    (or to a Spring Cloud parent), and that parent version must stay consistent.
  const parentArtifactId = project?.parent?.artifactId;
  if (parentArtifactId) {
    const parentName = artifactIdToProjectName(parentArtifactId);

    // Check the exact artifact ID first (handles substitution keys like
    // spring-cloud-dependencies-parent that are already in the versions map),
    // then the stripped name (handles patterns like spring-cloud-build-dependencies
    // → spring-cloud-build). Fall back to projectVersion only when the parent is
    // the root project of this repo.
    const resolvedParentVersion =
      versions[parentArtifactId] !== undefined
        ? versions[parentArtifactId]
        : versions[parentName] !== undefined
        ? versions[parentName]
      : isChildOfRoot(project, versions, rootArtifactId, internalArtifactIds)
      ? projectVersion
        : null;

    if (resolvedParentVersion && project.parent?.version) {
      const prev = updated;
      updated = replaceParentVersion(updated, String(project.parent.version), resolvedParentVersion);
      if (updated !== prev) {
        updatedProperties.push(`parent.version: ${resolvedParentVersion}`);
      }
    }
  }

  // 3. Update <properties> entries ending in .version that match the versions map.
  //    This applies to ALL pom files — root and child modules alike, except any the pom
  //    has opted out of with @releaser:version-check-off.
  const properties = project?.properties ?? {};
  for (const [key, currentValue] of Object.entries(properties)) {
    if (!key.endsWith('.version')) continue;
    const projectName = key.slice(0, -'.version'.length);
    const targetVersion = versions[projectName];
    if (targetVersion && String(currentValue) !== targetVersion) {
      if (hasVersionCheckOff(updated, key)) {
        skippedProperties.push(`${key} (pinned at ${currentValue})`);
        continue;
      }
      const prev = updated;
      updated = replacePropertyValue(updated, key, targetVersion);
      if (updated !== prev) {
        updatedProperties.push(`${key}: ${targetVersion}`);
      }
    }
  }

  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed, updatedProperties, skippedProperties };
}

/**
 * Replaces the project's own <version> tag, carefully skipping the <parent> block
 * so that the parent's version is not touched.
 *
 * Exported for unit testing.
 */
function replaceProjectVersion(xml, oldVersion, newVersion) {
  if (oldVersion === newVersion) return xml;

  const parentBlockRegex = /<parent>[\s\S]*?<\/parent>/;
  const parentMatch = xml.match(parentBlockRegex);

  const versionRegex = new RegExp(
    `(<version>\\s*)${escapeRegex(oldVersion)}(\\s*<\\/version>)`
  );

  if (!parentMatch) {
    return xml.replace(versionRegex, `$1${newVersion}$2`);
  }

  // Temporarily replace the parent block so our version regex cannot match inside it
  const placeholder = '\x00PARENT\x00';
  const withPlaceholder = xml.replace(parentBlockRegex, placeholder);
  const updated = withPlaceholder.replace(versionRegex, `$1${newVersion}$2`);
  return updated.replace(placeholder, parentMatch[0]);
}

/**
 * Replaces the <version> tag specifically inside the <parent> block.
 *
 * Exported for unit testing.
 */
function replaceParentVersion(xml, oldVersion, newVersion) {
  if (oldVersion === newVersion) return xml;
  return xml.replace(
    /(<parent>[\s\S]*?<version>)([\s\S]*?)(<\/version>[\s\S]*?<\/parent>)/,
    (match, before, _currentVer, after) => `${before}${newVersion}${after}`
  );
}

/**
 * Replaces the value of a named <properties> entry in the pom.xml.
 * Uses string replacement to preserve XML formatting.
 *
 * Exported for unit testing.
 */
/**
 * True when the pom has opted this property out of version management with the marker the
 * Jenkins releaser has always used:
 *
 *   <spring-cloud-stream.version>4.3.4</spring-cloud-stream.version><!-- @releaser:version-check-off -->
 *
 * Needed where two projects in the same train depend on each other - spring-cloud-stream
 * builds against spring-cloud-function and function's samples build against stream - because
 * pointing both at the other's snapshot is a cycle. One side pins to a release and says so.
 *
 * Exported for unit testing.
 */
function hasVersionCheckOff(xml, propertyName) {
  const escapedName = escapeRegex(propertyName);
  return new RegExp(
    `<${escapedName}>[^<]*<\\/${escapedName}>[ \\t]*<!--[^>]*@releaser:version-check-off[^>]*-->`
  ).test(xml);
}

function replacePropertyValue(xml, propertyName, newVersion) {
  const escapedName = escapeRegex(propertyName);
  const regex = new RegExp(`(<${escapedName}>\\s*)([^<]*)(\\s*<\\/${escapedName}>)`);
  return xml.replace(regex, `$1${newVersion}$3`);
}

// ── gradle.properties ──────────────────────────────────────────────────────

/**
 * Updates version entries in a gradle.properties file.
 *
 * Rules (matching spring-cloud-release-tools behaviour):
 *   - Bare `version=` key → updated to projectVersion
 *   - `{prefix}Version=` keys → prefix converted camelCase→kebab-case, looked up in versions map
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @param {string} projectVersion
 * @param {Record<string, string>} versions
 */
function updateGradlePropertiesFile(filePath, projectVersion, versions) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { updated, updatedProperties } = updateGradlePropertiesContent(
    content,
    projectVersion,
    versions
  );
  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed, updatedProperties };
}

/**
 * Core logic for updating gradle.properties content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 */
function updateGradlePropertiesContent(content, projectVersion, versions) {
  const lines = content.split('\n');
  const updatedProperties = [];

  const updatedLines = lines.map((line) => {
    // Match: key=value  or  key = value  (ignore comment lines)
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9.]*)(\s*=\s*)(.+)$/);
    if (!match) return line;

    const [, key, separator, currentValue] = match;

    // Bare `version` key → project's own version
    if (key === 'version') {
      if (currentValue.trim() !== projectVersion) {
        updatedProperties.push(`version: ${projectVersion}`);
        return `${key}${separator}${projectVersion}`;
      }
      return line;
    }

    // `{prefix}Version` keys → camelCase prefix → kebab-case lookup
    if (/^[a-zA-Z0-9]+Version$/.test(key)) {
      const projectName = camelToKebab(key.slice(0, -'Version'.length));
      const targetVersion = versions[projectName];
      if (targetVersion && currentValue.trim() !== targetVersion) {
        updatedProperties.push(`${key}: ${targetVersion}`);
        return `${key}${separator}${targetVersion}`;
      }
    }

    return line;
  });

  return { updated: updatedLines.join('\n'), updatedProperties };
}

// ── build.gradle / build.gradle.kts ───────────────────────────────────────

/**
 * Updates the project version declaration and any version properties in a build.gradle
 * or build.gradle.kts file. Handles both single-quoted and double-quoted versions:
 *   version = '4.1.0'
 *   springCloudFunctionVersion = "4.1.0"
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @param {string} projectVersion
 * @param {Record<string, string>} versions
 */
function updateBuildGradleVersion(filePath, projectVersion, versions) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { updated, updatedProperties } = updateBuildGradleContent(
    content,
    projectVersion,
    versions
  );
  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed, updatedProperties };
}

/**
 * Core logic for updating the version line in build.gradle content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 */
function updateBuildGradleContent(content, projectVersion, versions = {}) {
  // Match: version = '...' or version = "..." at the start of a line (with optional spaces)
  const withProjectVersion = content.replace(
    /^(version\s*=\s*)(['"])([^'"]+)(['"])/m,
    (_, prefix, openQuote, _oldVersion, closeQuote) =>
      `${prefix}${openQuote}${projectVersion}${closeQuote}`
  );

  // `{prefix}Version` assignments, resolved exactly as they are in gradle.properties:
  // camelCase prefix -> kebab-case project name -> the train's version for it. These live
  // in an `ext { }` or `buildscript { ext { } }` block rather than at the start of a line,
  // so leading whitespace is part of the match and is preserved.
  //
  // Spring Cloud projects mostly declare these in gradle.properties, which is why this
  // file only ever rewrote the project version. spring-cloud-function's Gradle samples
  // declare them here instead, so a release left them at whatever they had been pinned at.
  //
  // A key that resolves to no project is left alone, which is what keeps `javaVersion` and
  // similar build settings out of it.
  const updatedProperties = [];
  const updated = withProjectVersion.split('\n').map((line) => {
    const match = line.match(
      /^(\s*)([a-zA-Z][a-zA-Z0-9]*Version)(\s*=\s*)(['"])([^'"]+)(['"])(.*)$/
    );
    if (!match) return line;

    const [, indent, key, separator, openQuote, currentValue, closeQuote, trailing] = match;
    const projectName = camelToKebab(key.slice(0, -'Version'.length));
    const targetVersion = versions[projectName];
    if (!targetVersion || currentValue === targetVersion) return line;

    updatedProperties.push(`${key}: ${targetVersion}`);
    return `${indent}${key}${separator}${openQuote}${targetVersion}${closeQuote}${trailing}`;
  }).join('\n');

  // Inline dependency coordinates - "group:artifact:version" - for artifacts this train
  // releases. Most Spring Cloud builds express these through a property or let the BOM
  // manage them, which is why this file never needed it; spring-cloud-function's Azure
  // sample pins one directly.
  //
  // Only org.springframework.* groups, so a third-party artifact that happens to share a
  // prefix is never touched, and never when the version is an interpolation - rewriting
  // "...:${springCloudFunctionVersion}" would replace the reference with a literal and
  // break the very indirection the build is using.
  const COORDINATE = /(['"])(org\.springframework\.[a-z0-9.]+):([A-Za-z0-9_.-]+):([^'"]+)\1/g;
  const withCoordinates = updated.replace(
    COORDINATE,
    (whole, quote, groupId, artifactId, version) => {
      if (version.includes('$')) return whole;
      const projectName = projectForArtifact(artifactId, versions);
      const targetVersion = projectName && versions[projectName];
      if (!targetVersion || version === targetVersion) return whole;
      updatedProperties.push(`${artifactId}: ${targetVersion}`);
      return `${quote}${groupId}:${artifactId}:${targetVersion}${quote}`;
    }
  );

  return { updated: withCoordinates, updatedProperties };
}

// ── Release train docs ─────────────────────────────────────────────────────

/**
 * One rendered line of docs/modules/ROOT/pages/_spring-cloud-links.adoc, in either of the
 * two link forms the template has used:
 *
 *   link:/spring-cloud-config/reference/5.1-SNAPSHOT/[spring-cloud-config] :: Reference Documentation, version 5.1.0-SNAPSHOT
 *   https://docs.spring.io/spring-cloud-config/reference/5.0/[spring-cloud-config] :: Reference Documentation, version 5.0.5
 *   https://docs.enterprise.spring.io/spring-cloud-config/reference/[spring-cloud-config] :: Reference Documentation, version 4.3.3.1
 *
 * Everything outside the two version captures is preserved, so the branch keeps whichever
 * form its own template renders and this file cannot drift from _spring-cloud-links.hbs.
 *
 * The path segment is optional, because the commercial hotfix branches omit it altogether
 * (tag v2025.0.2.1 renders `/reference/[…]`, deliberately unversioned). A line without one
 * does not gain one - adding it would repoint the link at a version the page was written
 * not to name - while its trailing version is still updated.
 */
const RELEASE_TRAIN_LINK_LINE =
  /^(.*\/reference\/)((?:[^/\s]+\/)?)(\[)([a-z0-9-]+)(\].*?\bversion\s+)(\S+)([ \t]*)$/;

/**
 * The docs URL segment for a project version: major.minor, with -SNAPSHOT kept.
 * A port of TemplateProject.toAntora in spring-cloud-release's
 * docs/src/main/java/org/springframework/cloud/internal/TemplateProject.java — the two
 * must agree, or a release would rewrite a link to a path Antora does not publish.
 *
 *   5.0.5          → 5.0
 *   5.1.0-SNAPSHOT → 5.1-SNAPSHOT
 *   5.1.0-M1       → 5.1
 *
 * Exported for unit testing.
 */
function toAntoraVersion(version) {
  const parts = String(version).split('.');
  const majorMinor = `${parts[0]}.${parts[1]}`;
  return String(version).includes('SNAPSHOT') ? `${majorMinor}-SNAPSHOT` : majorMinor;
}

/**
 * Rewrites the project links page in place: for each line, the project name in the
 * `[name]` label is looked up in the versions map, and only the `/reference/<segment>/`
 * path and the trailing `version <v>` are replaced.
 *
 * A line whose project is absent from the map is left byte-identical, which is what keeps
 * a hand-added entry — or an unrelated file that happens to match — safe.
 *
 * Exported for unit testing.
 */
function updateReleaseTrainLinksContent(content, versions) {
  const updatedProjects = [];

  const updated = content.split('\n').map((line) => {
    const match = line.match(RELEASE_TRAIN_LINK_LINE);
    if (!match) return line;

    const [, prefix, pathSegment, openBracket, projectName, middle, currentVersion, trailing] = match;
    const targetVersion = versions[projectName];
    if (!targetVersion || currentVersion === targetVersion) return line;

    // Captured with its trailing slash, or empty when the link carries no version segment.
    const newPathSegment = pathSegment === '' ? '' : `${toAntoraVersion(targetVersion)}/`;
    updatedProjects.push(`${projectName}: ${targetVersion}`);
    return `${prefix}${newPathSegment}${openBracket}${projectName}` +
      `${middle}${targetVersion}${trailing}`;
  }).join('\n');

  return { updated, updatedProjects };
}

/**
 * Rewrites the `:spring-boot-version:` attribute in the docs index page. Every other line
 * is left alone, and a versions map without spring-boot is a no-op.
 *
 * Exported for unit testing.
 */
function updateReleaseTrainIndexContent(content, versions) {
  const updatedProperties = [];
  const targetVersion = versions['spring-boot'];
  if (!targetVersion) {
    return { updated: content, updatedProperties };
  }

  const updated = content.replace(
    /^(:spring-boot-version:[ \t]*)(\S+)([ \t]*)$/m,
    (whole, prefix, currentVersion, trailing) => {
      if (currentVersion === targetVersion) return whole;
      updatedProperties.push(`spring-boot-version: ${targetVersion}`);
      return `${prefix}${targetVersion}${trailing}`;
    }
  );

  return { updated, updatedProperties };
}

function updateReleaseTrainLinksFile(filePath, versions) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { updated, updatedProjects } = updateReleaseTrainLinksContent(content, versions);
  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed, updatedProjects };
}

function updateReleaseTrainIndexFile(filePath, versions) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { updated, updatedProperties } = updateReleaseTrainIndexContent(content, versions);
  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed, updatedProperties };
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Recursively finds all files with the given filename under a directory,
 * skipping common build output and dependency directories.
 *
 * Exported for unit testing.
 */
function findFiles(dir, filename) {
  const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle']);
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        results.push(...findFiles(fullPath, filename));
      }
    } else if (entry.isFile() && entry.name === filename) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Converts a camelCase string to kebab-case.
 * e.g. springBoot → spring-boot, springCloudConfig → spring-cloud-config
 *
 * Exported for unit testing.
 */
function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Converts a Maven artifactId to a project name by stripping common suffixes
 * (-dependencies, -parent, -build) that are used in BOMs but not in artifact names.
 * e.g. spring-cloud-build-dependencies → spring-cloud-build
 *
 * Exported for unit testing.
 */
function artifactIdToProjectName(artifactId) {
  return artifactId
    .replace(/-dependencies$/, '')
    .replace(/-parent$/, '');
}

/**
 * Resolves a Maven artifactId to the project in `versions` that releases it: an exact
 * match, or the longest project name the artifactId extends on a `-` boundary.
 *
 * Spring Cloud publishes a project's modules at the project's own version, so
 * spring-cloud-function-adapter-azure ships with spring-cloud-function and
 * spring-cloud-config-server with spring-cloud-config. The boundary matters:
 * spring-cloud-configuration would not resolve to spring-cloud-config.
 *
 * Longest wins so a project whose name extends another still resolves to itself.
 * Returns null when nothing matches, which leaves the coordinate alone.
 *
 * Exported for unit testing.
 */
function projectForArtifact(artifactId, versions) {
  if (Object.prototype.hasOwnProperty.call(versions, artifactId)) return artifactId;
  let best = null;
  for (const name of Object.keys(versions)) {
    if (artifactId.startsWith(`${name}-`) && (best === null || name.length > best.length)) {
      best = name;
    }
  }
  return best;
}

/**
 * Returns true when a child pom's parent is part of this project
 * (i.e. not an external parent like spring-boot-starter-parent or
 * spring-cloud-dependencies-parent).
 *
 * When internalArtifactIds is supplied (a Set of every artifactId found in the
 * project's pom files) the parent must be a member of that set. This correctly
 * handles multi-level module hierarchies where an intermediate aggregate pom
 * (e.g. spring-cloud-function-adapter-parent) is itself a parent of deeper
 * sub-modules — those sub-modules would be missed when only comparing against
 * the root artifactId.
 *
 * When only rootArtifactId is supplied the parent must match the root artifactId
 * or its stripped form. This prevents external parents absent from the versions
 * map (e.g. spring-boot-starter-parent when versions is empty) from being
 * incorrectly stamped with the project version.
 *
 * When neither is supplied the function falls back to the looser heuristic of
 * "not in versions map" (used only in unit tests that don't supply either).
 */
function isChildOfRoot(project, versions, rootArtifactId = null, internalArtifactIds = null) {
  const parentArtifactId = project?.parent?.artifactId;
  if (!parentArtifactId) return false;
  const parentName = artifactIdToProjectName(parentArtifactId);

  if (versions[parentArtifactId] !== undefined || versions[parentName] !== undefined) {
    return false;
  }

  if (internalArtifactIds !== null) {
    // Exact match only — do NOT check the stripped parentName.
    // Stripping '-parent'/'-dependencies' from an external parent's artifactId could
    // accidentally match an internal module that shares the stripped name
    // (e.g. spring-cloud-dependencies-parent strips to spring-cloud-dependencies,
    // which is a real module in spring-cloud-release-commercial).
    return internalArtifactIds.has(parentArtifactId);
  }

  if (rootArtifactId !== null) {
    const rootName = artifactIdToProjectName(rootArtifactId);
    return (
      parentArtifactId === rootArtifactId ||
      parentArtifactId === rootName ||
      parentName === rootArtifactId ||
      parentName === rootName
    );
  }

  return true;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  releaseTrainVersionToFileName,
  getReleaserConfigUrl,
  fetchReleaserConfig,
  parseReleaserConfig,
  detectProjectName,
  updatePomFile,
  replaceProjectVersion,
  replaceParentVersion,
  replacePropertyValue,
  hasVersionCheckOff,
  updateGradlePropertiesContent,
  updateBuildGradleContent,
  toAntoraVersion,
  updateReleaseTrainLinksContent,
  updateReleaseTrainIndexContent,
  findFiles,
  camelToKebab,
  artifactIdToProjectName,
  projectForArtifact,
  isChildOfRoot,
};

if (require.main === module) {
  run();
}
