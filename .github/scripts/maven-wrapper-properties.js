'use strict';

// Shared by update-maven-wrapper.yml. The workflow edits maven-wrapper.properties from two
// places - through the contents/git APIs in properties-only mode, and against a real
// checkout in regenerate mode - and both have to produce byte-identical results. Keeping
// the rules here rather than inline in the YAML is what stops the two paths from drifting.
//
// The parseability helpers below deliberately mirror Dependabot's own Maven wrapper parser
// (maven/lib/dependabot/maven/file_parser/wrapper_mojo.rb). When Dependabot cannot work out
// a wrapper version it raises during file *parsing*, which aborts the entire update job for
// the repository - no pull requests at all, not merely no wrapper PR. Matching its logic is
// what lets `check_only` predict that failure before Dependabot hits it.

const PROPS_SUFFIX = '.mvn/wrapper/maven-wrapper.properties';

// Scripts Dependabot will read a version banner out of, in its own preference order:
// Unix first, Windows as the fallback.
const SCRIPTS = ['mvnw', 'mvnwDebug', 'mvnw.cmd', 'mvnwDebug.cmd'];

// The version appears TWICE in a distributionUrl - once as the directory and once in the
// filename:
//
//   .../org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip
//                                     ^^^^^^              ^^^^^^
//
// Both are captured by one pattern so detection and rewriting can never disagree. Rewriting
// only the filename would produce a URL that 404s, which would break every build using the
// wrapper. The host prefix is preserved rather than hard-coded, so a repository pointing at
// a mirror keeps pointing at it.
// The trailing whitespace is captured and replayed rather than matched with `\s*$`.
// Under /m, `\s*` is greedy enough to swallow the newline that ends the line - and on the
// last line of a file, the file's final newline with it - so a rewrite would silently strip
// it and every wrapper PR would carry a spurious "\ No newline at end of file".
const DIST =
  /^(distributionUrl=\s*\S*apache-maven\/)([0-9][^/\s]*)(\/apache-maven-)([0-9][^-\s]*)(-bin\.(?:zip|tar\.gz))([ \t\r]*)$/m;

// Dependabot's parse_version_from_wrapper_url and SCRIPT_VERSION_REGEX respectively.
const WRAPPER_URL_VERSION = /-(\d+\.\d+(?:\.\d+)?(?:-\w+)*)(?:-bin)?\.jar/;
const SCRIPT_VERSION =
  /Apache\s+Maven\s+Wrapper\s+(?:startup\s+)?(?:batch\s+)?script,\s+version\s+(\d+\.\d+(?:\.\d+)?)/;

const propsPath = dir => (dir === '.' ? PROPS_SUFFIX : `${dir}/${PROPS_SUFFIX}`);
const scriptPaths = dir => SCRIPTS.map(s => (dir === '.' ? s : `${dir}/${s}`));

const cmp = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};

// Java .properties semantics, matched to Dependabot's get_property_value: line
// continuations are joined first, `#` and `!` start comments, and either `=` or `:`
// separates key from value. A hand-rolled /^key=/m would disagree with Dependabot on
// exactly the files that matter - the odd ones.
function propertyValue(text, key) {
  const joined = text.replace(/\\\n[ \t]*/g, '');
  const pattern = new RegExp(`^[ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*[=:][ \\t]*(.*)$`);
  for (const line of joined.split('\n')) {
    if (line.startsWith('#') || line.startsWith('!')) continue;
    const m = line.match(pattern);
    if (m) return m[1].trim();
  }
  return null;
}

// The Maven version this wrapper currently pins, or null when the distributionUrl is not a
// shape we recognise (a mirror path we have never seen, or a 4.x layout).
const currentMaven = text => {
  const m = text.match(DIST);
  return m ? m[2] : null;
};

// What Dependabot would resolve as the wrapper version, or null if it would raise.
// `scripts` is the content of whichever of mvnw/mvnw.cmd/mvnwDebug* exist alongside the
// properties file; pass [] when they are known to be absent.
function dependabotWrapperVersion(text, scripts = []) {
  const declared = propertyValue(text, 'wrapperVersion');
  if (declared) return declared;

  const url = propertyValue(text, 'wrapperUrl');
  const fromUrl = url && url.match(WRAPPER_URL_VERSION);
  if (fromUrl) return fromUrl[1];

  for (const content of scripts) {
    const m = content && content.match(SCRIPT_VERSION);
    if (m) return m[1];
  }
  return null;
}

// Only the version numbers are rewritten - the file's existing shape, comments and licence
// header are preserved. Nothing regenerates the wrapper by running `mvn wrapper:wrapper`,
// because that is exactly the parent-POM resolution that fails for a SNAPSHOT parent; a
// textual edit sidesteps it entirely and CI on the resulting PR is what proves the new
// Maven actually works.
function rewrite(text, { maven, wrapper }) {
  let out = text.replace(DIST, `$1${maven}$3${maven}$5$6`);

  // wrapperUrl also carries a version, and on the oldest branches it still points at the
  // pre-Apache io.takari wrapper, which the current Dependabot cannot parse at all.
  // Rewriting it to the Apache coordinates is what fixes those.
  if (propertyValue(out, 'wrapperUrl')) {
    out = out.replace(/^[ \t]*wrapperUrl[ \t]*[=:].*$/m,
      'wrapperUrl=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/' +
      `maven-wrapper/${wrapper}/maven-wrapper-${wrapper}.jar`);
  }
  if (propertyValue(out, 'wrapperVersion')) {
    out = out.replace(/^[ \t]*wrapperVersion[ \t]*[=:].*$/m, `wrapperVersion=${wrapper}`);
    return out;
  }

  // A file with neither key is the case that breaks Dependabot outright, and it is the
  // shape almost every *module* wrapper in the estate still has - a single distributionUrl
  // line written in 2018. This is the one key the workflow will invent rather than merely
  // refresh: without it Dependabot's parser raises and takes the whole repository's update
  // job with it. Added next to distributionUrl so the licence header stays on top.
  if (!propertyValue(out, 'wrapperUrl')) {
    const line = `wrapperVersion=${wrapper}`;
    const dist = out.match(/^[ \t]*distributionUrl[ \t]*[=:].*$/m);
    out = dist ? out.replace(dist[0], `${line}\n${dist[0]}`)
               : `${out.replace(/\s*$/, '')}\n${line}\n`;
  }
  return out;
}

// Every directory that holds a maven-wrapper.properties *and* a pom.xml, given a flat list
// of repository paths. The pom.xml condition is not cosmetic: Dependabot's Maven file
// fetcher looks for a wrapper in the directory of every pom it fetches (root plus each
// <module>), so a wrapper in a directory with no pom is one Dependabot never reads. Root
// first, then depth-first, so the summary reads top-down.
function wrapperDirs(paths) {
  const pomDirs = new Set();
  const wrappers = new Set();
  for (const p of paths) {
    if (p === 'pom.xml') pomDirs.add('.');
    else if (p.endsWith('/pom.xml')) pomDirs.add(p.slice(0, -'/pom.xml'.length));

    if (p === PROPS_SUFFIX) wrappers.add('.');
    else if (p.endsWith(`/${PROPS_SUFFIX}`)) wrappers.add(p.slice(0, -`/${PROPS_SUFFIX}`.length));
  }
  return [...wrappers]
    .filter(d => pomDirs.has(d))
    .sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
}

module.exports = {
  PROPS_SUFFIX, SCRIPTS, DIST,
  propsPath, scriptPaths, cmp, propertyValue,
  currentMaven, dependabotWrapperVersion, rewrite, wrapperDirs,
};
