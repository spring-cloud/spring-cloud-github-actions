'use strict';

// Dotted-numeric version comparison, tolerant of a leading `v` (release tags like
// `v0.4.26`). Shared because this exact comparator was independently implemented three
// times: update-maven-wrapper.yml's `versions` job, maven-wrapper-properties.js's own
// `cmp` (now a re-export of this), and what would otherwise be a fourth copy for the
// Antora UI bundle's release tags.
function cmp(a, b) {
  const parts = s => String(s).replace(/^v/, '').split('.').map(Number);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

module.exports = { cmp };
