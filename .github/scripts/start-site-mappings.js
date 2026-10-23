'use strict';

// The edit post-release.yml makes to the `spring-cloud` bom in start.spring.io's
// application.yml, kept apart from the workflow so it can be tested against the shapes that
// file really takes. Handled as lines rather than parsed YAML so the change stays a splice
// and the other 700 lines of that file keep their formatting exactly.
//
// A train line (2025.1, 2026.0) owns up to two mappings:
//
//   - compatibilityRange: "[4.2.0,4.3.0-M1)"           the release itself
//     version: 2026.0.0
//   - compatibilityRange: "[4.2.0-SNAPSHOT,4.3.0-M1)"  the line's snapshots
//     version: 2026.0.1-SNAPSHOT
//
// Both are found by the train *line*, never by the exact version. A patch release is the
// common case - 2025.1.4 replaces 2025.1.3 - and matching on the version would not find the
// entry it is meant to replace, then add a second one beside it.

const { split } = require('./prerelease-rank');
const { rangeFor, snapshotRangeFor } = require('./boot-compatibility-range');

// The one line that identifies the Spring Cloud bom among the dozen boms in that file,
// several of which are also called spring-cloud-something.
const ANCHOR = /^\s*artifactId:\s*spring-cloud-dependencies\s*$/;
const VERSION_RE = /^(\s*version:\s*)(["']?)([^"'\s]+)\2(\s*)$/;
// Each mapping is an item starting at a `- compatibilityRange:` line.
const ITEM = /^(\s*)-\s+compatibilityRange:\s*(.*?)\s*$/;

const indentOf = l => l.match(/^(\s*)/)[1].length;
const unquote = s => s.replace(/^["']|["']$/g, '');
const isSnapshot = v => /-SNAPSHOT$/i.test(v || '');

// 2025.1.4 -> 2025.1; 2026.0.0-SNAPSHOT -> 2026.0. null for anything that is not a version.
const lineOf = v => {
  const m = String(v || '').match(/^(\d+\.\d+)(?:\.|$)/);
  return m ? m[1] : null;
};

// The snapshot a GA release leaves behind it: 2026.0.0 -> 2026.0.1-SNAPSHOT.
const nextSnapshot = base => {
  const parts = base.split('.');
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return `${parts.join('.')}-SNAPSHOT`;
};

// Finds the bom and its mappings. The bom's own key is the nearest earlier line indented
// less than its body, and the block runs to the next line indented no further than that
// key. Read from the file rather than assumed, so a reindentation upstream does not
// silently retarget this at the neighbouring bom.
const locate = lines => {
  const anchor = lines.findIndex(l => ANCHOR.test(l));
  if (anchor < 0) return { error: 'no line matching "artifactId: spring-cloud-dependencies"' };

  const bodyIndent = indentOf(lines[anchor]);
  let keyLine = -1;
  for (let i = anchor - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) < bodyIndent) { keyLine = i; break; }
  }
  if (keyLine < 0) return { error: `no key above line ${anchor + 1}` };
  const keyIndent = indentOf(lines[keyLine]);

  let blockEnd = lines.length;
  for (let i = anchor + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) <= keyIndent) { blockEnd = i; break; }
  }

  // Each item runs to the next one, or to the end of the bom block.
  const items = [];
  for (let i = keyLine + 1; i < blockEnd; i++) {
    const m = lines[i].match(ITEM);
    if (m) items.push({ start: i, indent: m[1], range: m[2], end: blockEnd });
  }
  for (let k = 0; k < items.length - 1; k++) items[k].end = items[k + 1].start;
  for (const it of items) {
    for (let i = it.start; i < it.end; i++) {
      const m = lines[i].match(VERSION_RE);
      if (m) { it.versionIndex = i; it.version = m[3]; it.vQuote = m[2]; break; }
    }
  }
  return { keyLine, blockEnd, items };
};

const setVersion = (lines, item, version) => {
  const vq = item.vQuote;
  lines[item.versionIndex] = lines[item.versionIndex].replace(VERSION_RE, `$1${vq}${version}${vq}$4`);
};

