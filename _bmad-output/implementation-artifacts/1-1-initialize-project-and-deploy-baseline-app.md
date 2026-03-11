# Story 1.1: Initialize Project and Deploy Baseline App

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer**,
I want the Apolles project scaffolded with the T3-adjacent stack and deployed to Vercel,
so that all subsequent development starts from a consistent, deployable foundation.

## Acceptance Criteria (BDD)

1. **Given** the project is initialized with Next.js App Router, TypeScript, Tailwind CSS, Prisma, and NextAuth  
   **When** the project is pushed to GitHub  
   **Then** the app builds and runs locally without errors  
   **And** Vercel deployment produces a working preview environment

2. **Given** `@t3-oss/env-nextjs` is configured  
   **When** a required environment variable is missing  
   **Then** the build fails with a clear validation error

3. **Given** `.env.example` exists  
   **Then** it documents every required variable: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TBO_API_KEY`, `TBO_API_SECRET`, `EXPEDIA_API_KEY`, `EXPEDIA_API_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`, `STRIPE_SECRET_KEY`  
   **Note:** The architecture doc says `STRIPE_PUBLIC_KEY`, but `@t3-oss/env-nextjs` requires the `NEXT_PUBLIC_` prefix for client-side env vars. Use `NEXT_PUBLIC_STRIPE_PUBLIC_KEY` everywhere.

4. **Given** a server-side module imports `src/lib/logger.ts`  
   **When** it calls `logger.info(...)`, `logger.warn(...)`, or `logger.error(...)`  
   **Then** structured JSON output is written to stdout with fields: `timestamp`, `level`, `message`, `context` (optional object)

5. **Given** a server-side module imports `src/lib/errors.ts`  
   **When** it throws `new AppError(ErrorCodes.NOT_AUTHENTICATED, 'message')`  
   **Then** the error has typed `code`, `message`, `statusCode`, and `isOperational` properties  
   **And** the following error codes are defined: `NOT_AUTHENTICATED`, `NOT_AUTHORIZED`, `VALIDATION_ERROR`, `SUPPLIER_TIMEOUT`, `SUPPLIER_ERROR`, `RATE_UNAVAILABLE`, `PRICE_CHANGED`, `BOOKING_FAILED`, `BOOKING_ALREADY_EXISTS`

6. **Given** `src/lib/db.ts` exports a Prisma client singleton  
   **When** imported from any server-side module  
   **Then** only one Prisma client instance exists in development (hot reload safe)

7. **Given** the Tailwind/CSS configuration is set up  
   **Then** the Apolles design tokens are defined: full color palette (primary, neutral, status), typography scale (Inter + JetBrains Mono), and spacing scale (4px base unit)

8. **Given** shadcn/ui is installed  
   **Then** base components exist in `src/components/ui/`: Button, Input, Badge, Card, Dialog, Skeleton, Sonner (toast provider), Separator

## Tasks / Subtasks

- [x] **Task 1: Scaffold project with create-t3-app** (AC: #1)
  - [x] Run: `pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false`
  - [x] Verify tRPC and Drizzle are NOT present in the scaffold (the flags above should exclude them; if any remnant, remove manually)
  - [x] Verify local build succeeds (`pnpm build`)
  - [x] Verify dev server starts (`pnpm dev`)

- [x] **Task 2: Configure environment validation** (AC: #2, #3)
  - [x] Create `src/env.ts` (or update if scaffolded) with `@t3-oss/env-nextjs`
  - [x] Define all 9 required env vars with Zod schemas
  - [x] Create `.env.example` documenting all variables
  - [x] Create `.env.local` for local development (gitignored)
  - [x] Verify build fails when a required var is missing

- [x] **Task 3: Implement structured logger** (AC: #4)
  - [x] Create `src/lib/logger.ts`
  - [x] Implement `info()`, `warn()`, `error()`, `debug()` methods
  - [x] Output structured JSON: `{ timestamp, level, message, context }` (context as nested object, never flattened)
  - [x] Console-based (no external service for MVP)

- [x] **Task 4: Implement error factory** (AC: #5)
  - [x] Create `src/lib/errors.ts`
  - [x] Implement `AppError` class extending `Error` with `code`, `message`, `statusCode`, `isOperational`
  - [x] Define `ErrorCodes` const object with all 9 typed codes (see Dev Notes)

- [x] **Task 5: Configure Prisma client singleton** (AC: #6)
  - [x] Create/update `src/lib/db.ts` with hot-reload-safe singleton pattern
  - [x] Verify Prisma client connects to Supabase Postgres via `DATABASE_URL`
  - [x] Ensure `globalThis` caching for development mode

- [x] **Task 6: Set up Apolles design tokens** (AC: #7)
  - [x] Configure design tokens in Tailwind v4 CSS-first format (see Dev Notes below)
  - [x] Define all color tokens (primary, neutral, status palettes — exact values below)
  - [x] Configure typography (Inter via `next/font/google`, JetBrains Mono via `next/font/google`)
  - [x] Define spacing scale (4px base unit)
  - [x] Configure responsive breakpoints (Tailwind uses mobile-first min-width: sm/md/lg/xl/2xl — UX is designed desktop-first but Tailwind classes are applied mobile-first)
  - [x] Set up transition/animation tokens

- [x] **Task 7: Install and configure shadcn/ui** (AC: #8)
  - [x] Run `pnpm dlx shadcn@latest init` (configure for App Router, Tailwind v4, src/ directory)
  - [x] Install 8 base components: `button`, `input`, `badge`, `card`, `dialog`, `skeleton`, `toast` (sonner), `separator`
  - [x] Verify components render correctly with Apolles design tokens
  - [x] Install `lucide-react` for icons (shadcn/ui default icon library)

- [x] **Task 8: Set up project directory structure** (AC: #1)
  - [x] Create `src/components/ui/` (populated by shadcn/ui in Task 7)
  - [x] Create `src/components/layout/` (empty — populated in Story 1.4)
  - [x] Create `src/lib/` with real files: `db.ts`, `errors.ts`, `logger.ts`, `utils.ts` (cn() helper for shadcn/ui)
  - [x] Create `src/lib/auth.ts` as minimal placeholder (full implementation in Story 1.3)
  - [x] Create `src/middleware.ts` as minimal placeholder (full implementation in Story 1.4)
  - [x] Create `src/env.ts` for env validation
  - [x] Do NOT create empty `src/features/` subdirectories — they will be created by the stories that populate them

- [x] **Task 9: Configure testing framework** (AC: #1)
  - [x] Install Vitest: `pnpm add -D vitest @vitejs/plugin-react`
  - [x] Create `vitest.config.ts` with path aliases matching `tsconfig.json`
  - [x] Add test script to `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`
  - [x] Verify a trivial test runs successfully

- [ ] **Task 10: Deploy to Vercel** (AC: #1)
  - [ ] Push project to GitHub repository
  - [ ] Connect GitHub repo to Vercel
  - [ ] Configure environment variables in Vercel dashboard (use placeholder values for supplier keys)
  - [ ] Verify preview deployment builds and serves the app
  - [ ] Verify HTTPS is enforced automatically

## Scope Boundaries — Do NOT Implement

These are implemented in subsequent stories — do NOT implement them here:

- **User/Session/Account Prisma models** -> Story 1.2
- **NextAuth full configuration** (credentials provider, Prisma adapter, session callbacks) -> Story 1.3
- **Login page UI** -> Story 1.3
- **Dashboard shell, sidebar navigation** -> Story 1.4
- **Auth redirect middleware logic** -> Story 1.4
- **Authorization module (`requireAuth`, `requireRole`)** -> Story 1.5
- **Agent management CRUD** -> Story 1.6
- **Empty `src/features/` subdirectories** -> created by the stories that populate them

## Dev Notes

### Critical: Tailwind CSS v4 Configuration

`create-t3-app@7.40.0` ships with **Tailwind CSS v4**, which uses a completely different configuration approach than v3. There is **no `tailwind.config.js` file** in v4. Configuration is done via **CSS `@theme` directive** in `src/app/globals.css`.

The architecture document and UX spec reference `tailwind.config.js` — this is outdated for Tailwind v4. Implement design tokens using the Tailwind v4 CSS-first approach. **All downstream stories** that mention `tailwind.config.js` should also use `globals.css` `@theme` blocks instead. This story sets the canonical pattern:

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Primary Palette */
  --color-primary: #635BFF;
  --color-primary-hover: #5046E5;
  --color-primary-light: #EEF0FF;
  --color-dark: #0A2540;
  --color-dark-secondary: #1A3A5C;
  --color-accent: #00D4FF;

  /* Neutral Palette */
  --color-surface: #F6F9FC;
  --color-card: #FFFFFF;
  --color-border: #D6E3F0;
  --color-border-subtle: #E8EDF4;
  --color-text-primary: #1F2937;
  --color-text-secondary: #6B7280;
  --color-text-muted: #9CA3AF;

  /* Status Colors */
  --color-success: #059669;
  --color-success-bg: #ECFDF5;
  --color-warning: #D97706;
  --color-warning-bg: #FFFBEB;
  --color-error: #DC2626;
  --color-error-bg: #FEF2F2;
  --color-info: #2563EB;
  --color-info-bg: #EFF6FF;
  --color-neutral: #6B7280;
  --color-neutral-bg: #F3F4F6;

  /* Typography */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Spacing (4px base) */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-10: 40px;
}
```

