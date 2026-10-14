// SciGuard SG001 CH-02 improvement benchmark runner (challenge-v2).
//
// Evaluates TWO checkers on the SAME corrected v2 case set and produces a
// before/after comparison:
//   - legacy  : the frozen 0.2.0 checker (checkpoint of the pre-improvement rule)
//   - improved: the live checker under examples/packages/sciguard/index.mjs
//
// Neither checker is invoked to execute the Python under test, and no model
// API is used. The original challenge (benchmark/challenge/) and its outputs
// under outputs/sciguard-challenge/ are preserved untouched; this runner only
// reads challenge-v2/cases.json and writes to outputs/sciguard-challenge-v2/.
//
// Label spec (see cases.json):
//   label.leaks=true  -> known leakage risk; checker should report POTENTIAL_RISK
//   label.leaks=false -> no clear leakage; checker should report NO_PATTERN_FOUND
//   label.leaks=null  -> needs_review=true; cannot be judged from text alone,
//                        EXCLUDED from binary precision/recall/accuracy
//                        denominators and counted separately.
//
// Failing cases are preserved; detection rules are NOT modified to force a
// pass. Improvements were made to the checker to close CH-02; labels here
// were not flipped to raise a pass rate.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScientificCode as improved } from '../../index.mjs'
import { checkScientificCodeLegacy } from './legacy-checker.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..', '..', '..', '..', '..')
const spec = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))
const cases = spec.cases

const checkers = [
  { key: 'legacy', label: 'legacy (0.2.0, pre-improvement checkpoint)', run: checkScientificCodeLegacy },
  { key: 'improved', label: 'improved (live checkScientificCode)', run: improved },
]

function runCase(runner, input) {
  try {
    const report = runner(input)
    return {
      threw: false,
      throwType: null,
      status: report.status,
      review_required: report.review_required,
      findings: report.findings.length,
      first_finding: report.findings[0] ?? null,
      version: report.version,
    }
  } catch (error) {
    return {
      threw: true,
      throwType: error?.constructor?.name ?? String(error),
      status: null,
      review_required: null,
      findings: null,
      first_finding: null,
      version: null,
      error_message: error?.message ?? String(error),
    }
  }
}

function classify(label, actual) {
  if (actual.threw) return 'check_error'
  const detected = actual.status === 'POTENTIAL_RISK' && actual.findings > 0
  if (label.leaks === true && detected) return 'detected'
  if (label.leaks === true && !detected) return 'missed'
  if (label.leaks === false && detected) return 'false_alarm'
  return 'clean'
}

function evaluate(checker) {
  const results = cases.map((c) => {
    const actual = runCase(checker.run, c.input)
    const classification = c.needs_review ? 'needs_review' : classify(c.label, actual)
    return {
      id: c.id,
      group: c.group,
      label: c.label,
      needs_review: c.needs_review,
      input: c.input,
      rationale: c.rationale,
      notes: c.notes ?? null,
      actual,
      classification,
    }
  })
  // Binary-metric denominator: only label.leaks === true/false cases.
  const binary = results.filter((r) => !r.needs_review)
  const tp = binary.filter((r) => r.classification === 'detected').length
  const fn = binary.filter((r) => r.classification === 'missed').length
  const fp = binary.filter((r) => r.classification === 'false_alarm').length
  const tn = binary.filter((r) => r.classification === 'clean').length
  const checkError = results.filter((r) => r.classification === 'check_error').length
  const needsReview = results.filter((r) => r.needs_review)
  const denom = tp + fn + fp + tn
  return {
    key: checker.key,
    name: checker.label,
    version: results.find((r) => r.actual.version)?.actual.version ?? 'n/a',
    total: results.length,
    binary_denominator: denom,
    excluded_needs_review: needsReview.length,
    tp, fn, fp, tn, check_error: checkError,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
    accuracy: denom > 0 ? (tp + tn) / denom : null,
    results,
    needs_review_cases: needsReview,
    failing: results.filter((r) => ['missed', 'false_alarm', 'check_error'].includes(r.classification)),
  }
}

const runs = checkers.map(evaluate)

function mdTable(run) {
  const binary = run.results.filter((r) => !r.needs_review)
  const byGroup = [...new Set(binary.map((r) => r.group))]
  const row = (g) => {
    const gr = binary.filter((r) => r.group === g)
    const c = (k) => gr.filter((r) => r.classification === k).length
    return `| ${g} | ${gr.length} | ${c('detected')} | ${c('missed')} | ${c('false_alarm')} | ${c('clean')} | ${c('check_error')} |`
  }
  return `| Group | Cases | Detected | Missed | False-alarm | Clean | Error |\n| --- | --- | --- | --- | --- | --- | --- |\n` + byGroup.map(row).join('\n')
}

const legacy = runs[0]
const improvedRun = runs[1]
const p = (x) => (x === null ? 'n/a' : `${Math.round(x * 1000) / 10}%`)

const changed = improvedRun.results
  .filter((r) => !r.needs_review)
  .filter((r) => {
    const before = legacy.results.find((x) => x.id === r.id)
    return before && before.classification !== r.classification
  })

const comparison = changed.map((r) => {
  const before = legacy.results.find((x) => x.id === r.id)
  return `- **${r.id}** (${r.group}): ${before.classification} -> ${r.classification}  [expected leak=${r.label.leaks}]`
})

