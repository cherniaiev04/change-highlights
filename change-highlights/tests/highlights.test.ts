import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const REVIEW = '## Worth your attention\n**Retry with jitter** `a/Retry.cs:12`\n\n## Pattern reuse\nController copied.'

// The engine's own turn events, as a session answers them.
function answerTurns(on: On) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

// What the surface does with the mod's status, toasts and panes.
function answerUi(on: On, toasts: string[]) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < 50; i++) {
    const v = await read()
    if (v !== undefined) return v
    await new Promise(r => setTimeout(r, 20))
  }
  return undefined
}

async function runTurn($: Parameters<Parameters<typeof test>[1] & Function>[0]) {
  await $.turn.start({ text: 'add retry', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a/Retry.cs', old_string: 'a\nb\nc', new_string: 'x\ny\nz' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: 'docs\nmore\nlines' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

async function shownReview($: Parameters<Parameters<typeof test>[1] & Function>[0]) {
  return waitFor(async () => {
    const ui = await $.ui.mount({ plugin: 'change-highlights', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'change-highlights' })
    const found = await ui.find({ type: 'Markdown' })
    await ui.unmount()
    return found?.text
  })
}

test('by default Sonnet reviews the code edits with the changed files, skipping notes', async ($, on) => {
  answerTurns(on)
  const toasts: string[] = []
  answerUi(on, toasts)
  mock.clock(on, { now: 1000 })
  mock.store(on)
  on('tool.call', () => ({ result: { ok: true } }) as never)
  on('fs.read', () => ({ value: 'class Retry { /* whole file */ }' }) as never)
  const asks: { model: string; prompt: string }[] = []
  on('model.complete', (_$, e) => {
    asks.push({ model: String(e.model), prompt: String(e.prompt) })
    return { value: { isAnswered: true, text: REVIEW } } as never
  })
  let forked = 0
  on('model.fork', () => {
    forked++
    return { value: { isAnswered: true, text: REVIEW } } as never
  })

  await runTurn($)

  expect(await shownReview($)).toBe(REVIEW)
  expect(toasts).toEqual(['change-highlights: non-standard changes found'])
  expect(forked).toBe(0)
  expect(asks.length).toBe(1)
  expect(asks[0]?.model).toBe('sonnet')
  expect(asks[0]?.prompt).toContain('add retry')
  expect(asks[0]?.prompt).toContain('whole file')
  expect(asks[0]?.prompt).not.toContain('README.md')
})

test('/highlights fork switches the review to the session model', async ($, on) => {
  answerTurns(on)
  answerUi(on, [])
  mock.clock(on, { now: 1000 })
  mock.store(on)
  on('tool.call', () => ({ result: { ok: true } }) as never)
  on('command.run', () => ({ text: '' }))
  let completed = 0
  on('model.complete', () => {
    completed++
    return { value: { isAnswered: true, text: REVIEW } } as never
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: REVIEW } }) as never)

  await $.command.run({ command: 'highlights', args: 'fork' } as never)
  await runTurn($)

  expect(await shownReview($)).toBe(REVIEW)
  expect(completed).toBe(0)
})

test('a turn without code edits asks nothing', async ($, on) => {
  answerTurns(on)
  let asked = 0
  on('model.fork', () => {
    asked++
    return { value: { isAnswered: true, text: REVIEW } } as never
  })
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ answer: 'hello', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await new Promise(r => setTimeout(r, 100))
  expect(asked).toBe(0)
})
