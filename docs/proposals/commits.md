Title: Commit Transactions for Server Ops with Sync and Rollback

Status: Draft
Owner: Platform/Infra
Last updated: 2025-09-24

Overview
This proposal introduces a transactional commit model for coordinating a set of server operations ("ops") with local state synchronization. The goal is to ensure that either all intended changes are applied and reflected locally, or none are (rollback), avoiding partial application and drift.

Use cases
- Batch apply multiple ops that must succeed together (e.g., create project, seed defaults, grant permissions)
- Perform migration-like tasks atomically from an API gateway or job runner
- Ensure client-visible state reflects server truth only when the commit completes

Non-goals
- Replace database transactions. This orchestrates across services and ops that may or may not be backed by DB transactions
- Guarantee global ACID across heterogeneous systems without coordination; we provide best-effort atomicity through orchestration

Concepts
- Commit: A logical unit consisting of ordered ops with an overall commit id
- Op: A side-effecting action against a service with idempotency key and compensating action
- Compensating action: Best-effort undo for an op when full rollback is required
- Sync step: A deterministic read/refresh to update local caches/state after ops succeed

API sketch
- beginCommit(requestMeta) -> commitId
- addOp(commitId, opType, payload, idempotencyKey, compensateFnRef)
- execute(commitId, options: { syncAfter: true, timeoutMs?, twoPhase?: false })
- getCommitStatus(commitId) -> { state: pending|running|succeeded|rolled_back|failed, error? }
- abort(commitId) -> initiates rollback

Execution model
1) Begin: Allocate commit id; record metadata and intent
2) Stage ops: Validate payloads; ensure each op provides idempotency key and compensating action reference
3) Execute:
   - Option A (single-phase with compensations):
     a. Execute ops sequentially (or with declared dependency graph). If any op fails, run compensations in reverse order for all previously successful ops
     b. If all ops succeed, run sync step(s) to refresh client/local caches. If sync fails, treat as failure and execute compensations
   - Option B (two-phase):
     a. Prepare: Each op exposes prepare() which is reversible; all must acknowledge prepared
     b. Commit: After all prepared, issue commit() to finalize; on any prepare failure, issue abort() to prepared ops
4) Finalize: Mark commit as succeeded or rolled_back; emit audit events

Idempotency and retries
- All ops must be idempotent with respect to idempotencyKey to support safe retries
- Compensations should also be idempotent
- Commit execution is retryable up to a bounded number; status endpoint allows clients to de-duplicate

Consistency and sync
- Strongest guarantee: only expose updated local state after commit succeeds and sync completes successfully
- Sync strategies:
  - Pull fresh entities by keys touched in ops
  - Invalidate caches for affected scopes and lazily reload
  - Emit change events for subscribers

Failure handling
- Op failure during execution -> run compensations for prior ops, mark rolled_back
- Sync failure after successful ops -> run full rollback via compensations to avoid presenting inconsistent local state
- Compensation failure -> record partial rollback; surface alerting and human remediation path

Two-phase commit (2PC) vs compensating transactions
- Prefer compensations for cross-service workflows where 2PC is impractical
- Use 2PC for homogeneous stores or where prepare/commit semantics are native
- Hybrid: use prepare/commit for DB-backed ops; use compensations for external APIs

Observability & audit
- Emit structured events: commit_started, op_succeeded, op_failed, compensation_succeeded, compensation_failed, commit_succeeded, commit_rolled_back
- Attach commitId, opId, idempotencyKey, service, latency, error codes
- Store minimal ledger for postmortems and reconciliation

Security & permissions
- Evaluate permissions at beginCommit and per-op
- Propagate auth context and constrain compensations to original principal where applicable

Limits & safeguards
- Max ops per commit; max execution time
- Dead-letter queue for compensation failures; circuit-breakers when failure rate spikes

Client contract
- Clients should treat commit as atomic: do not read partial results mid-commit
- Clients may poll getCommitStatus or subscribe to events
- On rolled_back, clients should discard optimistic UI changes and retry or surface error

Minimal implementation plan
1) Service: Commit Orchestrator with storage (e.g., Postgres table: commits, ops)
2) SDK: Helper to build commits and await completion with exponential backoff
3) Define op interface:
   - execute(context) -> Result
   - compensate(context) -> Result
   - (optional) prepare(context) -> PreparedToken; commit(token); abort(token)
4) Add sync hooks for affected domains (cache invalidation + targeted refetch)
5) Observability pipeline and dashboards

Open questions
- Which ops lack safe compensations and require guarded 2PC?
- How to model dependencies between ops (DAG vs sequence)?
- SLA for compensation timeliness and human-in-the-loop escalation