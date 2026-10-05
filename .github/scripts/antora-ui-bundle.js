'use strict';

const { cmp } = require('./version-cmp');

// docs/antora-playbook.yml is per-branch (content.sources[].url: ./.. with branches: HEAD -
// it documents its own branch), so every maintained branch carries its own copy rather than
// there being one canonical file on main. Branches that predate Antora adoption have no
// such file at all.
const PLAYBOOK_PATH = 'docs/antora-playbook.yml';

// Every Antora project also keeps a repo-wide `docs-build` branch whose root
// antora-playbook.yml pins the same UI bundle URL (same shape, so extractBundle/rewrite apply
// unchanged). It is one branch per repository rather than one per maintained branch.
const DOCS_BUILD_BRANCH = 'docs-build';
const DOCS_BUILD_PLAYBOOK_PATH = 'antora-playbook.yml';

// Matches the UI bundle download URL wherever it appears in the file - matched by shape (a
// GitHub release asset download link) rather than by indentation under ui:/bundle:/url:,
// the same way currentMaven() in maven-wrapper-properties.js matches distributionUrl by
// shape rather than by position.
const BUNDLE_URL =
  /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/releases\/download\/([^/\s]+)\/([^\s'"]+)/;

// The path itself, then the same path with the other YAML extension - a playbook may be
// named either antora-playbook.yml or antora-playbook.yaml.
function playbookCandidates(path) {
  const alt = path.endsWith('.yml') ? path.replace(/\.yml$/, '.yaml') : path.replace(/\.yaml$/, '.yml');
  return alt === path ? [path] : [path, alt];
}

// { repo, tag, url } for the UI bundle release this playbook currently points at, or null
// when no release-download URL is present at all.
function extractBundle(text) {
  const m = text.match(BUNDLE_URL);
  if (!m) return null;
  return { repo: m[1], tag: m[2], url: m[0] };
}

// Textual, non-destructive: only the URL is replaced, everything else in the file -
// comments, key order, unrelated settings - is preserved byte-for-byte. Mirrors the
// contract maven-wrapper-properties.js's rewrite() gives for maven-wrapper.properties.
function rewrite(text, { repo, tag }) {
  const current = extractBundle(text);
  if (!current) return text;
  const newUrl = current.url.replace(current.repo, repo).replace(current.tag, tag);
  return text.replace(current.url, newUrl);
}

module.exports = { PLAYBOOK_PATH, DOCS_BUILD_BRANCH, DOCS_BUILD_PLAYBOOK_PATH, playbookCandidates, extractBundle, rewrite, cmp };
