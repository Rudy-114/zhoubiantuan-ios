# AI Shadow Production Deployment - 2026-07-16

Status: PROMPT V2 PRODUCTION ACTIVE; SYNTHETIC VALIDATION PASS; REAL SHADOW DISABLED

## Scope

- Production service: `zbt-backend.service`
- Production directory: `/opt/zbt-backend`
- Runtime commit: `8f224db`
- Additive migration: `017_safety_ai.sql`
- Mode: `SAFETY_AI_MODE=shadow`
- Automatic actions: `SAFETY_AUTO_ACTIONS_ENABLED=false`
- Monthly budget: `SAFETY_AI_MONTHLY_BUDGET_CNY=0`
- Fixed model in code: `qwen3.7-plus-2026-05-26`
- Paid Qwen validations: three authorized synthetic calls, CNY 0.006918 total;
  two prompt-v1 invalid and one prompt-v2 pass
- Enforcement: excluded

This deployment introduced the AI audit schema, budget guard, shadow worker,
restricted administrator health/compare UI, and the spend-guarded validation
CLI. Budget remained zero throughout the zero-budget deployment and smoke
verification. No provider call, token usage, usage reservation, or AI safety
action occurred during that deployment checkpoint.

## Backups And Rollback Points

- Pre-deploy runtime backup:
  `/opt/zbt-backend.ai-shadow-backup-20260716-084315`
- PostgreSQL 16 custom-format backup: private ignored file
  `.project-secrets/backups/zbt-before-ai-shadow-20260716-084315.dump`
- Immediate runtime rollback after the final switch:
  `/opt/zbt-backend.ai-shadow-replaced-20260716-090204`
- Diagnostic runtime backup:
  `/opt/zbt-backend.qwen-diagnostic-backup-20260716-034239`
- Prior diagnostic immediate rollback:
  `/opt/zbt-backend.qwen-diagnostic-replaced-20260716-034239`
- Prompt-v2 runtime backup:
  `/opt/zbt-backend.qwen-prompt-v2-backup-20260716-041712`
- Current prompt-v2 immediate rollback:
  `/opt/zbt-backend.qwen-prompt-v2-replaced-20260716-041712`
- Preserved failed first Stage 7 runtime:
  `/opt/zbt-backend.ai-shadow-failed-20260716-084315`
- Final runtime archive checksum:
  `23f4641e178565a7b3598c57f6ef46b38118fb04d6b44ec3e70b8f0a679ba922`

The database dump remained mode `600` and passed `pg_restore --list`. The
production environment remained owned by `ecs-user` with mode `600`. No
environment value, credential, private key, API key, prompt, evidence body, or
raw model response is recorded here or tracked by Git.

## Migration Verification

The production database reported PostgreSQL 16.13. Before mutation, it had
migrations through `017_admin_device_revocation.sql`, no AI tables, five users,
zero reports, zero safety cases, one administrator, two administrator devices,
and five administrator sessions.

Only `017_safety_ai.sql` was applied, inside one transaction, together with its
exact migration record. Post-migration verification found:

- one migration record;
- three AI tables;
- two AI indexes;
- fourteen constraints and no invalid constraints;
- `safety_ai_runs.is_synthetic` is `NOT NULL` with default `false`;
- zero AI rows before smoke testing;
- unchanged consumer and administrator aggregate counts.

The additive migration is intentionally retained during runtime rollback. The
AI tables are inert while budget is zero or mode is off.

## First Smoke Failure And Rollback

The first zero-budget smoke report correctly produced a synthetic=false AI run
with status `budget_blocked`, error `budget_disabled`, empty raw response, zero
tokens, zero cost, no usage row, no safety action, and completed jobs. The case
incorrectly stayed in `received` instead of moving to `manual_review`.

The rollout stopped at that failed postcondition. The prior Stage 6 runtime was
restored immediately, flags remained AI-off/actions-disabled/budget-zero, the
service returned active, and public health returned HTTP 200. The additive AI
migration was retained without active callers.

