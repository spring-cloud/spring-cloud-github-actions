'use strict';

// Writes the final report of rebase-release-branches.yml from the result-*.jsonl files the
// rebase jobs uploaded.
//
//   node rebase-summary.js <train> <dry_run> <results-dir>
//
// Exits 1 only when a job reported an error (a push that was rejected, a clone that failed).
// Conflicts do not fail the run: they are the expected "do this by hand" outcome and are
// reported in the summary and as warning annotations.

const fs = require('fs');
const path = require('path');
const { summarizeResults } = require('./rebase-plan');

const [train, dryRun, dir] = process.argv.slice(2);
if (!train || !dir) {
  process.stderr.write('usage: rebase-summary.js <train> <dry_run> <results-dir>\n');
  process.exit(2);
}

const results = [];
const walk = d => {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.jsonl')) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) if (line.trim()) results.push(JSON.parse(line));
    }
  }
};
if (fs.existsSync(dir)) walk(dir);

const report = summarizeResults({ train, results, dryRun: dryRun === 'true' });
process.stdout.write(report + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

for (const r of results.filter(x => ['conflict', 'blocked', 'error'].includes(x.status))) {
  process.stdout.write(`::warning title=Rebase by hand::${r.project} ${r.branch}: ${r.status}${r.detail ? ` - ${r.detail}` : ''}\n`);
}
process.exit(results.some(r => r.status === 'error') ? 1 : 0);
