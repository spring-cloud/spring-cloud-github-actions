const core = require('@actions/core');
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs');

const OSS_BOM_REPO = 'spring-cloud/spring-cloud-release';
const COMMERCIAL_BOM_REPO = 'spring-cloud/spring-cloud-release-commercial';

async function run() {
  try {
    const ref = core.getInput('ref');
    const commercial = core.getInput('commercial') === 'true';
    const token = core.getInput('token');

    if (commercial && !token) {
      core.setFailed(
        'A token is required when commercial is true — spring-cloud-release-commercial is a private repo.'
      );
      return;
    }

    const url = getBomUrl(commercial, ref);
    core.info(`Fetching BOM from: ${url}`);

    const xml = await fetchBomXml(url, token);
    const versions = extractVersions(xml);

    // Set the JSON output for downstream steps to use with fromJSON()
    const versionsJson = JSON.stringify(versions);
    core.setOutput('versions', versionsJson);

    // Also export each version as an environment variable for convenience
    // e.g. spring-boot => SPRING_BOOT_VERSION=3.2.0
    for (const [name, version] of Object.entries(versions)) {
      const envKey = nameToEnvVar(name);
      core.exportVariable(envKey, version);
      core.info(`Exported ${envKey}=${version}`);
    }

    core.info(`Successfully extracted ${Object.keys(versions).length} version(s) from BOM`);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

/**
 * Returns the raw GitHub URL for the BOM pom.xml.
 * Exported for unit testing.
 *
 * @param {boolean} commercial
 * @param {string} ref - branch, tag, or SHA (e.g. '2023.0.x', 'main')
 * @returns {string}
 */
function getBomUrl(commercial, ref) {
  const repo = commercial ? COMMERCIAL_BOM_REPO : OSS_BOM_REPO;
  return `https://raw.githubusercontent.com/${repo}/${ref}/spring-cloud-dependencies/pom.xml`;
}

/**
 * Fetches the BOM pom.xml content from a raw GitHub URL.
 * Exported for unit testing.
 *
 * @param {string} url - Raw GitHub URL for the pom.xml
 * @param {string} token - GitHub token (may be empty for public repos)
 * @returns {Promise<string>} Raw XML content
 */
async function fetchBomXml(url, token) {
  const headers = { Accept: 'text/plain' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? ' — ensure the token has read access to the repository'
        : '';
    throw new Error(`Failed to fetch BOM (HTTP ${response.status}: ${response.statusText})${hint}`);
  }

  return response.text();
}

/**
 * Parses a BOM pom.xml and returns a map of project name -> version.
 * Exported for unit testing.
 *
 * @param {string} xml - Raw XML content of the BOM pom.xml
 * @returns {Record<string, string>} versions map
 */
function extractVersions(xml) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const bom = parser.parse(xml);
  const project = bom?.project;

  if (!project) {
    throw new Error('Invalid POM file: no <project> root element found');
  }

  const versions = {};

  // Capture the release train's own version (e.g. 2023.0.1)
  if (project.version) {
    versions['release-train'] = String(project.version);
  }

  // Extract all <properties> entries ending in .version
  // e.g. <spring-boot.version>3.2.0</spring-boot.version> => spring-boot: "3.2.0"
  const properties = project?.properties ?? {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.endsWith('.version')) {
      const projectName = key.replace(/\.version$/, '');
      versions[projectName] = String(value);
    }
  }

  return versions;
}

/**
 * Converts a kebab-case project name to a SCREAMING_SNAKE_CASE env var name.
 * e.g. spring-boot => SPRING_BOOT_VERSION
 *      release-train => RELEASE_TRAIN_VERSION
 *
 * @param {string} name - project name (kebab-case)
 * @returns {string} environment variable name
 */
function nameToEnvVar(name) {
  return name.toUpperCase().replace(/-/g, '_').replace(/\./g, '_') + '_VERSION';
}

module.exports = { getBomUrl, fetchBomXml, extractVersions, nameToEnvVar };

// Only invoke run() when executed directly by the Actions runner, not during tests
if (require.main === module) {
  run();
}
