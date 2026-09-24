'use strict';

const { gh, ghRetry, ghJson } = require('./gh-cli');

// Contents API read, base64-decoded. Returns null on any failure (404, unknown ref, ...)
// rather than throwing - callers treat "not found" as meaningful, not exceptional.
function readFileAt(repo, path, ref) {
  const r = gh(['api', `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`]);
  if (!r.ok) return null;
  const meta = JSON.parse(r.out);
  return { sha: meta.sha, text: Buffer.from(meta.content, 'base64').toString('utf8') };
}

// Creates headRef from the current tip of baseBranch. `alreadyExists` distinguishes
// "someone else's leftover branch with no PR" (the caller decides what to do about that)
// from a hard failure to create it.
function createBranch(repo, headRef, baseBranch) {
  const baseRef = ghRetry(['api', `repos/${repo}/git/ref/heads/${baseBranch}`, '--jq', '.object.sha']);
  if (!baseRef.ok) return { ok: false, err: `could not read ${baseBranch}: ${baseRef.err}` };

  const made = ghJson(`repos/${repo}/git/refs`, 'POST',
    { ref: `refs/heads/${headRef}`, sha: baseRef.out.trim() });
  if (made.ok) return { ok: true, alreadyExists: false };
  if (/already exists/i.test(made.err)) return { ok: true, alreadyExists: true };
  return { ok: false, err: `could not create ${headRef}: ${made.err}` };
}

// One commit for every file in `files` (each `{ path, content }`), via the git data API's
// tree/commit/ref-move sequence rather than the contents API's one-file-one-commit shape -
// a branch touching N files should read as one commit, not N sharing the same message.
function commitFilesToRef(repo, ref, files, message, author) {
  const refSha = ghRetry(['api', `repos/${repo}/git/ref/heads/${ref}`, '--jq', '.object.sha']);
  if (!refSha.ok) return { ok: false, err: `could not read ${ref}: ${refSha.err}` };
  const parent = refSha.out.trim();

  const baseTree = ghRetry(['api', `repos/${repo}/git/commits/${parent}`, '--jq', '.tree.sha']);
  if (!baseTree.ok) return { ok: false, err: `could not read the tree of ${ref}: ${baseTree.err}` };

  // mode 100644: every file this is used for (maven-wrapper.properties, antora-playbook.yml)
  // is never executable. Everything not listed is inherited from base_tree.
  const made = ghJson(`repos/${repo}/git/trees`, 'POST', {
    base_tree: baseTree.out.trim(),
    tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  if (!made.ok) return { ok: false, err: `could not build a tree: ${made.err}` };

  const commit = ghJson(`repos/${repo}/git/commits`, 'POST', {
    message,
    tree: JSON.parse(made.out).sha,
    parents: [parent],
    author,
    committer: author,
  });
  if (!commit.ok) return { ok: false, err: `could not create a commit: ${commit.err}` };

  const moved = ghJson(`repos/${repo}/git/refs/heads/${ref}`, 'PATCH',
    { sha: JSON.parse(commit.out).sha });
  if (!moved.ok) return { ok: false, err: `could not move ${ref}: ${moved.err}` };
  return { ok: true };
}

// Matched by prefix rather than exact head name, so a PR opened for an earlier target (an
// older Maven release, an older UI bundle tag) is found and bumped in place instead of
// stacking a second PR on top of it.
function findOpenPrByHeadPrefix(repo, base, headPrefix) {
  const enc = encodeURIComponent(base);
  const openPrs = ghRetry(['api', `repos/${repo}/pulls?state=open&base=${enc}&per_page=100`]);
  if (!openPrs.ok) return { ok: false, err: `could not list pull requests: ${openPrs.err}` };
  const mine = JSON.parse(openPrs.out || '[]')
    .filter(pr => (pr.head?.ref || '').startsWith(headPrefix));
  return { ok: true, pr: mine[0] || null };
}

function openPr(repo, { title, head, base, body }) {
  const pr = ghJson(`repos/${repo}/pulls`, 'POST', { title, head, base, body });
  if (!pr.ok) return { ok: false, err: `could not open PR: ${pr.err}` };
  return { ok: true, pr: JSON.parse(pr.out) };
}

module.exports = { readFileAt, createBranch, commitFilesToRef, findOpenPrByHeadPrefix, openPr };