This makes tokens available as Tailwind utilities: `bg-primary`, `text-text-primary`, `text-success`, `font-sans`, `font-mono`, etc.

### Font Loading (Next.js)

```typescript
// src/app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

// Apply to <html> element:
// <html className={`${inter.variable} ${jetbrainsMono.variable}`}>
```

### Prisma Client Singleton Pattern

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

### Error Factory Pattern

```typescript
// src/lib/errors.ts
export const ErrorCodes = {
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SUPPLIER_TIMEOUT: 'SUPPLIER_TIMEOUT',
  SUPPLIER_ERROR: 'SUPPLIER_ERROR',
  RATE_UNAVAILABLE: 'RATE_UNAVAILABLE',
  PRICE_CHANGED: 'PRICE_CHANGED',
  BOOKING_FAILED: 'BOOKING_FAILED',
  BOOKING_ALREADY_EXISTS: 'BOOKING_ALREADY_EXISTS',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### Structured Logger Pattern

```typescript
// src/lib/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context !== undefined && { context }),
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
};
```

### Server Action Response Pattern (for reference — used from Story 1.3+)

```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
```

### Environment Validation

```typescript
// src/env.ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url(),
    TBO_API_KEY: z.string().min(1),
    TBO_API_SECRET: z.string().min(1),
    EXPEDIA_API_KEY: z.string().min(1),
    EXPEDIA_API_SECRET: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
  },
  client: {
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: z.string().min(1),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    TBO_API_KEY: process.env.TBO_API_KEY,
    TBO_API_SECRET: process.env.TBO_API_SECRET,
    EXPEDIA_API_KEY: process.env.EXPEDIA_API_KEY,
    EXPEDIA_API_SECRET: process.env.EXPEDIA_API_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY,
  },
});
```

### Project Structure (create at scaffold)

```
apolles/
├── prisma/
│   └── schema.prisma          # Minimal — just datasource + generator (models in Story 1.2)
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── globals.css         # Tailwind v4 @theme tokens
│   │   ├── layout.tsx          # Root layout with fonts
│   │   ├── page.tsx            # Placeholder home page
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts  # NextAuth API route placeholder
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components (8 base)
│   │   └── layout/             # Empty — populated in Story 1.4
│   ├── lib/
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── auth.ts             # NextAuth config placeholder (implemented Story 1.3)
│   │   ├── errors.ts           # AppError + ErrorCodes
│   │   ├── logger.ts           # Structured JSON logger
│   │   └── utils.ts            # cn() helper for shadcn/ui classnames
│   ├── middleware.ts            # Placeholder (implemented Story 1.4)
│   └── env.ts                  # @t3-oss/env-nextjs validation
├── .env.example
├── .env.local                  # Gitignored
├── .gitignore
├── next.config.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### Naming Conventions

