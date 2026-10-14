import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkScientificCode, sciGuard } from './index.mjs'
import { fixedExperimentCode, runFixedExperiment } from './experiment.mjs'

test('detects preprocessing of the split input and preserves evidence lines', () => {
  const result = checkScientificCode('X_scaled = scaler.fit_transform(X)\nX_train, X_test = train_test_split(X_scaled)')
  assert.equal(result.status, 'POTENTIAL_RISK')
  assert.equal(result.findings[0].fit_line, 1)
  assert.equal(result.findings[0].split_line, 2)
})
test('detects fit of full data before splitting, including multiline calls', () => {
  assert.equal(checkScientificCode('scaler.fit(\n X\n)\ntrain_test_split(\n X, y\n)').findings.length, 1)
})
test('does not flag fitting training data after splitting', () => {
  const code = 'X_train, X_test, y_train, y_test = train_test_split(X, y)\nX_train = scaler.fit_transform(X_train)\nX_test = scaler.transform(X_test)'
  assert.equal(checkScientificCode(code).status, 'NO_PATTERN_FOUND')
})
test('flags StandardScaler construction chained onto fit/fit_transform before splitting (regression)', () => {
  const direct = checkScientificCode('X_scaled = StandardScaler().fit_transform(X)\nX_train, X_test = train_test_split(X_scaled)')
  assert.equal(direct.status, 'POTENTIAL_RISK')
  assert.equal(direct.findings.length, 1)
  assert.equal(direct.findings[0].fit_line, 1)
  assert.equal(direct.findings[0].split_line, 2)
  const prefixed = checkScientificCode('import sklearn.preprocessing as pp\nX_scaled = pp.StandardScaler().fit_transform(X)\nX_train, X_test = train_test_split(X_scaled, y)')
  assert.equal(prefixed.status, 'POTENTIAL_RISK')
  assert.equal(prefixed.findings.length, 1)
  assert.equal(prefixed.findings[0].fit_line, 2)
  assert.equal(prefixed.findings[0].split_line, 3)
})
test('does not flag StandardScaler construction fitted on training data after splitting (regression)', () => {
  assert.equal(checkScientificCode('X_train, X_test = train_test_split(X, y)\nX_train = StandardScaler().fit_transform(X_train)').findings.length, 0)
  assert.equal(checkScientificCode('X_train, X_test = train_test_split(X, y)\nX_train = pp.StandardScaler().fit_transform(X_train)').findings.length, 0)
})
test('ignores commented or quoted StandardScaler construction patterns (regression)', () => {
  const codes = [
    '# X_scaled = StandardScaler().fit_transform(X)\ntrain_test_split(X)',
    'example = "StandardScaler().fit_transform(X)"\ntrain_test_split(X)',
    '"""pp.StandardScaler().fit_transform(X)\ntrain_test_split(X)"""',
  ]
  for (const code of codes) assert.equal(checkScientificCode(code).findings.length, 0)
})
test('detects module-qualified train_test_split receiving the scaled dataset (regression)', () => {
  const result = checkScientificCode('import sklearn.model_selection as ms\nX_scaled = StandardScaler().fit_transform(X)\nX_train, X_test, y_train, y_test = ms.train_test_split(X_scaled, y)')
  assert.equal(result.status, 'POTENTIAL_RISK')
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].fit_line, 2)
  assert.equal(result.findings[0].split_line, 3)
})
test('does not flag module-qualified split followed by StandardScaler fitted on the training subset (regression)', () => {
  const result = checkScientificCode('import sklearn.model_selection as ms\nX_train, X_test, y_train, y_test = ms.train_test_split(X, y)\nX_train = StandardScaler().fit_transform(X_train)')
  assert.equal(result.findings.length, 0)
  assert.equal(result.status, 'NO_PATTERN_FOUND')
})
test('does not combine unrelated named datasets', () => {
  assert.equal(checkScientificCode('scaler.fit(A)\ntrain_test_split(B)').findings.length, 0)
})
test('ignores comments, quoted examples and docstrings', () => {
  for (const code of ['# scaler.fit(X)\ntrain_test_split(X)', 'example = "scaler.fit(X)"\ntrain_test_split(X)', '"""scaler.fit(X)\ntrain_test_split(X)"""']) {
    assert.equal(checkScientificCode(code).findings.length, 0)
  }
})
test('reports incomplete string input and rejects empty or oversized inputs', () => {
  assert.equal(checkScientificCode('example = "unfinished').review_required, true)
  assert.throws(() => checkScientificCode('   '), TypeError)
  assert.throws(() => checkScientificCode('x'.repeat(32769)), TypeError)
})
test('registered AGH tool returns the same structured report', async () => {
  let tool
  sciGuard.apply({ extension: () => ({ registerHook() {}, registerTool(definition) { if (definition.name === 'sciguard_check') tool = definition } }) })
  assert.equal(tool.name, 'sciguard_check')
  assert.equal(Object.hasOwn(tool.meta, 'costHint'), true)
  assert.equal(tool.parameters[Symbol.for('TypeBox.Kind')], 'Object')
  const result = await tool.execute({ code: 'scaler.fit(X)\ntrain_test_split(X)' })
  assert.equal(result.structured.status, 'POTENTIAL_RISK')
  assert.deepEqual(JSON.parse(result.content[0].text), result.structured)
})

