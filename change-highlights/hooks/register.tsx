import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Highlight } from '../types'

const PANE = 'change-highlights'
const TITLE = 'Change highlights'
const history = atom({ plugin: 'change-highlights', key: 'history' } as const, [])
const cursor = atom({ plugin: 'change-highlights', key: 'cursor' } as const, -1)
const isBusy = atom({ plugin: 'change-highlights', key: 'isBusy' } as const, false)

type Change = { file: string; before: string; after: string }

// Notes and prose are not code: the vault, memory files, docs.
const SKIP = /\.(md|mdx|txt|canvas|base)$|\/Obsidian Vault\//i
const MIN_LINES = 3
const PER_CHANGE = 1500
const ALL_CHANGES = 24000

const lines = (s: string) => (s === '' ? 0 : s.split('\n').length)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(cut)` : s)

const describe = (changes: Change[]) => {
  let out = ''
  for (const c of changes) {
    const block =
      `### ${c.file}\n` +
      (c.before ? `--- before\n${clip(c.before, PER_CHANGE)}\n` : '(new file)\n') +
      `+++ after\n${clip(c.after, PER_CHANGE)}\n\n`
    if (out.length + block.length > ALL_CHANGES) {
      out += `…and ${changes.length - changes.indexOf(c)} more changes left out.\n`
      break
    }
    out += block
  }
  return out
}

type Mode = 'sonnet' | 'fork'
const MODES: readonly Mode[] = ['sonnet', 'fork']
const MODE_KEY = 'mode'
const PER_FILE = 30000
const ALL_FILES = 90000

const RULES = `Sort every change into one of two kinds:
- PATTERN: reuses something that already existed in this codebase (an existing controller/service/DTO/component shape, a copied test layout, config wiring, renames, mechanical follow-ups).
- SPECIFIC: does something the codebase did not do before, or does it in a non-obvious way: a new algorithm or rule, a tricky edge case, a workaround, a concurrency/security/caching decision, a surprising API use, a deliberate deviation from the existing pattern.

Write markdown, nothing before it, and keep it SHORT: the code carries the message, not prose.

For each SPECIFIC change, most important first (at most 3):

\`path:line\`
a fenced code block with only the interesting lines (at most ~10)
then, only if the code does not speak for itself, one or two plain sentences: what it does and what it gains (faster, safer, more reliable, simpler, ...). Leave the sentence out when the code is self-explanatory. Only in rare cases, when there is a real risk or a non-obvious trade-off, write a longer explanation (one short paragraph at most).

No headings, no titles, no bold labels, no summary, no list of the routine changes. Separate entries with a blank line.

If there is no SPECIFIC change, write only: "Nothing non-standard: every change follows an existing pattern."`

// Fork: the whole conversation is the context, so patterns from other files count too.
const FORK_PROMPT = (changes: string) => `You are reviewing the code changes made in the turn that just ended, for the developer who owns this code. Do not continue the task; only write this review. You have seen the codebase in this conversation; use it to judge what already existed.

${RULES} Use the language the developer writes in this conversation.

The changes (as given to the edit tools):

${changes}`

// Sonnet: no conversation, so the changed files themselves stand in for the codebase.
const SONNET_PROMPT = (task: string, changes: string, files: string) => `You are reviewing code changes an AI assistant just made, for the developer who owns this code. You see the developer's request, each change, and the full current text of the changed files. Judge PATTERN by what the rest of these files already did; when a change looks copied from code you cannot see, say "probably follows an existing pattern" rather than guessing.

${RULES} Write in the language of the developer's request.

<request>
${task || '(no text)'}
</request>

<changes>
${changes}
</changes>

<files>
${files}
</files>`

async function readFiles($: EngineInterface, done: Change[]) {
  let out = ''
  for (const file of [...new Set(done.map(c => c.file))]) {
    const text = await $.fs.read(file).catch(() => undefined)
    if (typeof text !== 'string') continue
    const block = `### ${file}\n${clip(text, PER_FILE)}\n\n`
    if (out.length + block.length > ALL_FILES) break
    out += block
  }
  return out
}

