import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { checkScientificCode } from './index.mjs'
import { runFixedExperiment } from './experiment.mjs'

// Real subprocess integration test, not an AGH session/approval test.
test('corrected fixed experiment trains in the project Python virtualenv', async () => {
  let calls = 0
  const result = await runFixedExperiment('corrected', {
    cwd: process.cwd(), signal: new AbortController().signal,
    async exec(argv, options) {
      calls++
      return new Promise((resolve, reject) => {
        const child = execFile(argv[0], argv.slice(1), {
          cwd: options.cwd, env: { ...process.env, ...options.env },
          timeout: options.timeoutMs, maxBuffer: 1048576, windowsHide: true,
        }, (error, stdout, stderr) => {
          if (error) reject(error)
          else resolve({ code: 0, stdout, stderr, truncated: false })
        })
        child.stdin.on('error', reject)
        child.stdin.end(options.stdin)
      })
    },
  }, checkScientificCode)
  assert.equal(calls, 1)
  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.metrics.train_samples, 455)
  assert.equal(result.metrics.test_samples, 114)
  assert.equal(result.metrics.confusion_matrix.flat().reduce((a, b) => a + b, 0), 114)
  assert.ok(result.metrics.accuracy > 0.8 && result.metrics.accuracy <= 1)
  console.log('Real Python experiment:', JSON.stringify(result.metrics))
})
