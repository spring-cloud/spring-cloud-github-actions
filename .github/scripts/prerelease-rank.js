'use strict';

// A release train ships milestones and release candidates before GA, and the GitHub
// artifacts named after it follow suit. The 2026.0.0 train's project board and its
// per-repo milestones are titled 2026.0.0-M1, then -M2, then -RC1, and only finally
// 2026.0.0 itself.
//
// The releaser config only ever names the GA version, so anything matching a train to a
// board or a milestone has to treat that version as a base to match against rather than a
// literal title - otherwise every PR against a freshly branched train goes unfiled for
// most of the train's life.
//
// Shared by the dependabot-scan action (milestones) and dependabot-triage.yml (boards).
// It lives here rather than inline in each because those two started as copies of one
// script, drifted, and a fix to one silently left the other broken for a week.

// Anchored at both ends: 2026.0.0-SNAPSHOT, 2026.0.01 and 2026.0.0-M1-extra are not
// pre-releases of 2026.0.0.
const PRERELEASE = /^-(M|RC)(\d+)$/;

// Is `title` the base itself or one of its pre-releases, and how far along? null when
// unrelated. Ordered later-wins: GA > RC<n> > M<n>, higher <n> beating lower.
const rank = (title, base) => {
  if (title === base) return [2, 0];
  if (!title.startsWith(base)) return null;
  const m = title.slice(base.length).match(PRERELEASE);
  if (!m) return null;
  return [m[1] === 'RC' ? 1 : 0, Number(m[2])];
};

// Comparator putting the furthest-along entry first. Entries need a `rank` property.
// Numeric throughout, so M10 sorts above M9 rather than below it as a string would.
const byRankDesc = (a, b) => (b.rank[0] - a.rank[0]) || (b.rank[1] - a.rank[1]);

// The furthest-along title in `titles` that belongs to `base`, or null when none does.
const best = (titles, base) => {
  const candidates = [];
  for (const title of titles) {
    const r = rank(title, base);
    if (r) candidates.push({ title, rank: r });
  }
  if (!candidates.length) return null;
  candidates.sort(byRankDesc);
  return candidates[0].title;
};

// ── advancing a train ────────────────────────────────────────────────────────────────
// The progression a train walks is M1 -> M2 -> ... -> RC1 -> RC2 -> ... -> GA, and only
// half of it is derivable: the step within a qualifier is arithmetic, but the step from
// milestones to release candidates, and from release candidates to GA, is a decision
// somebody makes. post-release.yml takes that decision as its `promote_to` input and
// hands it here.

// Pulls a version apart. `kind` is null for a GA version, in which case `num` is 0.
//   2026.0.0-M1 -> { base: '2026.0.0', kind: 'M',  num: 1 }
//   2026.0.0    -> { base: '2026.0.0', kind: null, num: 0 }
// Returns null for anything that is neither - a -SNAPSHOT, a -INTERNAL-SNAPSHOT, or a
// qualifier this grammar does not know - so callers can reject rather than guess.
const split = version => {
  const v = String(version).trim();
  const m = v.match(/^(\d+(?:\.\d+){2,3})(?:-(M|RC)(\d+))?$/);
  if (!m) return null;
  return { base: m[1], kind: m[2] || null, num: m[2] ? Number(m[3]) : 0 };
};

const isPrerelease = version => {
  const s = split(version);
  return !!s && s.kind !== null;
};

// The version that follows `version`, given the caller's intent.
//
// `promoteTo` is 'RC', 'GA', or anything falsy/'none' for "stay in the current phase".
// A GA version ignores it entirely and bumps its last segment, which is what every
// release before this function existed already did.
//
// Throws on a transition that cannot be meant: a milestone cannot become GA without
// passing through a release candidate, and neither phase can be promoted to itself.
// Throwing rather than returning null is deliberate - the caller is about to name
// milestones and project boards after this value, and a silent wrong answer is far more
// expensive than a failed run.
const next = (version, promoteTo) => {
  const s = split(version);
  if (!s) {
    throw new Error(
      `'${version}' is not a release version this can advance. Expected 3 or 4 numeric ` +
      'segments with an optional -M<n> or -RC<n> qualifier.');
  }

  const promote = (promoteTo || 'none').toString().trim().toUpperCase();
  if (!['NONE', 'RC', 'GA', ''].includes(promote)) {
    throw new Error(`Unknown promote_to '${promoteTo}'. Expected none, RC or GA.`);
  }

  // GA releases have no phase to promote out of; they walk the patch line as they always
  // have. The input is ignored rather than rejected so that a promote_to left set from a
  // previous run cannot fail an ordinary release.
  if (s.kind === null) {
    const parts = s.base.split('.');
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    return parts.join('.');
  }

  if (promote === 'RC') {
    if (s.kind === 'RC') {
      throw new Error(
        `${version} is already a release candidate - promote_to=RC has nothing to do. ` +
        'Leave promote_to unset to get the next RC, or set it to GA.');
    }
    return `${s.base}-RC1`;
  }

  if (promote === 'GA') {
    if (s.kind === 'M') {
      throw new Error(
        `${version} is a milestone, so the next release cannot be GA. A train goes ` +
        'M -> RC -> GA; set promote_to=RC first.');
    }
    return s.base;
  }

  // Same phase, next number.
  return `${s.base}-${s.kind}${s.num + 1}`;
};

module.exports = { rank, byRankDesc, best, split, isPrerelease, next };
