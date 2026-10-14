// Frozen copy of the pre-improvement checkScientificCode (version 0.2.0).
// Used only by benchmark/challenge-v2/run-challenge-v2.mjs to produce a
// before/after comparison on the same v2 cases. Original challenge files
// under benchmark/challenge/ and their outputs are preserved untouched.
const Kind = Symbol.for('TypeBox.Kind')

function maskPython(code) {
  let output = ''
  let quote = ''
  let triple = false
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (quote) {
      if (c === '\\') {
        output += ' '
        if (i + 1 < code.length) output += code[++i] === '\n' ? '\n' : ' '
      } else if (triple && code.slice(i, i + 3) === quote.repeat(3)) {
        output += '   '
        i += 2
        quote = ''
      } else if (!triple && c === quote) {
        output += ' '
        quote = ''
      } else output += c === '\n' ? '\n' : ' '
    } else if (c === '#') {
      while (i < code.length && code[i] !== '\n') { output += ' '; i++ }
      if (i < code.length) output += '\n'
    } else if (c === '"' || c === "'") {
      quote = c
      triple = code.slice(i, i + 3) === c.repeat(3)
      output += triple ? '   ' : ' '
      if (triple) i += 2
    } else output += c
  }
  return { text: output, unterminatedString: Boolean(quote) }
}

export function checkScientificCodeLegacy(code) {
  if (typeof code !== 'string' || code.length > 32768 || !code.trim()) {
    throw new TypeError('code must be non-empty Python text, at most 32768 characters')
  }
  const masked = maskPython(code)
  const lineAt = (offset) => code.slice(0, offset).split('\n').length
  const calls = /\b([A-Za-z_]\w*)\s*\.\s*(fit_transform|fit)\s*\(\s*([A-Za-z_]\w*)\s*(?=[,)])|\btrain_test_split\s*\(\s*([A-Za-z_]\w*)\s*(?=[,)])/g
  const fits = []
  const findings = []
  for (const match of masked.text.matchAll(calls)) {
    if (match[4]) {
      const splitInput = match[4]
      for (const fit of fits) {
        if (fit.dataset !== splitInput && fit.output !== splitInput) continue
        findings.push({
          rule_id: 'SG001',
          severity: 'HIGH',
          title: 'Potential preprocessing data leakage',
          fit_line: fit.line,
          split_line: lineAt(match.index),
          dataset: fit.dataset,
          split_input: splitInput,
          evidence: `${fit.receiver}.${fit.method}(${fit.dataset}) appears before train_test_split(${splitInput})`,
          suggestion: 'Split first; fit preprocessing on X_train only, then transform X_test. For cross-validation, fit preprocessing inside each fold using a Pipeline.',
        })
      }
    } else {
      const lineStart = masked.text.lastIndexOf('\n', match.index - 1) + 1
      const prefix = masked.text.slice(lineStart, match.index)
      const assignment = prefix.match(/^\s*([A-Za-z_]\w*)\s*=\s*$/)
      fits.push({
        receiver: match[1], method: match[2], dataset: match[3],
        output: match[2] === 'fit_transform' ? assignment?.[1] : undefined,
        line: lineAt(match.index),
      })
    }
  }
  const limitations = [
    'Heuristic text analysis, not Python parsing or full data-flow analysis.',
    'Assumes straight-line code and sklearn-style fit/fit_transform/train_test_split calls.',
    'Does not resolve imports, branches, loops, variable reassignments, aliases, or cross-function flow; findings require review.',
    'No finding does not prove absence of leakage or correctness of the experiment.',
    'This tool does not execute code or automatically block other tools.',
  ]
  if (masked.unterminatedString) limitations.push('An unterminated string was detected; analysis may be incomplete.')
  return {
    version: '0.2.0-legacy',
    status: findings.length ? 'POTENTIAL_RISK' : 'NO_PATTERN_FOUND',
    review_required: findings.length > 0 || masked.unterminatedString,
    findings,
    limitations,
  }
}
