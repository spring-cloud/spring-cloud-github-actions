const { classifyChecks } = require('../merge-if-green');

// Fixture shapes lifted from what `gh pr view --json statusCheckRollup` actually returns:
// a mix of legacy commit statuses (StatusContext) and modern check runs (CheckRun).
const checkRun = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion });
const statusContext = (context, state) => ({ __typename: 'StatusContext', context, state });

describe('classifyChecks', () => {
  it('treats an empty rollup as no checks', () => {
    const { checks, failing, pending } = classifyChecks([]);
    expect(checks).toEqual([]);
    expect(failing).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('treats undefined as no checks', () => {
    expect(classifyChecks(undefined).checks).toEqual([]);
  });

  it('classifies a completed, successful check run as passing', () => {
    const { failing, pending } = classifyChecks([checkRun('build', 'COMPLETED', 'SUCCESS')]);
    expect(failing).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('classifies an in-progress check run as pending', () => {
    const { pending } = classifyChecks([checkRun('build', 'IN_PROGRESS', null)]);
    expect(pending.map(c => c.name)).toEqual(['build']);
  });

  it('classifies a failed check run as failing', () => {
    const { failing } = classifyChecks([checkRun('build', 'COMPLETED', 'FAILURE')]);
    expect(failing.map(c => c.name)).toEqual(['build']);
  });

  it('classifies NEUTRAL and SKIPPED conclusions as passing, not pending', () => {
    const { failing, pending } = classifyChecks([
      checkRun('optional', 'COMPLETED', 'NEUTRAL'),
      checkRun('skipped-job', 'COMPLETED', 'SKIPPED'),
    ]);
    expect(failing).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('classifies a legacy status context by its state', () => {
    const { failing, pending } = classifyChecks([statusContext('ci/legacy', 'SUCCESS')]);
    expect(failing).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('classifies a pending legacy status context as pending', () => {
    const { pending } = classifyChecks([statusContext('ci/legacy', 'PENDING')]);
    expect(pending.map(c => c.name)).toEqual(['ci/legacy']);
  });

  it('separates failing and pending checks in a mixed rollup', () => {
    const { checks, failing, pending } = classifyChecks([
      checkRun('build', 'COMPLETED', 'SUCCESS'),
      checkRun('test', 'COMPLETED', 'FAILURE'),
      checkRun('lint', 'IN_PROGRESS', null),
    ]);
    expect(checks).toHaveLength(3);
    expect(failing.map(c => c.name)).toEqual(['test']);
    expect(pending.map(c => c.name)).toEqual(['lint']);
  });
});