test('fixed demo blocks the risky variant before calling the execution port', async () => {
  let calls = 0
  const result = await runFixedExperiment('risky', { exec() { calls++; throw new Error('must not execute') } }, checkScientificCode)
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.executed, false)
  assert.equal(calls, 0)
  assert.equal(result.check_report.findings[0].rule_id, 'SG001')
  assert.throws(() => fixedExperimentCode('custom'), TypeError)
})

test('fixed corrected demo uses the Host execution port and validates results', async () => {
  let calls = 0
  const result = await runFixedExperiment('corrected', {
    cwd: '/workspace', signal: new AbortController().signal,
    async exec(argv, options) {
      calls++
      assert.deepEqual(argv.slice(1), ['-I', '-B', '-'])
      assert.equal(options.stdin, fixedExperimentCode('corrected'))
      assert.equal(options.timeoutMs, 60000)
      return { code: 0, truncated: false, stderr: '', stdout: JSON.stringify({
        dataset: 'sklearn_breast_cancer', seed: 42, train_samples: 455, test_samples: 114, accuracy: 0.95,
      }) }
    },
  }, checkScientificCode)
  assert.equal(calls, 1)
  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.metrics.accuracy, 0.95)
})

test('fixed demo preserves command failure and cancellation', async () => {
  const failed = await runFixedExperiment('corrected', { cwd: '/workspace', async exec() {
    return { code: 1, truncated: false, timedOut: true, stdout: '', stderr: 'timeout' }
  } }, checkScientificCode)
  assert.equal(failed.status, 'EXECUTION_FAILED')
  assert.equal(failed.timed_out, true)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runFixedExperiment('corrected', { signal: controller.signal }, checkScientificCode))
})

test('pre-flight hook rejects risky and incomplete run_code and preserves non-target tools', async () => {
  let hook
  sciGuard.apply({ extension: () => ({
    registerTool() {},
    registerHook(event, handler) { assert.equal(event, 'tool_call'); hook = handler },
  }) })
  const call = (name, code) => hook({ name, args: { code } })
  for (const code of [
    'X_scaled = scaler.fit_transform(X)\ntrain_test_split(X_scaled, y)',
    'example = "unfinished',
    '', '  ', 42, undefined, 'x'.repeat(32769),
  ]) {
    const result = await call('run_code', code)
    assert.equal(result.allow, false)
    assert.match(result.reason, /SciGuard blocked run_code/)
    assert.ok(result.reason.length > 0 && result.reason.length <= 1024)
  }
  assert.deepEqual(await call('run_code', 'train_test_split(X, y)\nscaler.fit(X_train)'), { allow: true })
  assert.deepEqual(await call('shell', 'scaler.fit(X)\ntrain_test_split(X)'), { allow: true })
  assert.deepEqual(await call('read', undefined), { allow: true })
  assert.deepEqual(await hook({ name: 'run_code' }), { allow: false, reason: 'SciGuard blocked run_code: code must be non-empty Python text.' })
})
