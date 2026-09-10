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

We do not use automated testing in this codebase.

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
