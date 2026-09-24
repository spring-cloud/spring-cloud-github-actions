'use strict';

const { gh } = require('./gh-cli');

const FAILING = new Set(['FAILURE', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE', 'CANCELLED']);
const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

// Normalizes the two shapes `statusCheckRollup` can contain - legacy commit statuses and
// modern check runs - into one `{ name, state }` list, then splits it into failing/pending
// so a caller can decide, or explain, whether a PR is safe to merge.
function classifyChecks(statusCheckRollup) {
  const checks = (statusCheckRollup || []).map(c => {
    if (c.__typename === 'StatusContext' || c.state) {
      return { name: c.context || 'status', state: (c.state || '').toUpperCase() };
    }
    const status = (c.status || '').toUpperCase();
    if (status && status !== 'COMPLETED') return { name: c.name, state: 'PENDING' };
    return { name: c.name, state: (c.conclusion || 'PENDING').toUpperCase() };
  });
  const failing = checks.filter(c => FAILING.has(c.state));
  const pending = checks.filter(c => !FAILING.has(c.state) && !PASSING.has(c.state));
  return { checks, failing, pending };
}

// Reads a PR's mergeability and checks, and merges it if - and only if - every check has
// reported and passed, GitHub reports a CLEAN merge state (not merely "mergeable", which
// also covers a locked branch or a pending required review), and dryRun is false. Returns
// `{ status, detail }` rather than exiting the process - the caller writes its own result
// artifact and decides what "not-merged" should be called in its own summary.
function mergeIfGreen({ repo, pr, method = 'squash', dryRun = true }) {
  const view = gh(['pr', 'view', String(pr), '--repo', repo, '--json',
    'mergeable,mergeStateStatus,statusCheckRollup,url']);
  if (!view.ok) return { status: 'error', detail: `could not read PR: ${view.err}` };

  const data = JSON.parse(view.out);
  const { checks, failing, pending } = classifyChecks(data.statusCheckRollup);

  if (!checks.length) return { status: 'not-merged', detail: 'no checks have reported yet' };
  if (failing.length) {
    return { status: 'not-merged', detail: `failing checks: ${failing.map(c => c.name).join(', ')}` };
  }
  if (pending.length) {
    return { status: 'not-merged', detail: `checks still running: ${pending.map(c => c.name).join(', ')}` };
  }
  if (data.mergeable === 'CONFLICTING') {
    return { status: 'not-merged', detail: 'conflicts with the base branch' };
  }
  if (data.mergeable !== 'MERGEABLE') {
    return { status: 'not-merged', detail: `mergeable is ${data.mergeable}` };
  }
  if (data.mergeStateStatus !== 'CLEAN') {
    return { status: 'not-merged', detail: `all checks pass but GitHub reports ${data.mergeStateStatus}` };
  }

  if (dryRun) return { status: 'would-merge', detail: `all ${checks.length} check(s) pass` };

  const merged = gh(['pr', 'merge', String(pr), '--repo', repo, `--${method}`, '--delete-branch']);
  if (!merged.ok) return { status: 'error', detail: `merge failed: ${merged.err}` };
  return { status: 'merged', detail: `${method}, all ${checks.length} check(s) passed` };
}

module.exports = { classifyChecks, mergeIfGreen };
