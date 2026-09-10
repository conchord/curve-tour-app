---
name: project-structure
description: Design or refactor a clean, scalable file structure for a TypeScript web app. Use when the user asks about project organization, folder structure, TanStack Start routes, feature modules, reusable components, server functions, types, schemas, or keeping page files minimal. Prefer KISS, DRY, feature-first organization, thin routes, and clear client/server boundaries.
---

Create a practical TypeScript web app structure.

Prioritize:

- Feature-first organization.
- Thin route files.
- Clear separation of route wiring, feature UI, reusable UI, server functions, server-only logic, client-only logic, types, schemas, and utilities.
- Minimal page files that compose smaller components.
- Explicit naming over clever abstractions.
- Avoid barrel files unless requested.

## Principles

### Routes are thin

For file-based routers such as TanStack Start, keep `src/routes/` focused on:

- route definitions
- loaders
- redirects
- route-level auth checks
- rendering feature page components

Avoid putting large UI or business logic directly in route files.

\```tsx
// src/routes/bugs/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { BugsOverviewPage } from '@/features/bugs/components/overview/BugsOverviewPage'
import { getBugs } from '@/features/bugs/server/bugs.server-fns'

export const Route = createFileRoute('/bugs/')({
loader: () => getBugs(),
component: BugsOverviewPage,
})
\```

### Use feature-first folders

Feature-specific code belongs in `src/features/<feature>/`.

\```txt
features/
bugs/
components/
overview/
detail/
shared/

    server/
      bugs.server-fns.ts
      bugs.service.ts
      bugs.repository.ts
      bugs.queries.ts

    client/
      useBugFilters.ts
      useBugSearchParams.ts

    utils/
      bug-formatters.ts
      bug-status.ts

    bugs.types.ts
    bugs.schemas.ts
    bugs.constants.ts

\```

Prefer simple files like `bugs.types.ts`, `bugs.schemas.ts`, and `bugs.constants.ts`.
Only create folders like `types/`, `schemas/`, or `constants/` when the feature grows enough to justify them.

### Separate server functions from server logic

Use this convention:

\```txt
server/
bugs.server-fns.ts // framework-facing server functions, e.g. createServerFn
bugs.service.ts // business logic
bugs.repository.ts // database access
bugs.queries.ts // reusable query builders
\```

Rules:

- Route files import from `*.server-fns.ts`.
- `*.server-fns.ts` calls services.
- Services call repositories.
- Repositories talk to the database.
- Do not put database queries directly in route files.
- Do not put business logic directly in route files.

### Separate reusable and feature-specific components

\```txt
src/components/ui/ // generic reusable UI primitives
src/components/layout/ // generic app layout
src/features/\*/components/ // feature-specific components
\```

Decision rule:

\```txt
Used by many features? -> src/components/
Used only by one feature? -> src/features/<feature>/components/
Used only by one page area? -> src/features/<feature>/components/<area>/
\```

Do not move something to `src/components/` just because it might be reused later.

### Types and schemas

Prefer colocated feature files:

\```txt
features/bugs/bugs.types.ts
features/bugs/bugs.schemas.ts
features/auth/auth.types.ts
features/auth/auth.schemas.ts
\```

Use global `src/types/` only for types shared across multiple unrelated features.

Avoid vague files:

\```txt
types.ts
utils.ts
helpers.ts
\```

Prefer specific names:

\```txt
bugs.types.ts
bug-formatters.ts
auth.session.ts
\```

## Recommended base structure

\```txt
src/
routes/
\_\_root.tsx
index.tsx

features/
auth/
components/
server/
client/
utils/
auth.types.ts
auth.schemas.ts

    bugs/
      components/
        overview/
        detail/
        shared/

      server/
        bugs.server-fns.ts
        bugs.service.ts
        bugs.repository.ts
        bugs.queries.ts

      client/
        useBugFilters.ts
        useBugSearchParams.ts

      utils/
        bug-formatters.ts
        bug-status.ts

      bugs.types.ts
      bugs.schemas.ts
      bugs.constants.ts

components/
ui/
layout/

server/
db/
config/
middleware/

lib/
cn.ts
dates.ts
result.ts
invariant.ts

types/
common.types.ts
api.types.ts
\```

## Output instructions

When using this skill:

1. Infer the framework, routing style, features, server code, and user preferences from context.
2. Ask questions when needed.
3. Output a recommended folder tree.
4. Briefly explain the main decisions.
5. Include naming conventions and rules for where new files belong.
6. Keep the answer practical and concise.
7. Avoid enterprise-style folders like `application/`, `domain/`, `infrastructure/`, `adapters/`, or `core/` unless requested.
