'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

// Runs the gh CLI, capturing stdout/stderr instead of letting a failure throw all the way
// out - a script running from a YAML heredoc has no caller that could do anything useful
// with an uncaught exception besides a worse stack trace.
function gh(args) {
  try {
    return {
      ok: true,
      out: execFileSync('gh', args,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }),
    };
  } catch (err) {
    return {
      ok: false,
      out: err.stdout || '',
      err: (err.stderr || err.message || '').split('\n')[0].trim(),
    };
  }
}

// A transient gh/API failure (rate limit, network blip) shouldn't fail a whole matrix leg,
// so a failed attempt is retried with a short linear backoff before giving up.
function ghRetry(args, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = gh(args);
    if (last.ok) return last;
    if (i < attempts) execFileSync('sleep', [String(i * 3)]);
  }
  return last;
}

// Write requests go through --input with a JSON file rather than repeated -f flags: -f
// cannot express the nested author/committer objects the git data API needs, and it would
// mangle the newlines in a commit message or PR body.
function ghJson(path, method, payload) {
  fs.writeFileSync('payload.json', JSON.stringify(payload));
  return ghRetry(['api', path, '--method', method, '--input', 'payload.json']);
}

module.exports = { gh, ghRetry, ghJson };
