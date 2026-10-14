import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ScriptedProvider } from '@agnes/ai/testkit'
import type { ExtensionAPI } from '@agnes/extension-api'
import { hashDirectory, type RuntimePluginSnapshot } from '@agnes/package-manager'
import { buildRuntimeTarget, createPluginRow } from '@agnes/plugin-runtime/host'
import type { InferenceEvent } from '@agnes/protocol'
import { Type } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'
import { createTestHost } from '../../testkit/index.js'
import { packageDirs, scratch, settle } from './plugin-extension-fixture.js'

const HOT_TOOL = fileURLToPath(new URL('../../../../examples/packages/hot-tool-plugin', import.meta.url))
const CONTEXT_NOTE = fileURLToPath(
  new URL('../../../../examples/packages/hook-context-note', import.meta.url),
)
const TAKEOVER = fileURLToPath(new URL('../../../../examples/packages/hook-runner-takeover', import.meta.url))
const SCIGUARD = fileURLToPath(new URL('../../../../examples/packages/sciguard', import.meta.url))

function example(
  directory: string,
  packageId: string,
  snapshotIdFill: string,
): {
  snapshot: Readonly<RuntimePluginSnapshot>
  row: ReturnType<typeof createPluginRow>
} {
  const snapshotId = `sha256-${snapshotIdFill.repeat(64)}`
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'))
  const declared = manifest.agnes.plugins[0] as {
    export: string
    id: string
    inject: string[]
  }
  const snapshot: Readonly<RuntimePluginSnapshot> = {
    snapshot: Object.freeze({
      snapshotId,
      profile: 'local-dev',
      packageId,
      version: manifest.version,
      integrity: `sha256-${'a'.repeat(64)}`,
      treeIntegrity: hashDirectory(directory, { exclude: [] }),
      capabilityHash: 'capability',
      directory,
      contributions: Object.freeze([]),
    }),
    generation: 1,
    trusted: true,
  }
  const row = createPluginRow({
    id: declared.id,
    plugin: `${packageId}@${snapshotId}/${declared.export}`,
    snapshotDigest: `sha256-${'a'.repeat(64)}`,
    exportName: declared.export,
    entryRevision: snapshotId,
    extrasRevision: 'none',
    mountRevision: 'host-ordinary-row:v1',
    inject: declared.inject,
  })
  return { snapshot, row }
}

const target = (rows: ReturnType<typeof createPluginRow>[]) =>
  buildRuntimeTarget({
    rows,
    resources: { mcp: [], skills: {} },
    resourceRevision: '0'.repeat(64),
    compositeRevision: '0'.repeat(64),
  })

const callDemo = (text: string): InferenceEvent[] => [
  {
    type: 'toolcall_end',
    via: 'native',
    call: { toolUseId: '', name: 'demo_text_stats', args: { text }, ordinal: 0 },
  },
  { type: 'done', reason: 'toolUse' },
]

describe('the hook-context-note example (addition scenario)', () => {
  it('adds its own section to the model-bound context, alongside every built-in contributor', async () => {
    const dataDir = scratch()
    const hotTool = example(HOT_TOOL, '@agnes-examples/hot-tool-plugin', '9')
    const note = example(CONTEXT_NOTE, '@agnes-examples/hook-context-note', '8')
    // A real Provider double, not just `script:`, so the actual RequestBody it receives (sections
    // included, not just the request/header event's hashes) is inspectable afterward.
    const provider = new ScriptedProvider({
      scripts: [
        [
          { type: 'text_delta', delta: 'ok' },
          { type: 'done', reason: 'stop' },
        ],
      ],
    })
    const { host } = await createTestHost({
      dataDir,
      packageDirs,
      provider,
      runtimePluginCatalogue: [hotTool.snapshot, note.snapshot],
      extensionLoader: {
        import: async (file) => (await import(pathToFileURL(file).href)) as Record<string, unknown>,
      },
    })
    await host.applyRuntimeTarget(target([hotTool.row, note.row]))
    await settle()

    const session = await host.createSession({ cwd: dataDir })
    await session.enqueue('next-turn', {
      actor: session.d.actor,
      content: [{ type: 'text', text: 'hello' }],
    })
    await session.run({ until: 'turn-end', signal: new AbortController().signal })
    const sawNote = provider.calls.some((call) =>
      call.system.includes('double-check any destructive shell command'),
    )
    expect(sawNote).toBe(true)
    await session.close()
    await host.close()
  })
})

describe('the hook-runner-takeover example (replacement scenario)', () => {
  it('replaces the builtin agnes/hooks-runner row and its tool_call hook genuinely blocks the marked demo call', async () => {
    const dataDir = scratch()
    const hotTool = example(HOT_TOOL, '@agnes-examples/hot-tool-plugin', '9')
    const takeover = example(TAKEOVER, '@agnes-examples/hook-runner-takeover', '7')
    const { host } = await createTestHost({
      dataDir,
      packageDirs,
      script: [callDemo('BLOCK_ME'), callDemo('allowed text'), [{ type: 'text_delta', delta: 'done' }]],
      runtimePluginCatalogue: [hotTool.snapshot, takeover.snapshot],
      extensionLoader: {
        import: async (file) => (await import(pathToFileURL(file).href)) as Record<string, unknown>,
      },
    })
    await host.applyRuntimeTarget(target([hotTool.row, takeover.row]))
    await settle()
    expect(host.extensions().find((e) => e.id === 'agnes/hooks-runner')?.loaded).toBe(false)

    const session = await host.createSession({ cwd: dataDir })
    await session.enqueue('next-turn', {
      actor: session.d.actor,
      content: [{ type: 'text', text: 'run the demo tool twice' }],
    })
    await session.run({ until: 'turn-end', signal: new AbortController().signal })
    const results = await session.scan({ type: 'tool/result', toSeq: session.lastSeq })
    const bodies = results.map((r) => JSON.stringify(r.data))
    expect(bodies.some((b) => b.includes('blocked by the hook-runner-takeover demo policy'))).toBe(true)
    expect(bodies.some((b) => b.includes('\\"words\\":2'))).toBe(true)
    await session.close()
    await host.close()
  })
})