async function analyse($: EngineInterface, done: Change[], task: string) {
  await update($, isBusy, () => true)
  $.ui.status('change-highlights: reviewing changes…')
  try {
    const mode = ((await $.store.get(MODE_KEY)) as Mode | undefined) ?? 'sonnet'
    const changes = describe(done)
    let reply = mode === 'fork' ? await $.model.fork({ prompt: FORK_PROMPT(changes) }) : undefined
    if (!reply?.isAnswered) {
      const prompt = SONNET_PROMPT(task, changes, await readFiles($, done))
      reply = await $.model.complete({ model: 'sonnet', prompt, maxTokens: 2500, timeoutMs: 120000 })
    }
    if (!reply.isAnswered) {
      $.ui.toast(`change-highlights: no review (${reply.reason})`)
      return
    }

    const files = [...new Set(done.map(c => c.file.split('/').pop() ?? c.file))]
    const entry: Highlight = { at: await $.clock.now(), files, text: reply.text.trim() }
    await update($, history, list => [...list, entry].slice(-20))
    await update($, cursor, () => -1)

    const isRoutine = /Nothing non-standard/i.test(entry.text)
    if (isRoutine) {
      $.ui.toast('change-highlights: all changes follow existing patterns (/highlights)')
    } else {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      $.ui.toast(
        opened.isPlaced
          ? 'change-highlights: non-standard changes found'
          : 'change-highlights: non-standard changes found — /highlights to view',
      )
    }
  } catch (err) {
    $.ui.toast(`change-highlights failed: ${String(err)}`)
  } finally {
    $.ui.status(undefined)
    await update($, isBusy, () => false)
  }
}

export const register: Register = on => {
  let changes: Change[] = []
  let task = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'highlights',
      description: 'Show the non-standard code changes of recent turns; "sonnet" or "fork" picks the reviewer',
      argumentHint: '[sonnet|fork]',
    })
    return next(e)
  })

  on('command.run', { command: 'highlights' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked) {
      if (!MODES.includes(asked as Mode)) return { text: 'Usage: /highlights [sonnet|fork]' }
      await $.store.set(MODE_KEY, asked)
      return {
        text:
          asked === 'fork'
            ? 'Reviews now run on the session model over the whole conversation (more accurate, costlier).'
            : 'Reviews now run on Sonnet with the changed files only (cheap).',
      }
    }
    await update($, cursor, () => -1)
    await $.ui.open({ id: PANE, title: TITLE })
    const list = await read($, history)
    return { text: list.length ? 'Change highlights opened.' : 'No code changes analysed yet in this session.' }
  })

  on('turn.start', ($, e, next) => {
    changes = []
    task = e.text
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    let change: Change | undefined
    if (e.tool === 'Edit') change = { file: e.file_path, before: e.old_string, after: e.new_string }
    else if (e.tool === 'Write') change = { file: e.file_path, before: '', after: e.content }
    else if (e.tool === 'NotebookEdit') change = { file: e.notebook_path, before: '', after: e.new_source }

    if (change && !SKIP.test(change.file)) changes.push(change)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result

    const done = changes
    changes = []
    const size = done.reduce((n, c) => n + Math.max(lines(c.before), lines(c.after)), 0)
    if (done.length === 0 || size < MIN_LINES) return result

    void analyse($, done, task)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, history)
    const busy = await read($, isBusy)
    const at = await read($, cursor)
    const i = at < 0 || at >= list.length ? list.length - 1 : at
    const shown = list[i]

    if (!shown) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{busy ? 'Reviewing the changes…' : 'No code changes analysed yet.'}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {i + 1}/{list.length} · {shown.files.slice(0, 4).join(', ')}
            {shown.files.length > 4 ? ` +${shown.files.length - 4}` : ''}
            {busy ? ' · reviewing new changes…' : ''}
          </Text>
          {i > 0 && <Button key="older" label="Older" onPress={() => update($, cursor, () => i - 1)} />}
          {i < list.length - 1 && (
            <Button key="newer" label="Newer" onPress={() => update($, cursor, () => i + 1)} />
          )}
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Markdown text={shown.text} />
      </Box>
    )
  })
}
