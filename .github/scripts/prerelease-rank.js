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

module.exports = { rank, byRankDesc, best };
