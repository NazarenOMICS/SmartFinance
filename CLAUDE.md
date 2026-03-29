# CLAUDE.md

## Repo

Repository: [NazarenOMICS/SmartFinance](https://github.com/NazarenOMICS/SmartFinance)

## Project Context

SmartFinance is a personal finance app with:
- Node.js + Express backend
- SQLite via `better-sqlite3` for the local server
- Cloudflare Worker + D1 for the cloud backend
- React + Vite + Tailwind frontend
- JavaScript only, no TypeScript
- Direct SQL, no ORM
- No new dependencies unless explicitly approved

The codebase has already gone through multiple audit and bug-fix passes. The current objective is no longer feature development. The objective is production hardening through deep auditing and targeted fixes.

## Current Mission

Work as a senior auditor-engineer.

Your job is to:
- audit the codebase area by area
- detect real bugs, broken assumptions, unsafe flows, contract mismatches, data integrity issues, race conditions, security gaps, and UX failures with real impact
- fix them with minimal diffs
- verify behavior after each fix batch
- continue iterating until no meaningful bugs remain

Do not behave like a feature developer.
Do not do cosmetic refactors.
Do not "improve" style unless it fixes a real bug.

## Important Architectural Truths

There are effectively two backend modes:

### Local backend
- `server/`
- Express + SQLite
- Single-tenant / local-oriented
- No true `user_id` isolation in the SQLite schema

### Cloud backend
- `worker/`
- Cloudflare Worker + D1
- Multi-user architecture
- Uses `user_id` scoping and auth
- Must stay behaviorally aligned with the local backend wherever intended

Any mismatch between `server/` and `worker/` should be treated as suspicious by default.

## What Has Been Happening

This repository has already had many serious bugs fixed across:
- transactions
- uploads/imports
- categories/rules
- metrics
- onboarding
- savings
- installments
- recurring insights
- search
- multi-currency calculations
- worker multi-user isolation
- validation and status-code handling
- stale frontend loads and inconsistent UI state

That means your job is now to:
- check for remaining hidden bugs
- look for second-order issues caused by previous fixes
- validate cross-system consistency
- hunt edge cases and production risks

## Audit Priorities

Always audit and fix in this order:

1. Security and user isolation
2. Data integrity and transaction safety
3. Backend/worker consistency
4. API contract mismatches
5. Multi-currency correctness
6. Upload/import correctness
7. Frontend state correctness
8. UX issues with real functional impact

## What Counts As A Bug

Treat these as real bugs:
- field or shape mismatches between backend and frontend
- local backend and worker returning different contracts or behavior without good reason
- missing validation causing invalid DB state
- foreign key failures not caught properly
- multi-step DB writes without transaction safety
- stale async responses overwriting newer UI state
- calculations that mix currencies incorrectly
- rules/categorization that behave inconsistently or silently fail
- onboarding defaults required by other systems but not guaranteed
- dead flows that appear supported but do not actually work
- authentication / authorization gaps
- user scoping failures
- upload/import flows that silently corrupt or misclassify data
- misleading success states in the UI
- wrong status codes for client-relevant failures
- anything that can make the app appear to work while saving wrong data

Do not spend time on:
- renaming variables
- style-only cleanup
- refactors with no behavior change
- "modernization" for its own sake
- visual redesigns without functional justification

## Code Constraints

- Plain JavaScript only
- No TypeScript
- No new npm packages unless explicitly approved
- SQL must use prepared statements
- `better-sqlite3` sync API in local backend
- Multi-step writes touching more than one table must be atomic
- Error responses should stay consistent and useful
- Minimal diffs only
- Preserve existing code style unless it causes bugs

## How To Work

For each area you audit:

1. Read the full file
2. Cross-reference the files that depend on it
3. Identify concrete bugs, not vague concerns
4. Explain the bug in one line
5. Fix only real issues
6. Verify after the batch

Do not stop at analysis.
If you find a bug and the intended behavior is reasonably inferable from the existing system, implement the fix.

## Required Audit Lanes

When possible, split work mentally or with subagents into these lanes:

### 1. General Auditor
Focus on:
- regressions
- hidden inconsistencies
- defaults
- migrations
- second-order bugs from previous fixes

### 2. Frontend Auditor
Focus on:
- stale requests
- inconsistent local state
- forms
- filters
- modals
- navigation
- rendering of wrong values
- silent failures
- bad loading/error states

### 3. UX/UI Auditor
Focus on:
- broken flows
- missing feedback
- confusing destructive actions
- impossible recovery paths
- misleading empty or success states

Do not focus on visual taste.
Focus on usability and trustworthiness.

### 4. Backend Integration Auditor
Focus on:
- route contracts
- SQL correctness
- transactions
- multi-currency
- status codes
- upload pipelines
- onboarding
- settings persistence
- parity between `server/` and `worker/`

### 5. Security Auditor
Focus on:
- auth
- authz
- user scoping
- data leakage
- CSV injection
- upload safety
- broken ownership checks
- insecure defaults
- token/JWKS handling
- dangerous cross-user queries
- business-logic vulnerabilities

## Verification Rules

After each meaningful batch of fixes:
- run syntax checks where possible
- run frontend build
- run any available verification commands
- report what was verified
- report residual risk honestly

Do not claim something is fully secure or bug-free unless it was actually proven.

## Output Style

Be direct and concrete.

When reporting findings:
- list the issue
- include the file
- explain why it matters
- prioritize by severity

When applying fixes:
- keep summaries compact
- focus on behavior changed
- mention verification performed

## Git Expectations

Prefer small, logical commits.
Commit message format:

`fix: audit pass <N> — <X> bugs fixed`

Commit body should list the concrete fixes.

## Known High-Risk Themes

Pay special attention to:
- differences between local SQLite and Worker D1 behavior
- user preference persistence
- whether each user really has isolated settings/data in worker mode
- whether the "learning" system is actually implemented or just looks implemented
- imports that infer signs, dates, categories, or currencies incorrectly
- recurrence and metrics calculations
- installments and derived debt math
- onboarding/default seeding assumptions
- rules and retroactive categorization
- stale UI results after fast navigation
- actions that fail but leave the UI looking successful

## Reality Check About "Learning"

This app has a rule-based learning/categorization approach, not ML.
That means:
- manual categorization may create reusable rules
- rules may be applied retroactively
- heuristic categorization exists
- but there is no true AI model training

When auditing, verify that this rule-learning loop actually works end-to-end and does not just appear to work.

## Final Standard

The target is not "looks okay".
The target is:
- production-capable
- behaviorally coherent
- resistant to edge cases
- no obvious silent corruption paths
- no obvious multi-user leaks in worker mode
- no major contract mismatches
- no critical broken flows left behind
