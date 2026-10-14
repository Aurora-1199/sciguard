// One-shot: recompute the ORIGINAL 0.2.0 challenge results using the frozen legacy checker,
// and write them to outputs/sciguard-challenge-original-0.2.0/ so the pre-improvement baseline
// is preserved side by side with the improved results.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScientificCodeLegacy } from '../challenge-v2/legacy-checker.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..', '..', '..', '..', '..')
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))

function runCase(input) {
  try {
    const report = checkScientificCodeLegacy(input)
    return { threw: false, throwType: null, status: report.status, review_required: report.review_required, findings: report.findings.length, first_finding: report.findings[0] ?? null, version: report.version }
  } catch (error) {
    return { threw: true, throwType: error?.constructor?.name ?? String(error), status: null, review_required: null, findings: null, first_finding: null, version: null, error_message: error?.message ?? String(error) }
  }
}
function classify(label, actual) {
  if (actual.threw) return 'check_error'
  const detected = actual.status === 'POTENTIAL_RISK' && actual.findings > 0
  if (label.leaks && detected) return 'detected'
  if (label.leaks && !detected) return 'missed'
  if (!label.leaks && detected) return 'false_alarm'
  return 'clean'
}

const results = cases.map((c) => ({
  id: c.id, group: c.group, label: c.label, input: c.input, rationale: c.rationale,
  actual: runCase(c.input), classification: classify(c.label, runCase(c.input)),
}))
const detected = results.filter((r) => r.classification === 'detected').length
const missed = results.filter((r) => r.classification === 'missed').length
const falseAlarm = results.filter((r) => r.classification === 'false_alarm').length
const clean = results.filter((r) => r.classification === 'clean').length
const checkError = results.filter((r) => r.classification === 'check_error').length
const total = results.length
const tp = detected; const fn = missed; const fp = falseAlarm; const tn = clean
const precision = tp + fp > 0 ? tp / (tp + fp) : null
const recall = tp + fn > 0 ? tp / (tp + fn) : null
const accuracy = total > 0 ? (tp + tn) / total : null

const outDir = join(projectRoot, 'outputs', 'sciguard-challenge-original-0.2.0')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'results.json'), JSON.stringify({
  generator: 'SciGuard SG001 challenge benchmark (ORIGINAL 0.2.0 checker, frozen legacy rule)',
  checker_version: '0.2.0',
  total, detected, missed, false_alarm: falseAlarm, clean, check_error: checkError,
  precision, recall, accuracy, cases: results,
}, null, 2))
console.log(`0.2.0 original: total=${total} detected=${detected} missed=${missed} false_alarm=${falseAlarm} clean=${clean} P=${precision} R=${recall} A=${accuracy}`)
console.log('missed cases:', results.filter((r) => r.classification === 'missed').map((r) => r.id).join(', '))
console.log('wrote outputs/sciguard-challenge-original-0.2.0/results.json')
