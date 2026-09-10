# Repository guidance

## Core intent

- Respect the existing architecture and coding standards.
- Prefer readable, explicit solutions over clever shortcuts.
- Prioritize maintainability, clarity, short methods and classes, and clean code.
- Keep it simple (KISS).
- Avoid unnecessary duplication (DRY).

## Development services

```sh
pnpm dev
```

## Skills

Repository-specific agent skills are stored under `.agents/skills/`.

## Testing

We do not use automated testing in this codebase, with one exception: the pure-function tournament domain layer under `src/domain/tournament/` has Vitest unit tests (`pnpm test`), co-located as `*.test.ts` next to the file they cover. Coverage there is partial, not exhaustive — see `HANDOFF.md`'s "Immediate next priorities" for what's covered and what's still open. Everything else in the app (React components, hooks, wiring, server functions) still has none.

## Validating changes

After you make any changes don't do a full compile/lint/build check.
Instead only check the parts of the codebase that you have changed.
You can just check typescript errors and lint and formatting errors for specific files.
Ignore any errors that are not related to the changed code.

Useful focused checks:

```sh
pnpm exec eslint path/to/file.ts
pnpm exec prettier --check path/to/file.ts
```

## Working process

Two local docs, two jobs — don't blend them (both are gitignored, working docs only, not part of the public repo):

- **`HANDOFF.md`** — current state only: rules, mechanics, what's built, what's not, known issues, immediate priorities. Deliberately small — read it in full at the start of any real work session.
- **`HANDOFF_LOG.md`** — the dated build history. Append-only, one entry per build. Meant to be searched (`grep` a function name, feature, or date), not read start to end.

### Before starting work

Read `HANDOFF.md` fresh, every session — don't rely on this conversation's own memory of "what's already done," and don't trust a prior write-up's account without checking. If a specific past decision's reasoning matters, `grep` `HANDOFF_LOG.md` for the section title (the "Immediate next priorities" list in `HANDOFF.md` names every entry) rather than reading the whole log.

### Design forks

When there's a genuine fork with real consequences (a pairing convention, how something should distribute, what a feature actually means) — surface it as a small set of concrete options via `AskUserQuestion` rather than silently picking one. Lower-stakes judgment calls get made directly, stated clearly in the HANDOFF_LOG entry, and left open to correction — not turned into a question every time. For anything spatial (bracket shape, room layout, a UI mockup), prefer an actual visual (Artifact / the visualize tool) over describing it in prose.

### Scoping work

- Isolate foundational/cross-cutting changes (a refactor, a shared bug fix) into their own pass, separate from feature work, even when combining would be faster.
- When the same bug pattern shows up more than once in different contexts, that recurrence is itself the signal to fix the root cause, not patch each instance again.
- On a multi-part task, check in after each independent part before starting the next — don't push a whole approved plan through in one uninterrupted pass.
- Test with awkward, non-round player/team counts first, not just clean ones — see "One important principle" in `HANDOFF.md`.

### Before calling a build done

Verify independently — actually exercise the change (dev server + browser console, not just re-reading the diff) before trusting it works. Per "Validating changes" above, skip full compile/lint/build checks — run the focused `eslint`/`prettier` checks on changed files instead. For anything non-trivial, prefer a fresh check with no memory of writing the code (a subagent, or the `/code-review` skill) over reviewing your own work in the same breath.

### Closing out a build

Every build gets a dated `HANDOFF_LOG.md` entry: context/reasoning, independently-testable parts, testing performed (including the awkward-number cases), and an explicit "out of scope" section for anything real that was deliberately not done. Add a matching one-line pointer to `HANDOFF.md`'s "Immediate next priorities" list, and update "What is NOT yet built" / "Known issues" there if the build closes or changes either. Parked items get written down explicitly, never just dropped.