describe('SciGuard pre-flight checks through Host tool dispatch (mock execution only)', () => {
  const cases = [
    {
      label: 'risky preprocessing',
      tool: 'run_code',
      code: 'X_scaled = scaler.fit_transform(X)\nX_train, X_test = train_test_split(X_scaled, y)',
      executes: 0,
      reason: 'SG001',
    },
    {
      label: 'split before fitting',
      tool: 'run_code',
      code: 'X_train, X_test = train_test_split(X, y)\nX_train = scaler.fit_transform(X_train)\nX_test = scaler.transform(X_test)',
      executes: 1,
    },
    { label: 'empty code', tool: 'run_code', code: '', executes: 0, reason: 'non-empty' },
    {
      label: 'oversized code',
      tool: 'run_code',
      code: 'x'.repeat(32769),
      executes: 0,
      reason: 'pre-flight check failed',
    },
    {
      label: 'unterminated string',
      tool: 'run_code',
      code: 'example = "unfinished',
      executes: 0,
      reason: 'incomplete',
    },
    {
      label: 'non-target tool',
      tool: 'sciguard_passthrough_probe',
      code: 'scaler.fit(X)\ntrain_test_split(X)',
      executes: 1,
    },
  ]
  it.each(cases)(
    '$label: executes the mock $executes times',
    async ({ tool: name, code, executes, reason }) => {
      let executeCount = 0
      const dataDir = scratch()
      const guard = example(SCIGUARD, '@sciguard/scientific-check', '6')
      const call: InferenceEvent[] = [
        { type: 'toolcall_end', via: 'native', call: { toolUseId: '', name, args: { code }, ordinal: 0 } },
        { type: 'done', reason: 'toolUse' },
      ]
      const { host } = await createTestHost({
        dataDir,
        packageDirs,
        presets: {
          standard: {
            name: 'standard',
            extends: 'base',
            disclosure: 'hybrid',
            model: { route: { primary: 'default' } },
          },
        },
        // Replace only the test Host's builtin factory; production registration stays unchanged.
        packages: {
          '@agnes/code': {
            ecosystem: {
              'agnes/code-mode': () => (agnes: ExtensionAPI) => {
                const disposers = ['run_code'].map((toolName) =>
                  agnes.registerTool({
                    name: toolName,
                    description: 'Mock execution counter; never runs Python.',
                    parameters: Type.Object({ code: Type.String() }, { additionalProperties: false }),
                    meta: {
                      isReadOnly: true,
                      isDestructive: false,
                      isConcurrencySafe: true,
                      isOpenWorld: false,
                      replay: 'safe',
                      costHint: undefined,
                      deferLoading: false,
                      requiresApproval: 'never',
                    },
                    async execute() {
                      executeCount++
                      return { content: [{ type: 'text', text: 'RUN_CODE_MOCK_EXECUTED' }] }
                    },
                  }),
                )
                return () => {
                  for (const dispose of disposers) dispose()
                }
              },
            },
          },
        },
        script: [
          call,
          [
            { type: 'text_delta', delta: 'done' },
            { type: 'done', reason: 'stop' },
          ],
        ],
        runtimePluginCatalogue: [guard.snapshot],
        extensionLoader: {
          import: async (file) => (await import(pathToFileURL(file).href)) as Record<string, unknown>,
        },
      })
      let session: Awaited<ReturnType<typeof host.createSession>> | undefined
      let disposeProbe: (() => void) | undefined
      try {
        const applied = await host.applyRuntimeTarget(target([guard.row]))
        await settle()
        expect(applied.ok).toBe(true)
        if (name !== 'run_code') {
          disposeProbe = host.kernel.tools.add(
            {
              name,
              description: 'Non-target mock; never executes Python.',
              parameters: Type.Object({ code: Type.String() }),
              meta: {
                isReadOnly: true,
                isDestructive: false,
                isConcurrencySafe: true,
                isOpenWorld: false,
                replay: 'safe',
                costHint: undefined,
                deferLoading: false,
                requiresApproval: 'never',
              },
              async execute() {
                executeCount++
                return { content: [{ type: 'text', text: 'RUN_CODE_MOCK_EXECUTED' }] }
              },
            },
            { source: 'test/sciguard/probe', trust: 'builtin' },
          )
        }
        expect(host.kernel.tools.list().map((tool) => tool.name)).toContain(name)
        session = await host.createSession({ cwd: dataDir })
        await session.enqueue('next-turn', {
          actor: session.d.actor,
          content: [{ type: 'text', text: 'test mock dispatch' }],
        })
        await session.run({ until: 'turn-end', signal: new AbortController().signal })
        const results = await session.scan({ type: 'tool/result', toSeq: session.lastSeq })
        const bodies = results.map((result) => JSON.stringify(result.data))
        expect(executeCount, bodies.join('\n')).toBe(executes)
        expect(bodies.some((body) => body.includes('RUN_CODE_MOCK_EXECUTED'))).toBe(executes === 1)
        expect(
          bodies.some((body) => body.includes('SciGuard blocked run_code')),
          bodies.join('\n'),
        ).toBe(executes === 0)
        if (reason) expect(bodies.some((body) => body.includes(reason))).toBe(true)
      } finally {
        await session?.close()
        disposeProbe?.()
        await host.close()
      }
    },
  )
})