Diagnosis reproduced the failure through a real PostgreSQL integration path.
PostgreSQL preserved a microsecond case version while the Node `Date` value
rounded it to milliseconds, so the guarded update treated the unchanged case as
stale. Commit `836226b` now loads `updated_at::text`, compares that exact value
as `timestamptz` inside PostgreSQL, and preserves the stale-case guard without
precision loss.

Verification after the fix:

- targeted AI service PostgreSQL tests: 10/10 passed;
- ordinary Node regression: 134/134 passed;
- PostgreSQL 16 full regression: 217/217 passed;
- JavaScript syntax and `git diff --check`: passed;
- Standards review: PASS, no P1/P2;
- Spec review: PASS, no P1/P2.

## Final Deployment And Zero-Budget Smoke

The complete runtime closure from `836226b` contained 131 entries, no tests,
`.env`, or `node_modules`, and passed production dependency install, JavaScript
syntax, Ajv, archive checksum, and secret scans before the final switch.

The final independent smoke report returned HTTP 201. Authenticated consumer
profile and report-list requests returned HTTP 200, an App JWT was rejected by
the administrator API with HTTP 401, and WebSocket verification passed. Its
database outcome was:

- case status `manual_review`;
- AI run status `budget_blocked` in `shadow` mode;
- error `budget_disabled`;
- synthetic flag `false`;
- empty raw response;
- input tokens `0`, output tokens `0`, estimated cost CNY `0.000000`;
- zero usage rows and zero safety-action rows;
- `case_received` and `analyze_case` jobs completed.

Post-deploy read-only checks found:

| Check | Result |
| --- | --- |
| Public `/api/health` | HTTP 200 |
| Public consumer feed | HTTP 200 |
| Public privacy page | HTTP 200 |
| Public `/admin` | HTTP 200 |
| Unauthenticated `/admin/api/cases` | HTTP 401 |
| Service | active |
| Startup-failure log markers | 0 |
| Sensitive-data log markers | 0 |
| Qwen/DashScope call markers | 0 |
| Runtime flags | shadow / actions false / budget 0 |
| Immediate rollback directory | present |

After Rudy renewed the existing root-device session, an authenticated Chrome
check of `/admin/ai-health` passed. The page showed shadow mode, provider state
`预算为零`, actual/budget/reserved CNY all zero, the fixed model/prompt/policy
versions, 100/100 fixtures, zero schema failures, 100% fixture auto-hide
precision, zero failed jobs, zero scope-expansion errors, zero automatic account
actions, and 0/30 real comparisons collecting. Refresh returned the same state.
The page displayed neither a mode switch, provider key, nor raw model response,
and the browser console contained no warning or error. The production
environment check independently confirmed automatic actions disabled.

## Synthetic Data Cleanup

Before cleanup, a read-only transaction matched exactly two prefixed synthetic
users, two reports, two cases, two AI runs, zero usage rows, and zero safety
actions. A separately reviewed transaction asserted those exact counts, deleted
the two reports before their RESTRICT-linked cases, deleted the two cases and
their CASCADE-linked AI/audit/job/evidence rows, then deleted only the two exact
synthetic users.

The transaction committed only after postconditions proved five users, zero
reports, zero safety cases, zero AI runs, zero AI usage rows, zero AI
evaluations, zero safety actions, and no remaining target synthetic user. The
temporary PostgreSQL tunnel closed and local port 55434 was released.

## Rollback

For an incident, first set mode off while keeping automatic actions false and
budget zero, then restore
`/opt/zbt-backend.qwen-prompt-v2-replaced-20260716-041712` with permissions preserved
and restart `zbt-backend.service` once. Verify public health, feed, privacy,
consumer authentication, WebSocket, `/admin`, administrator isolation, and
recent journal status. Keep `017_safety_ai.sql` and its empty tables in place.
The down migration is not an ordinary runtime rollback and requires a separate
database rollback decision.

