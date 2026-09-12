# Stage 8 Task 6 Independent Review - 2026-07-16

Status: PASS

## Scope

- Fixed review point: `74dffb4c5eece8642168babfc4122154a745e97d`
- First Stage 8 review checkpoint: `a3d58a1`
- Final reviewed head: `24e8227`
- Axes: repository Standards and approved Spec, reviewed independently
- Production mutation, paid provider calls, enforcement, merge, and push were excluded

## Final Independent Results

| Axis | Result | P1 | P2 | P3 |
| --- | --- | ---: | ---: | ---: |
| Standards | PASS | 0 | 0 | 0 |
| Spec | PASS | 0 | 0 | 0 |

Both axes confirmed that the final implementation preserves human authority,
does not permit cross-job AI run ownership, does not allow a stale provider
completion to open the enforcement gate or mutate a case, and has no fourth
provider attempt after the configured retry limit.

## Accepted Findings And Fixes

| Finding | Test-first closure | Commit |
| --- | --- | --- |
| Production behavior was derived before an `ENV_FILE` could set `NODE_ENV`. | Child-process config test proves the environment file is loaded before production-only behavior is derived. | `8003afc` |
| Account deletion could remove an object retained by safety evidence, and evidence capture could race source deletion. | Account deletion preserves retained evidence; source rows are locked while immutable evidence is captured; retention cleanup rechecks live references. | `c0ed6cc` |
| Timeout and 429 outcomes were audited but did not execute the required initial attempt plus two bounded retries. | Migration `018_safety_ai_retry_runs.sql`, retryable run uniqueness, per-attempt budget audit, and queue retry tests cover the full path. | `3f884ad` |
| Automatic seven-day low-risk closure did not create reporter sync notifications. | Closure creates sync events in the database transaction and broadcasts only after commit. | `7d804de` |
| Account deletion protected only `safety_evidence`, not every audited object reference. | One shared retention query now covers evidence, moderation reviews, revisions, appeals, and live source objects. | `26814e1` |
| A process crash after an AI run entered `running` could make a reclaimed job complete without reconciling the run or budget. | The first recovery pass conservatively settles interrupted reservations and permits a fresh audited run. | `6eba69a` |
| Run age and job lease age could diverge, and normal 30/120-second retries could consume a `running` result without recovery. | The current run ID is atomically bound into the owning job lease; later attempts recover only their own bound run. | `2c190a6` |
| An unbound job could guess ownership by evidence hash, and an old provider call could mutate case state after losing its lease. | Guess-based fallback was removed; provider success and failure transactions re-lock and verify job ID, attempt, and run ID before any case, gate, or action write. | `6906dd5` |
| A permanent crash during the last configured attempt had no later handler invocation to settle its run and reservation. | Terminal stale claim reconciliation batches locked jobs, conservatively settles reserved usage, marks the run non-retryable failed, moves an eligible received case to manual review, and fails the job without a fourth lease. | `24e8227` |

## Verification Evidence

- Unified object-retention integration checks: 9/9 passed.
- Final AI service and job queue focused integration checks: 39/39 passed.
- Ordinary Node regression: 158/158 passed.
- PostgreSQL 16 full regression: 251/251 passed.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- Temporary PostgreSQL listeners on 55432 and 55436: released.
- Review worktree after the implementation commits: only the user-owned
  `CODEX_HANDOFF.md` modification remained unstaged and uncommitted.

## Accepted Operational Residual Risks

- Terminal stale AI reconciliation is bounded to 100 jobs per claim cycle.
  A larger outage backlog requires multiple worker polling cycles; rows outside
  the batch remain protected from the generic terminal update.
- A provider call whose billing outcome is unknowable is charged against the
  full reservation. This intentionally overstates possible spend rather than
  understating it.
- Reconciliation requires a running worker. If every worker is offline, the
  safe terminal transition occurs after service recovery.
- The last verified production runtime remains `8f224db`, with migration 017,
  shadow mode, automatic actions disabled, budget zero, and 0/30 real human
  comparisons. The reviewed Stage 8 code and migration 018 are not deployed;
  Task 8 requires a separate explicit production authorization.
- Enforcement remains closed until 30 current-version real comparisons pass
  and Rudy approves the later enforcement checkpoint.

No secret value, credential, recovery code, private key, provider response, or
private evidence is recorded in this review.
