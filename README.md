# claude-mods

Small mods for [Claude Code](https://claude.com/claude-code), written as plugins of function hooks.

| Mod | What it does |
| --- | --- |
| [change-highlights](change-highlights) | After a turn that changed code, shows only the changes worth a developer's attention — the ones that do something new or non-obvious — and skips the ones that just reuse an existing pattern. |

## Install

At the prompt of a Claude Code session:

```
/plugin install change-highlights --marketplace cherniaiev04/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope = every session).

The function-hooks plugin API is early access and changes between Claude Code releases. These mods were built and tested on Claude Code 2.1.293.

## change-highlights

When a turn ends with at least 3 changed lines of code (Edit / Write / NotebookEdit; `.md`, `.txt`, `.canvas`, `.base` files are skipped), a reviewer sorts the changes into:

- **pattern** — reuses something the codebase already does (a copied controller shape, config wiring, renames);
- **specific** — new or non-obvious: an algorithm, an edge case, a workaround, a caching/security/concurrency decision.

Only the specific ones are shown, in a pane, at most three, each as `path:line`, the key lines of code, and — when the code doesn't speak for itself — a sentence on what it gains. When everything is routine you get a toast instead.

```
/highlights          open the pane (Older / Newer to browse the last 20)
/highlights sonnet   reviewer: Sonnet with the changes + full text of the changed files (default, cheap)
/highlights fork     reviewer: the session's own model over the whole conversation (sees patterns
                     in other files; more accurate, costs more)
```

The review runs in the background after the turn and costs one extra model call per turn that changed code.

## Develop

Run a mod from its folder instead of installing it, so edits reload while the session runs:

```
claude --plugin-dir ./change-highlights
```

or, for sessions the desktop app starts, list the folders in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/path/claude-mods/change-highlights" } }
```

Check and test:

```
claude plugin validate ./change-highlights
claude plugin test ./change-highlights
```

## License

MIT