// Applies one release to the file's text.
//
// Returns { status, message, mappings } when it declines to or cannot edit, and otherwise
// { status: 'edited', text, action, changeDetail, from, snapshotFrom, snapshotTo, mappings }
// where action is 'added' or 'updated'.
//
//   no-boot-version     the Boot version the ranges derive from is missing or unusable
//   bom-not-found       the bom, or its mappings, are not where they were
//   no-mapping          a patch release for a line the site does not list - see below
//   unexpected-mappings a snapshot mapping with no release mapping beside it
//   already-current     the file already reflects this release
//   error               the edit did not come out the shape intended; nothing is returned
const updateMappings = (original, { releaseVersion, bootVersion }) => {
  const lines = original.split('\n');
  const found = locate(lines);
  if (found.error) {
    return { status: 'bom-not-found', message: `Could not find the spring-cloud bom: ${found.error}.`, mappings: [] };
  }
  const { items } = found;
  const mappings = items.map(it => it.version).filter(Boolean);
  if (!items.length) {
    return { status: 'bom-not-found', message: 'The spring-cloud bom has no compatibilityRange mappings.', mappings };
  }

  if (!bootVersion) {
    return {
      status: 'no-boot-version', mappings,
      message: `The properties file for ${releaseVersion} has no spring-boot entry, and the ` +
        'compatibility range is derived from it. Nothing was changed.',
    };
  }

  const rel = split(releaseVersion);
  if (!rel) {
    return { status: 'error', message: `'${releaseVersion}' is not a release version this can map.`, mappings };
  }
  const isGA = rel.kind === null;
  const trainLine = lineOf(rel.base);

  let wantRange, wantSnapshotRange;
  try {
    wantRange = rangeFor(bootVersion, releaseVersion);
    wantSnapshotRange = snapshotRangeFor(bootVersion);
  } catch (err) {
    return { status: 'no-boot-version', message: `Cannot derive a compatibility range: ${err.message}`, mappings };
  }

  const ours = items.filter(it => lineOf(it.version) === trainLine);
  const snapshotEntry = ours.find(it => isSnapshot(it.version));
  const releaseEntry = ours.find(it => !isSnapshot(it.version));

  // What the line's snapshot mapping should read once this release is out. Before GA the
  // train is still building towards <base>, so it stays <base>-SNAPSHOT; at GA that is
  // released, and the line's snapshots move on to the next patch.
  const wantSnapshotVersion = isGA ? nextSnapshot(rel.base) : `${rel.base}-SNAPSHOT`;

  const result = { mappings, from: '', snapshotFrom: '', snapshotTo: '' };
  let added = false;
  let changeDetail;

  if (releaseEntry) {
    // ── this line already has an entry: rewrite it in place ─────────────────────────
    const fromVersion = releaseEntry.version;
    const fromRange = unquote(releaseEntry.range);
    result.from = fromVersion;

    if (releaseEntry.versionIndex === undefined) {
      return {
        status: 'unexpected-mappings', mappings,
        message: `The ${releaseEntry.range} mapping has no version line to rewrite.`,
      };
    }

    // The range moves as the train changes phase - the floor goes -M1 -> -RC1, and at GA the
    // whole range widens to the next Boot minor. Between two GA releases it does not move at
    // all: 2025.1.3 -> 2025.1.4 is a version bump, and deriving the range again from this
    // release's Boot version would narrow it to [4.0.9,...) and drop everyone on 4.0.0-4.0.8.
    const from = split(fromVersion);
    const gaToGa = isGA && from && from.kind === null;
    const toRange = gaToGa ? fromRange : wantRange;

    // Only a GA release moves the snapshot line. Both pre-release and GA runs leave a line
    // with no snapshot mapping without one: the maintenance lines carry none.
    const moveSnapshot = isGA && snapshotEntry && snapshotEntry.version !== wantSnapshotVersion;

    if (fromVersion === releaseVersion && fromRange === toRange && !moveSnapshot) {
      return {
        status: 'already-current', mappings, from: fromVersion,
        message: `The file already maps ${toRange} to ${releaseVersion}.`,
      };
    }

    const parts = [];
    if (fromRange !== toRange) {
      lines[releaseEntry.start] = `${releaseEntry.indent}- compatibilityRange: "${toRange}"`;
      parts.push(`\`${fromRange}\` → \`"${toRange}"\``);
    }
    if (fromVersion !== releaseVersion) {
      setVersion(lines, releaseEntry, releaseVersion);
      parts.push(`\`${fromVersion}\` → \`${releaseVersion}\``);
    }
    if (moveSnapshot) {
      if (snapshotEntry.versionIndex === undefined) {
        return {
          status: 'unexpected-mappings', mappings,
          message: `The ${snapshotEntry.range} mapping has no version line to rewrite.`,
        };
      }
      result.snapshotFrom = snapshotEntry.version;
      result.snapshotTo = wantSnapshotVersion;
      setVersion(lines, snapshotEntry, wantSnapshotVersion);
      parts.push(`\`${snapshotEntry.version}\` → \`${wantSnapshotVersion}\``);
    }
    changeDetail = parts.join(' and ');
  } else if (!snapshotEntry) {
    // ── nothing for this line ───────────────────────────────────────────────────────
    // A new train - its first milestone, or a .0 that skipped them - is added. A patch
    // release for a line the site does not list is the opposite: the line has aged off, and
    // putting it back would offer a Spring Cloud for a Boot range nobody asked to support.
    if (isGA && Number(rel.base.split('.')[2]) > 0) {
      return {
        status: 'no-mapping', mappings,
        message: `The file has no mapping for the ${trainLine} line, and ${releaseVersion} is a ` +
          'patch release rather than the start of a train, so nothing was added.',
      };
    }

    // The release itself, and the train's snapshot line. Only the snapshot entry names a
    // repository: Spring Boot 4.0 and up publishes milestones to Maven Central, so a
    // milestone bom resolves without one - which is why the other pre-release entries in
    // that file carry no repositories key - while snapshots still come from repo.spring.io.
    const last = items[items.length - 1];
    const ind = last.indent;
    const block = [
      `${ind}- compatibilityRange: "${wantRange}"`,
      `${ind}  version: ${releaseVersion}`,
      `${ind}- compatibilityRange: "${wantSnapshotRange}"`,
      `${ind}  version: ${wantSnapshotVersion}`,
      `${ind}  repositories:`,
      `${ind}    - spring-snapshots`,
    ];
    // After the last mapping's last non-blank line, so a blank line separating this bom
    // from the next one stays where it is.
    let at = last.end - 1;
    while (at > last.start && !lines[at].trim()) at--;
    lines.splice(at + 1, 0, ...block);

    added = true;
    result.snapshotTo = wantSnapshotVersion;
    changeDetail = `added \`${wantRange}\` → \`${releaseVersion}\` and ` +
      `\`${wantSnapshotRange}\` → \`${wantSnapshotVersion}\``;
  } else {
    // A snapshot entry but nothing to release into. Adding a second entry here would leave
    // two mappings for one line and no way to tell which a later run should move, so this
    // is reported rather than guessed at.
    return {
      status: 'unexpected-mappings', mappings,
      message: `The file has a ${snapshotEntry.version} mapping for this train but no release ` +
        'mapping beside it. Sort that out by hand; nothing was changed.',
    };
  }

  // The edit is text, so prove the result still has the shape intended before it is
  // written: the mappings list grew by what was expected, and carries this release once.
  const after = locate(lines);
  const expectedItems = items.length + (added ? 2 : 0);
  const carries = after.items ? after.items.filter(it => it.version === releaseVersion).length : 0;
  if (!after.items || after.items.length !== expectedItems || carries !== 1) {
    return {
      status: 'error', mappings,
      message: `The edit did not produce the expected mappings: ${after.items ? after.items.length : 0} ` +
        `mapping(s) where ${expectedItems} were expected, ${carries} carrying ${releaseVersion}. Left alone.`,
    };
  }

  return {
    ...result, status: 'edited', text: lines.join('\n'),
    action: added ? 'added' : 'updated', changeDetail,
  };
};

module.exports = { updateMappings, lineOf, nextSnapshot };