## Paid Validation Outcome

Rudy later provided the separate explicit authorization recorded in
`docs/operations/verification/2026-07-16-qwen-paid-call-checkpoint.md`. Exactly
one real provider request used the fixed synthetic packet. It consumed 288 input
and 188 output tokens at estimated cost CNY 0.002080, below the approved CNY
0.010046 maximum, but failed the closed `qwen-case-result-v1` validator and was
recorded as `invalid_ai_result`.

The synthetic run retained no raw response or parsed result, created no report,
real case, evaluation, or safety action, and does not count toward real shadow
metrics. It was not retried. Production immediately returned to monthly budget
zero, remained in shadow mode with automatic actions disabled, and passed
service, public API, database, journal, and authenticated AI-health checks.

## Diagnostic Runtime And Second Validation

Rudy explicitly authorized deployment of commit `1c4591b`. The complete
runtime was staged and checked before one restart, with the production environment
copied at owner `ecs-user`, mode `600`, without exposing values. The validation
script checksum changed from the prior runtime and matched the reviewed commit.
Health, feed, privacy, `/admin`, administrator isolation, service flags, database
counts, and the no-confirmation CLI refusal all passed before a provider call.
There was no migration. Startup-failure, provider-call, and environment-value
leak markers were zero at the zero-call checkpoint.

The authorized diagnostic attempt used the fixed synthetic packet and lifetime
CNY 1 cap. It consumed 288 input and 143 output tokens and settled CNY 0.001720.
The result was valid JSON but the wrong closed-schema shape: all nine approved
top-level properties were reported missing and five unapproved top-level
properties were reported, using only allowlisted schema locations and keywords.
It was recorded as synthetic `invalid_ai_result`, with empty raw response and
empty parsed result. There are now two invalid synthetic runs, zero active or
completed synthetic runs, zero real runs, zero AI evaluations, zero safety
actions, and lifetime committed spend CNY 0.003800. The service remains
active/running, shadow, automatic actions disabled, and budget zero.

The test-first correction makes the prompt self-contained from the exact
Ajv schema, forbids wrapper objects, and advances the prompt version to
`safety-case-prompt-v2`. Targeted Qwen tests pass 26/26, ordinary Node 147/147,
and PostgreSQL 16 221/221; both review axes pass with no P1/P2.

## Prompt V2 Deployment And Passing Validation

Rudy explicitly authorized deployment of `8f224db`. Its exact archive was
staged with production dependencies, full JavaScript syntax checks, Ajv load,
release marker, prompt/config checksums, the known test-fixture-only secret
scan, and the no-confirmation CLI refusal. A new mode-600 environment/runtime
backup was verified before one atomic switch and one service restart. Health,
feed, privacy, `/admin`, administrator isolation, prompt-v2 flags, unchanged
database counts, and zero startup/provider/leak markers passed before the call.

One authorized prompt-v2 diagnostic then returned a closed-schema-valid result:
655 input tokens, 226 output tokens, CNY 0.003118, `pass=true`, and zero
validation issues. The database recorded one synthetic `completed` run at
`safety-case-prompt-v2`, settled usage CNY 0.003118 against reservation CNY
0.013736, an empty raw response, and a parsed validated result. Lifetime
committed spend is CNY 0.006918. There are zero active synthetic runs, two prior
invalid prompt-v1 runs, one completed prompt-v2 run, zero real runs, zero AI
evaluations, and zero safety actions. The service remains active/running,
shadow, automatic actions disabled, and monthly budget zero. The completed run
blocks a duplicate paid validation for the same model/prompt/policy/evidence.

This success verifies model access, current CNY 2/CNY 8 accounting, non-thinking
JSON Mode, the self-contained prompt contract, and the closed Ajv validator on
the fixed synthetic packet. It does not authorize or count as real shadow
traffic. Task 9 Step 6 remains pending real cases and its separate production
traffic decision.