const md = `# SciGuard SG001 Challenge-v2 Before/After Report (CH-02 improvement)

Generated by \`examples/packages/sciguard/benchmark/challenge-v2/run-challenge-v2.mjs\`.
Two checkers evaluated on the SAME corrected v2 cases, no Python execution, no model API.
Original challenge files (benchmark/challenge/) and outputs (outputs/sciguard-challenge/) are preserved untouched.

## Case-set label spec
- \`label.leaks=true\`  -> known data-leakage risk; the checker SHOULD report POTENTIAL_RISK.
- \`label.leaks=false\` -> no clear leakage; the checker should report NO_PATTERN_FOUND.
- \`label.leaks=null\` + \`needs_review=true\` -> the checker cannot decide from text alone (branch / cross-function / reassignment context not in design scope). These are EXCLUDED from binary metric denominators and counted separately.
- A \`leaks=false\` label asserts only "no clear leakage", NOT that the whole program is correct.

## Metric denominators (explicit)
- Binary precision/recall/accuracy denominator = cases where \`label.leaks\` is true or false = ${legacy.binary_denominator} of ${legacy.total}.
- Excluded "needs_review" cases = ${legacy.excluded_needs_review} (reported separately, not counted in the denominator).
- check_error cases are also excluded from the binary denominator.

## Summary comparison
| Checker | version | binary/total | Detected(TP) | Missed(FN) | False-alarm(FP) | Clean(TN) | Error | Precision | Recall | Accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${legacy.name} | ${legacy.version} | ${legacy.binary_denominator}/${legacy.total} | ${legacy.tp} | ${legacy.fn} | ${legacy.fp} | ${legacy.tn} | ${legacy.check_error} | ${p(legacy.precision)} | ${p(legacy.recall)} | ${p(legacy.accuracy)} |
| ${improvedRun.name} | ${improvedRun.version} | ${improvedRun.binary_denominator}/${improvedRun.total} | ${improvedRun.tp} | ${improvedRun.fn} | ${improvedRun.fp} | ${improvedRun.tn} | ${improvedRun.check_error} | ${p(improvedRun.precision)} | ${p(improvedRun.recall)} | ${p(improvedRun.accuracy)} |

## Classification changes legacy -> improved (binary cases only)
${comparison.length ? comparison.join('\n') : 'None.'}

## Needs-review cases (excluded from binary denominator, counted separately)
${legacy.needs_review_cases.map((r) => `- **${r.id}** (${r.group}): ${r.label.leaks} — ${r.rationale}`).join('\n') || 'None.'}

## Legacy (0.2.0) per-group breakdown
${mdTable(legacy)}

## Improved per-group breakdown
${mdTable(improvedRun)}

## Failing cases preserved (legacy)
${legacy.failing.length ? legacy.failing.map((r) => `### ${r.id}\n- expected: leak=${r.label.leaks}\n- actual: ${JSON.stringify({ status: r.actual.status, threw: r.actual.threw, findings: r.actual.findings })}\n- classification: ${r.classification}\n- rationale: ${r.rationale}\n\n\`\`\`python\n${r.input}\n\`\`\``).join('\n\n') : 'None.'}

## Failing cases preserved (improved)
${improvedRun.failing.length ? improvedRun.failing.map((r) => `### ${r.id}\n- expected: leak=${r.label.leaks}\n- actual: ${JSON.stringify({ status: r.actual.status, threw: r.actual.threw, findings: r.actual.findings })}\n- classification: ${r.classification}\n- rationale: ${r.rationale}\n\n\`\`\`python\n${r.input}\n\`\`\``).join('\n\n') : 'None.'}

## Known limitations
- Heuristic checker only; the Python under test is never executed.
- Binary metrics are computed over the cases whose leak status is unambiguous (\`label.leaks\` true/false, n=${legacy.binary_denominator}); needs_review cases (n=${legacy.excluded_needs_review}) are deliberately outside that denominator, so a rising recall/precision here does NOT mean all branch/cross-function flows are resolved.
- The improvement targets module-qualified \`StandardScaler()\` construction chains and module-qualified \`train_test_split\` calls; it does not extend to arbitrary method calls or claim cross-function data-flow support.
- Labels were not flipped to raise a pass rate; the improvement was made to close CH-02.
`

const outDir = join(projectRoot, 'outputs', 'sciguard-challenge-v2')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'results.json'), JSON.stringify({
  generator: 'SciGuard SG001 challenge-v2 before/after benchmark',
  checkers: runs.map((r) => ({ key: r.key, version: r.version, binary_denominator: r.binary_denominator, total: r.total, tp: r.tp, fn: r.fn, fp: r.fp, tn: r.tn, check_error: r.check_error, precision: r.precision, recall: r.recall, accuracy: r.accuracy })),
  needs_review: legacy.needs_review_cases.map((r) => ({ id: r.id, group: r.group })),
  results: runs,
}, null, 2))
writeFileSync(join(outDir, 'report.md'), md)

for (const r of runs) {
  console.log(`${r.key}: total=${r.total} binary=${r.binary_denominator} excluded_needs_review=${r.excluded_needs_review} tp=${r.tp} fn=${r.fn} fp=${r.fp} tn=${r.tn} err=${r.check_error} P=${p(r.precision)} R=${p(r.recall)} A=${p(r.accuracy)}`)
}
console.log('classification changes:', changed.map((c) => `${c.id}: ${legacy.results.find((x) => x.id === c.id).classification}->${c.classification}`).join(', ') || 'none')
console.log('wrote outputs/sciguard-challenge-v2/results.json and report.md')