| What | Convention | Example |
|---|---|---|
| Files | kebab-case | `search-service.ts`, `hotel-result-card.tsx` |
| Components | PascalCase | `HotelResultCard`, `StatusBadge` |
| Functions/variables | camelCase | `getBookingById`, `supplierAmount` |
| Types/interfaces | PascalCase | `BookingStatus`, `SupplierSearchResult` |
| Constants | SCREAMING_SNAKE_CASE | `ERROR_CODES`, `MAX_TIMEOUT` |
| Zod schemas | PascalCase + Schema | `SearchSchema`, `BookingSchema` |

### Technology Versions (verified 2026-03-11)

| Package | Version from create-t3-app | Notes |
|---|---|---|
| Next.js | ^15.2.3 | App Router, Turbopack dev |
| React | ^19.0.0 | React 19 |
| TypeScript | ^5.8.2 | Strict mode |
| Tailwind CSS | ^4.0.15 | **v4 — CSS-first config, no tailwind.config.js** |
| Prisma | ^6.6.0 | PostgreSQL provider |
| next-auth | 5.0.0-beta.25 | Auth.js v5 API; Story 1.3 must use v5 patterns (`auth()`, exported handlers) |
| @t3-oss/env-nextjs | ^0.12.0 | Zod-based env validation |
| Zod | ^3.24.2 | Validation library |
| pnpm | latest | Package manager |

### Accessibility Baseline (set up in this story, enforced from Story 1.4+)

