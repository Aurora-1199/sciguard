import { join } from 'node:path'

export function fixedExperimentCode(variant) {
  if (!['risky', 'corrected'].includes(variant)) throw new TypeError('Unknown experiment variant')
  const preprocessing = variant === 'risky'
    ? 'X_scaled = scaler.fit_transform(X)\nX_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, stratify=y, random_state=42)'
    : 'X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)\nX_train = scaler.fit_transform(X_train)\nX_test = scaler.transform(X_test)'
  return `import json, sys
import sklearn
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix
X, y = load_breast_cancer(return_X_y=True)
scaler = StandardScaler()
${preprocessing}
model = LogisticRegression(solver="liblinear", max_iter=2000, random_state=42)
model.fit(X_train, y_train)
predicted = model.predict(X_test)
print(json.dumps({
    "dataset": "sklearn_breast_cancer", "seed": 42,
    "train_samples": int(len(y_train)), "test_samples": int(len(y_test)),
    "accuracy": float(accuracy_score(y_test, predicted)),
    "confusion_matrix": confusion_matrix(y_test, predicted).tolist(),
    "python_version": sys.version.split()[0], "sklearn_version": sklearn.__version__
}, allow_nan=False))
`
}

// The only execution input is our fixed program. No user-provided code, paths or commands.
export async function runFixedExperiment(variant, context, checker) {
  const code = fixedExperimentCode(variant)
  const report = checker(code)
  if (report.status !== 'NO_PATTERN_FOUND' || report.review_required !== false || report.findings.length) {
    return { status: 'BLOCKED', executed: false, variant, check_report: report }
  }
  context.signal?.throwIfAborted()
  const python = process.platform === 'win32'
    ? join(context.cwd, 'node_modules', '.cache', 'sciguard-python', 'Scripts', 'python.exe')
    : join(context.cwd, 'node_modules', '.cache', 'sciguard-python', 'bin', 'python')
  const started = Date.now()
  const result = await context.exec([python, '-I', '-B', '-'], {
    cwd: context.cwd, stdin: code, timeoutMs: 60000,
    env: { OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
  })
  if (result.code !== 0 || result.timedOut || result.truncated) {
    return { status: 'EXECUTION_FAILED', executed: true, variant, check_report: report,
      exit_code: result.code, timed_out: Boolean(result.timedOut), truncated: result.truncated,
      stderr: result.stderr.slice(0, 4096) }
  }
  let metrics
  try { metrics = JSON.parse(result.stdout.trim()) } catch { throw new Error('Experiment returned invalid JSON') }
  if (metrics.dataset !== 'sklearn_breast_cancer' || metrics.seed !== 42 ||
      !Number.isFinite(metrics.accuracy) || metrics.accuracy < 0 || metrics.accuracy > 1 ||
      metrics.train_samples !== 455 || metrics.test_samples !== 114) {
    throw new Error('Experiment returned invalid metrics')
  }
  return { status: 'COMPLETED', executed: true, variant, check_report: report,
    metrics, duration_ms: Date.now() - started }
}
