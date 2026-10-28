# ADR-001: Backend for real accounts and cross-device sync

**Status:** Proposed  
**Date:** 2026-10-28  
**Deciders:** Project maintainer

## Context

The Ledger budget tracker stores all data in localStorage per browser.
Users cannot access their data from another device, and the local
sign-in system (PBKDF2-hashed passwords in localStorage) is a
convenience lock, not real security — anyone with access to dev tools
can read the raw data.

The app is a static site on GitHub Pages with zero running costs. Any
sync solution must balance capability against complexity and cost.

## Options Considered

### Option A: Supabase (hosted PostgreSQL + Auth)

| Dimension         | Assessment |
|-------------------|------------|
| Complexity        | Low — SDK handles auth and realtime |
| Cost              | Free tier: 500 MB DB, 50k monthly active users |
| Scalability       | Managed Postgres, scales automatically |
| Team familiarity  | Moderate — REST/JS SDK, standard SQL |

**Pros:** Built-in auth (email, OAuth), row-level security, realtime
subscriptions for instant cross-device sync, generous free tier, no
server to maintain.  
**Cons:** Vendor lock-in, requires Supabase account, data leaves the
user's browser.

### Option B: Firebase (Firestore + Firebase Auth)

| Dimension         | Assessment |
|-------------------|------------|
| Complexity        | Low — similar SDK approach |
| Cost              | Spark (free): 1 GiB Firestore, 50k reads/day |
| Scalability       | Managed NoSQL, auto-scales |
| Team familiarity  | Moderate |

**Pros:** Mature auth with multiple providers, offline-first SDK with
built-in conflict resolution, wide documentation.  
**Cons:** NoSQL (harder relational queries), Google ecosystem lock-in,
daily quota limits on free tier can surprise.

### Option C: Custom server (Node + SQLite/Postgres)

| Dimension         | Assessment |
|-------------------|------------|
| Complexity        | High — auth, API, hosting, TLS, backups |
| Cost              | Variable — needs a host (Fly.io, Railway, VPS) |
| Scalability       | Manual |
| Team familiarity  | High — full control |

**Pros:** No vendor dependency, full control, can stay 100 % open
source.  
**Cons:** Significant maintenance burden, must implement auth securely,
hosting cost, on-call for uptime.

## Decision

**Option A: Supabase** is recommended.

It gives real authentication and cross-device sync with the least new
code and zero infrastructure to maintain. The free tier is more than
sufficient for a personal budget tracker, and the JS SDK integrates
cleanly with the existing vanilla-JS codebase. Row-level security
ensures each user sees only their own data.

If vendor independence becomes a priority later, Supabase is open
source and can be self-hosted, making Option C a viable migration path.

## Consequences

- The app gains a network dependency for sign-in and sync, but the PWA
  service worker and localStorage fallback keep it usable offline.
- A Supabase project must be created and its credentials stored as
  environment variables (or in a config file excluded from git).
- The existing local-only mode should remain as a fallback for users
  who prefer not to create an account.
- Data migration: a one-time "Upload local data" flow lets existing
  users move their localStorage data into Supabase.

## Action Items

1. [ ] Create a Supabase project and define the schema (transactions,
       goals, recurring, settings tables).
2. [ ] Add Supabase Auth (email/password sign-up, sign-in, sign-out).
3. [ ] Replace localStorage reads/writes with Supabase calls, keeping
       localStorage as an offline cache.
4. [ ] Add a migration flow: "Upload my local data to the cloud."
5. [ ] Update the README with the new sign-in flow and privacy info.
