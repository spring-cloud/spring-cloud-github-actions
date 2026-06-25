const core = require('@actions/core');
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
      if (fs.existsSync(rootPom)) {
        const rootParser = new XMLParser({ ignoreAttributes: false });
        const rootParsed = rootParser.parse(fs.readFileSync(rootPom, 'utf-8'));
        currentRootVersion = rootParsed?.project?.version
          ? String(rootParsed.project.version)
          : null;
      }

      for (const file of pomFiles) {
        const isRoot = path.resolve(file) === path.resolve(rootPom);
        const { changed, updatedProperties } = updatePomFile(
          file,
          isRoot,
          projectVersion,
          versions,
          currentRootVersion
        );
        if (changed) {
          core.info(`Updated ${path.relative(directory, file)}: ${updatedProperties.join(', ')}`);
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
    // Only the project version declaration is updated (version = '...' / version = "...").
    // Dependency versions are managed exclusively via gradle.properties in Spring Cloud.
    const buildGradleFiles = [
      ...findFiles(directory, 'build.gradle'),
      ...findFiles(directory, 'build.gradle.kts'),
    ];
    if (buildGradleFiles.length > 0) {
      core.info(`Found ${buildGradleFiles.length} build.gradle file(s)`);
      for (const file of buildGradleFiles) {
        const { changed } = updateBuildGradleVersion(file, projectVersion);
        if (changed) {
          core.info(`Updated ${path.relative(directory, file)}: version`);
        } else {
          core.info(`No changes to ${path.relative(directory, file)}: version`);
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
function releaseTrainVersionToFileName(version) {
  return version.replace(/\./g, '_') + '.properties';
}

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
 */
function updatePomFile(filePath, isRoot, projectVersion, versions, currentRootVersion = null) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let updated = content;
  const updatedProperties = [];

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(content);
  const project = parsed?.project;

  if (!project) {
    return { changed: false, updatedProperties: [] };
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
        : isChildOfRoot(project, versions, projectVersion)
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
  //    This applies to ALL pom files — root and child modules alike.
  const properties = project?.properties ?? {};
  for (const [key, currentValue] of Object.entries(properties)) {
    if (!key.endsWith('.version')) continue;
    const projectName = key.slice(0, -'.version'.length);
    const targetVersion = versions[projectName];
    if (targetVersion && String(currentValue) !== targetVersion) {
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
  return { changed, updatedProperties };
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
 * Updates the project version declaration in a build.gradle or build.gradle.kts file.
 * Handles both single-quoted and double-quoted versions:
 *   version = '4.1.0'
 *   version = "4.1.0"
 *
 * Only the project-level version line is updated; dependency version properties
 * are managed via gradle.properties in Spring Cloud projects.
 *
 * Exported for unit testing.
 *
 * @param {string} filePath
 * @param {string} projectVersion
 */
function updateBuildGradleVersion(filePath, projectVersion) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { updated } = updateBuildGradleContent(content, projectVersion);
  const changed = updated !== content;
  if (changed) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  }
  return { changed };
}

/**
 * Core logic for updating the version line in build.gradle content.
 * Operates on a string so it can be unit tested without touching the filesystem.
 *
 * Exported for unit testing.
 */
function updateBuildGradleContent(content, projectVersion) {
  // Match: version = '...' or version = "..." at the start of a line (with optional spaces)
  const updated = content.replace(
    /^(version\s*=\s*)(['"])([^'"]+)(['"])/m,
    (_, prefix, openQuote, _oldVersion, closeQuote) =>
      `${prefix}${openQuote}${projectVersion}${closeQuote}`
  );
  return { updated };
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
 * Returns true when a child pom's parent appears to be the root project of this repo
 * (i.e. not an external Spring Cloud parent) by checking that the parent artifactId
 * does NOT appear in the external versions map under either its exact name or its
 * stripped name (after removing -dependencies / -parent suffixes).
 */
function isChildOfRoot(project, versions, projectVersion) {
  const parentArtifactId = project?.parent?.artifactId;
  if (!parentArtifactId) return false;
  const parentName = artifactIdToProjectName(parentArtifactId);
  return versions[parentArtifactId] === undefined && versions[parentName] === undefined;
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
  updateGradlePropertiesContent,
  updateBuildGradleContent,
  findFiles,
  camelToKebab,
  artifactIdToProjectName,
};

if (require.main === module) {
  run();
}
