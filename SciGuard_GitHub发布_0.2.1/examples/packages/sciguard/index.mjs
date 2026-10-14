// Self-contained, advisory analysis. Never evaluates the supplied Python code.
import { runFixedExperiment } from './experiment.mjs'
const Kind = Symbol.for('TypeBox.Kind')

// Mask comments and string literals while preserving line numbers and offsets.
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

export function checkScientificCode(code) {
  if (typeof code !== 'string' || code.length > 32768 || !code.trim()) {
    throw new TypeError('code must be non-empty Python text, at most 32768 characters')
  }
  const masked = maskPython(code)
  const lineAt = (offset) => code.slice(0, offset).split('\n').length
  // Small rule: (1) StandardScaler construction chains, optionally module-qualified
  //   [<module.>]StandardScaler().fit|fit_transform(<first-arg>)
  // (2) named receiver rule
  //   <named>.fit|fit_transform(<first-arg>)
  // (3) train_test_split calls, optionally module-qualified
  //   [<module.>]train_test_split(<first-arg>).
  // Only the StandardScaler construction receiver and the split call are extended
  // with module-qualified forms; this is not arbitrary data-flow analysis.
  const calls = /(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.)?StandardScaler\s*\(\s*\)\s*\.\s*(fit_transform|fit)\s*\(\s*([A-Za-z_]\w*)\s*(?=[,)])|\b([A-Za-z_]\w*)\s*\.\s*(fit_transform|fit)\s*\(\s*([A-Za-z_]\w*)\s*(?=[,)])|(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.)?\btrain_test_split\s*\(\s*([A-Za-z_]\w*)\s*(?=[,)])/g
  const fits = []
  const findings = []
  for (const match of masked.text.matchAll(calls)) {
    if (match[6]) {
      const splitInput = match[6]
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
      // match.index is the start of the matched construction/receiver, so the
      // assignment target prefix ends in "= " and the target is captured cleanly
      // for both the bare and module-qualified StandardScaler() forms.
      const assignment = masked.text.slice(lineStart, match.index).match(/^\s*([A-Za-z_]\w*)\s*=\s*$/)
      let method
      let dataset
      if (match[1]) {
        method = match[1]
        dataset = match[2]
      } else {
        method = match[4]
        dataset = match[5]
      }
      fits.push({
        receiver: match[1] ? 'StandardScaler' : match[3],
        method, dataset,
        output: method === 'fit_transform' ? assignment?.[1] : undefined,
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
    version: '0.2.1',
    status: findings.length ? 'POTENTIAL_RISK' : 'NO_PATTERN_FOUND',
    review_required: findings.length > 0 || masked.unterminatedString,
    findings,
    limitations,
  }
}

export const sciGuard = {
  inject: ['extension'],
  apply(ctx) {
    ctx.extension().registerHook('tool_call', (payload) => {
      if (payload.name !== 'run_code') return { allow: true }
      const deny = (reason) => ({ allow: false, reason: `SciGuard blocked run_code: ${reason}`.slice(0, 1024) })
      const code = payload.args?.code
      if (typeof code !== 'string' || !code.trim()) return deny('code must be non-empty Python text.')
      let report
      try {
        report = checkScientificCode(code)
      } catch {
        return deny('pre-flight check failed; supply analyzable Python text of at most 32768 characters.')
      }
      if (report.status === 'POTENTIAL_RISK') {
        const finding = report.findings[0]
        return deny(`SG001 potential preprocessing data leakage at fit_line=${finding?.fit_line}, split_line=${finding?.split_line}. Split first; fit preprocessing on training data only.`)
      }
      if (report.status !== 'NO_PATTERN_FOUND' || report.review_required !== false ||
          !Array.isArray(report.findings) || report.findings.length !== 0) {
        return deny('pre-flight analysis is incomplete or requires review.')
      }
      return { allow: true }
    })
    ctx.extension().registerTool({
      name: 'sciguard_check',
      description: 'Read-only advisory check of Python code for fitting preprocessing before train/test splitting. Returns risk evidence and suggestions; never executes code. No finding is not a safety guarantee.',
      parameters: {
        [Kind]: 'Object', type: 'object',
        properties: { code: { [Kind]: 'String', type: 'string', minLength: 1, maxLength: 32768 } },
        required: ['code'], additionalProperties: false,
      },
      meta: {
        isReadOnly: true, isDestructive: false, isConcurrencySafe: true,
        isOpenWorld: false, replay: 'safe', costHint: undefined, deferLoading: false, requiresApproval: 'never',
      },
      async execute({ code }) {
        const structured = checkScientificCode(code)
        return { content: [{ type: 'text', text: JSON.stringify(structured) }], structured }
      },
    })
    ctx.extension().registerTool({
      name: 'sciguard_run_demo',
      description: 'Run the fixed sklearn breast-cancer classification demo after mandatory SG001 checking. variant=risky is blocked without Python execution; variant=corrected trains a model using the project virtualenv. No arbitrary code accepted. Host approval and command execution policies apply.',
      parameters: {
        [Kind]: 'Object', type: 'object', properties: {
          variant: { [Kind]: 'Union', anyOf: ['risky', 'corrected'].map(value => ({ [Kind]: 'Literal', const: value, type: 'string' })) },
        }, required: ['variant'], additionalProperties: false,
      },
      meta: { isReadOnly: true, isDestructive: false, isConcurrencySafe: false,
        isOpenWorld: false, replay: 'never', costHint: { wallMs: 60000 },
        deferLoading: false, requiresApproval: 'always' },
      async execute({ variant }, context) {
        const structured = await runFixedExperiment(variant, context, checkScientificCode)
        return { content: [{ type: 'text', text: JSON.stringify(structured) }], structured,
          isError: structured.status !== 'COMPLETED' }
      },
    })
  },
}