- Use `rem` for typography and spacing in CSS
- Focus indicator: 2px `--primary` (#635BFF) outline, 2px offset on all interactive elements
- `prefers-reduced-motion` media query respected
- Semantic HTML elements (`<main>`, `<nav>`, `<header>`, `<section>`, `<article>`)
- Skip-to-content link pattern (placeholder — activated in Story 1.4)

### Project Context Reference

- **PRD:** `_bmad-output/planning-artifacts/prd.md` — T3-stack mandate, NFRs for security/performance
- **Architecture:** `_bmad-output/planning-artifacts/architecture.md` — Full stack spec, directory structure, code patterns, error handling
- **UX Design:** `_bmad-output/planning-artifacts/ux-design-specification.md` — Design tokens, typography, color palette, accessibility requirements
- **Epics:** `_bmad-output/planning-artifacts/epics.md` — Story 1.1 acceptance criteria, Epic 1 overview

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- `pnpm dlx create-t3-app@latest apolles --CI --appRouter --tailwind --prisma --nextAuth --dbProvider postgres --trpc false --drizzle false`
- `pnpm dlx shadcn@latest init -d -y`
- `pnpm dlx shadcn@latest add input badge card dialog skeleton sonner separator`
- `pnpm add lucide-react`
- `pnpm add -D vitest @vitejs/plugin-react`
- `NEXTAUTH_SECRET= pnpm build` (expected failure validation check)
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `bash start-database.sh` (blocked: Docker/Podman not installed)
- `pnpm prisma db pull` (blocked: P1001, localhost:5432 unreachable)
- `pnpm prisma db pull` with Supabase `DATABASE_URL` (connection opened, introspection did not complete within timeout)
- `pnpm exec node --input-type=module -e 'import { PrismaClient } from "@prisma/client"; const db = new PrismaClient(); const result = await db.$queryRaw\`SELECT 1 as ok\`; console.log(JSON.stringify(result)); await db.$disconnect();'` (verified Supabase connectivity)

### Completion Notes List

- Scaffolded `apolles/` with create-t3-app (Next.js App Router + TypeScript + Tailwind v4 + Prisma + NextAuth) and verified no tRPC/Drizzle dependencies.
- Implemented typed env validation in `src/env.ts` and updated `.env.example` plus local `.env.local` placeholders for all required variables.
- Added foundational libraries: structured JSON logger (`src/lib/logger.ts`), typed `AppError` + `ErrorCodes` (`src/lib/errors.ts`), Prisma singleton (`src/lib/db.ts`), auth placeholder (`src/lib/auth.ts`), and middleware placeholder (`src/middleware.ts`).
- Configured Tailwind v4 token system in `src/app/globals.css` (palette, typography, spacing, breakpoints, motion tokens, focus + reduced-motion baseline).
- Installed shadcn/ui and added base UI primitives (Button, Input, Badge, Card, Dialog, Skeleton, Sonner toast provider, Separator) with `lucide-react`.
- Added Vitest with alias-aware config and passing baseline unit tests for logger, errors, and db singleton.
- Updated database source-of-truth from localhost Postgres to Supabase Postgres via `DATABASE_URL` while keeping Prisma provider as `postgresql`.
- Verified Prisma runtime connectivity to Supabase with a successful `SELECT 1` query (`[{"ok":1}]`), removing Docker/local Postgres dependency for this story.

### File List

Tracked files only:
- _bmad-output/implementation-artifacts/1-1-initialize-project-and-deploy-baseline-app.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- apolles/.env.example
- apolles/components.json
- apolles/next.config.ts
- apolles/package.json
- apolles/pnpm-lock.yaml
- apolles/prisma/schema.prisma
- apolles/vitest.config.ts
- apolles/src/env.ts
- apolles/src/middleware.ts
- apolles/src/app/globals.css
- apolles/src/app/layout.tsx
- apolles/src/app/page.tsx
- apolles/src/app/api/auth/[...nextauth]/route.ts
- apolles/src/lib/auth.ts
- apolles/src/lib/db.ts
- apolles/src/lib/db.test.ts
- apolles/src/lib/errors.ts
- apolles/src/lib/errors.test.ts
- apolles/src/lib/logger.ts
- apolles/src/lib/logger.test.ts
- apolles/src/lib/utils.ts
- apolles/src/components/ui/badge.tsx
- apolles/src/components/ui/button.tsx
- apolles/src/components/ui/card.tsx
- apolles/src/components/ui/dialog.tsx
- apolles/src/components/ui/input.tsx
- apolles/src/components/ui/separator.tsx
- apolles/src/components/ui/skeleton.tsx
- apolles/src/components/ui/sonner.tsx

Note: `.env` and `.env.local` are intentionally gitignored and are not part of tracked story files.

### Git Context Note

This project currently has a nested repo structure during implementation:
- Root repo (`Apolles - Lean`) tracks planning/implementation artifacts
- Nested app repo (`apolles/`) tracks application source changes

Reviewers should run git checks in both contexts when validating File List vs actual changes.

### Change Log

- 2026-03-11: Implemented Story 1.1 foundation tasks 1-4 and 6-9; partially completed Task 5 (Prisma singleton done, DB connectivity verification blocked by missing Docker/Podman). Task 10 (Vercel deployment) pending.
- 2026-03-11: Updated Story 1.1 database connectivity to Supabase Postgres, completed Task 5 using Prisma `DATABASE_URL` connectivity verification, and kept Task 10 pending.
- 2026-03-11: Code review fixes — removed stale `generated/` dir, empty `src/server/` tree, misleading `toast.tsx` wrapper, unused `@auth/prisma-adapter` dep; improved logger and db singleton test coverage; documented next-auth v5 divergence.
- 2026-03-11: Follow-up code review alignment — kept deployment pending, updated AC/component wording to Sonner toast provider, updated Task 5 wording to Supabase connectivity, corrected next-auth technology version note to v5 reality, cleaned File List to tracked files only, and added nested repo git context note.

## Senior Developer Review (AI)

**Review Date:** 2026-03-11
**Reviewer:** claude-opus-4-6 (adversarial code review)
**Review Outcome:** Changes Requested (7 fixed automatically, 2 informational)

### Findings Summary

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| H1 | High | Stale `generated/` directory with outdated Prisma client | Fixed |
| H2 | High | Empty `src/server/` and `src/server/auth/` directories left behind | Fixed |
| H3 | High | next-auth v5 beta installed vs v4 in story Dev Notes | Documented (see note below) |
| M1 | Medium | `toast.tsx` misleading re-export of Toaster as Toast | Fixed (removed) |
| M2 | Medium | `@auth/prisma-adapter` dead dependency not imported anywhere | Fixed (removed) |
| M3 | Medium | Missing `warn()` and `debug()` test coverage in `logger.test.ts` | Fixed |
| M4 | Medium | `db.test.ts` only checked existence, not singleton behavior | Fixed |
| L1 | Low | `@base-ui/react` and `next-themes` brought in by shadcn — legitimate | No action needed |
| L2 | Low | Story File List included `.env` as if tracked | Fixed (File List restructured) |

### Action Items

- [x] [AI-Review][High] Remove stale `generated/` directory
- [x] [AI-Review][High] Remove empty `src/server/` directory tree
- [x] [AI-Review][High] Document next-auth v5 divergence in Dev Notes
- [x] [AI-Review][Med] Remove misleading `toast.tsx` wrapper
- [x] [AI-Review][Med] Remove unused `@auth/prisma-adapter` dependency
- [x] [AI-Review][Med] Add `warn()` and `debug()` tests to `logger.test.ts`
- [x] [AI-Review][Med] Improve `db.test.ts` to verify singleton and globalThis caching

### Important Note: next-auth v5 (Auth.js)

`create-t3-app@7.40.0` installs `next-auth@5.0.0-beta.25` (Auth.js v5), not the `next-auth@^4.24.7` referenced in the story Dev Notes technology table. The v5 API is fundamentally different from v4:
- Uses `auth()` instead of `getServerSession()`
- Config exports `{ handlers, auth, signIn, signOut }` from a central `auth.ts`
- The `@auth/prisma-adapter` package is the v5-compatible adapter (was removed from Story 1.1 since auth is deferred to Story 1.3)

**Decision:** Keep next-auth v5 as the project direction. Story 1.3 implementation MUST use v5 API patterns, not the v4 `getServerSession()` examples in the architecture document. The architecture doc should be updated when Story 1.3 is created.

### Follow-up Review (AI)

**Review Date:** 2026-03-11
**Review Outcome:** Changes applied safely; deployment requirement intentionally left open

Resolved in this pass:
- Updated AC #8 wording to match current implementation (`Sonner` toast provider)
- Updated Task 5 wording from localhost PostgreSQL to Supabase Postgres via `DATABASE_URL`
- Updated Technology Versions next-auth row to installed v5 reality
- Cleaned File List to tracked files only
- Added nested repo git-context note for future reviewers

Open by design:
- Task 10 deployment remains pending
- AC #1 remains partial until actual GitHub + Vercel deployment is completed
