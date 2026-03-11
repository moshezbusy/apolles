# Story 1.2: Auth-Ready Data Model and Seed

Status: ready-for-dev

## Story

As a developer,
I want the foundational Prisma schema with User, Session, and Account models,
so that authentication and all future data models build on a stable foundation.

## Acceptance Criteria

1. Given the Prisma schema is created, when migrations are run, then `User` model exists with fields: `id (uuid)`, `email (unique)`, `name`, `passwordHash`, `role (enum: AGENT, ADMIN)`, `isActive (boolean, default true)`, `createdAt`, `updatedAt`.
2. `Account` and `Session` models exist per NextAuth Prisma adapter requirements.
3. Prisma Migrate generates and applies the initial migration successfully.
4. A seed script creates test data: one admin account (Moshe) and one agent account.
5. Prisma client singleton is configured and working.

## Tasks / Subtasks

- [ ] Task 1: Implement auth-ready Prisma schema (AC: #1, #2)
  - [ ] Add `Role` enum (`AGENT`, `ADMIN`) in `apolles/prisma/schema.prisma`.
  - [ ] Add `User` model with UUID id and required auth fields.
  - [ ] Add NextAuth-compatible `Account` and `Session` models.
  - [ ] Add `VerificationToken` model if required by the selected NextAuth v5 setup.
- [ ] Task 2: Create and apply initial migration (AC: #3)
  - [ ] Generate migration with Prisma Migrate.
  - [ ] Apply migration against Supabase Postgres via `DATABASE_URL`.
  - [ ] Verify migration artifacts are committed and reproducible.
- [ ] Task 3: Add seed script for baseline users (AC: #4)
  - [ ] Create `apolles/prisma/seed.ts` to insert one admin and one agent.
  - [ ] Hash seeded passwords with bcrypt before persistence.
  - [ ] Wire seed command in `apolles/package.json` (and Prisma config as needed).
- [ ] Task 4: Verify DB access and singleton usage (AC: #5)
  - [ ] Confirm `apolles/src/lib/db.ts` remains the single Prisma access point.
  - [ ] Add/update tests for schema-level assumptions and seed execution where practical.
  - [ ] Run `pnpm build`, `pnpm test`, `pnpm typecheck` after migration and seed setup.

## Dev Notes

- Story 1.1 already established Supabase Postgres as source of truth through `DATABASE_URL`; keep Prisma datasource provider as `postgresql` and do not introduce local DB assumptions.
- Current `apolles/prisma/schema.prisma` is intentionally minimal and must be expanded in this story.
- Keep architecture boundaries: app/actions -> services -> Prisma in `src/lib/db.ts`; avoid direct DB access from UI layers.
- NextAuth package in the codebase is v5 beta, so model compatibility decisions must follow v5 adapter conventions.

### Project Structure Notes

- Update only schema/data bootstrap and related config for this story.
- Keep existing lean architecture and folder conventions from Story 1.1.
- Do not implement login pages, middleware auth enforcement, or role-check helpers here (those belong to later stories).

### References

- Epic 1 Story 1.2 definition and ACs [Source: `_bmad-output/planning-artifacts/epics.md#L363`]
- Core stack and Prisma/NextAuth direction [Source: `_bmad-output/planning-artifacts/architecture.md#L24`]
- NextAuth DB sessions and role model direction [Source: `_bmad-output/planning-artifacts/architecture.md#L295`]
- Existing Story 1.1 Supabase direction and constraints [Source: `_bmad-output/implementation-artifacts/1-1-initialize-project-and-deploy-baseline-app.md`]

## Dev Agent Record

### Agent Model Used

openai/gpt-5.3-codex

### Debug Log References

- Story file created from Epic 1 backlog auto-selection (`1-2-auth-ready-data-model-and-seed`).

### Completion Notes List

- Created Story 1.2 implementation-ready context file with AC-driven tasks.
- Aligned migration/seed instructions to Supabase Postgres via `DATABASE_URL`.
- Kept deployment work out of scope per current sprint state.

### File List

- _bmad-output/implementation-artifacts/1-2-auth-ready-data-model-and-seed.md
