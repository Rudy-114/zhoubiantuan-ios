# AI Shadow Production Preflight - 2026-07-15

Status: LOCAL PRECHECK COMPLETE; PRODUCTION NOT AUTHORIZED OR EXECUTED

## Scope

- Target service: `zbt-backend.service`
- Target directory: `/opt/zbt-backend`
- Additive migration: `017_safety_ai.sql`
- Required production mode: `SAFETY_AI_MODE=shadow`
- Required action gate: `SAFETY_AUTO_ACTIONS_ENABLED=false`
- Initial budget: `SAFETY_AI_MONTHLY_BUDGET_CNY=0`
- Paid Qwen validation: excluded from this deployment checkpoint
- Enforcement: excluded

This checkpoint deploys the Stage 7 runtime with an outbound-call budget of
zero. The migration adds `safety_ai_runs`, `safety_ai_usage`, and
`safety_ai_evaluations` plus two indexes. It does not alter or delete consumer
content rows. Budget zero must record `budget_blocked` before provider
construction or network activity, and every case must remain in human review.

No production host, database, environment file, credential, or paid API was
accessed while preparing this document.

## Local Evidence

- Stage 7 Tasks 1-8 are committed through `5b03139`; plan state is committed at
  `9e954e1`.
- Guarded validation CLI unit coverage passes 9/9.
- Full ordinary Node regression passes 134/134.
- Running the CLI without `--confirm-spend` in an environment without project
  variables exits before loading config, provider, or database modules.
- The guarded runtime constructs the provider only after an atomic reservation,
  uses one synthetic invalid-contact packet, prints an allowlist-only JSON
  summary, marks the run synthetic, keeps raw output empty, and refuses a second
  provider attempt for the same model/prompt/policy versions.
- PostgreSQL 16 full regression passes 216/216 after the host reboot. The three
  guarded CLI integration tests cover successful reservation/call/validation/
  settlement with synthetic persistence, budget-zero blocking before provider
  construction, and two truly concurrent confirmed attempts constructing and
  calling the provider exactly once.
- The disposable PostgreSQL cluster stopped cleanly after the run; ports 55432
  and 60671 are free and no project PostgreSQL or lifecycle-test process remains.

## Mandatory Read-Only Preflight After Authorization

Before any production write:

1. Confirm the deployed commit/checksum set and current service status without
   printing environment values.
2. Query only migration names and table existence. Because this repository has
   multiple `017_*.sql` files, do not run the global migration loop until the
   exact production migration set is known; never apply unrelated pending
   migrations accidentally.
3. Confirm `safety_cases`, `admin_users`, and `schema_migrations` exist before
   applying `017_safety_ai.sql`.
4. Record aggregate row counts for consumer `users`, `reports`,
   `safety_cases`, and admin identity tables; do not export row content.
5. Confirm the current environment file owner/mode is restricted and that the
   three required safety flags can be updated without terminal echo. Do not
   display the API key, database password, recovery pepper, or any secret.
6. Confirm enough disk space for both a full runtime copy and a PostgreSQL 16
   custom-format backup.

Any unexpected migration gap, uncommitted deployment artifact, failing health
check, unsafe file mode, or missing backup capability stops the rollout before
mutation.

## Backup And Restore Points

Immediately before deployment:

1. Create a timestamped full copy of `/opt/zbt-backend`, including the private
   environment file, with permissions preserved.
2. Create a PostgreSQL 16 custom-format backup in the ignored local private
   backup directory through the established protected tunnel workflow.
3. Validate the backup using `pg_restore --list`; keep the dump mode `600` and
   never add it to Git.
4. Record only backup paths, timestamps, sizes, validation result, and source
   commit. Do not record environment values or database row data.
5. Capture pre-deploy service status, migration-name list, aggregate counts,
   public health status, consumer feed status, and isolated admin login status.

## Authorized Deployment Sequence

This sequence is a plan, not authorization:

1. Build a complete runtime-closure staging archive from the reviewed commit;
   verify checksums, `node --check`, ignored files, and secret scan before
   transfer.
2. Install the three production flags through a mode-600, non-echoing workflow:
   shadow mode, automatic actions disabled, and monthly budget zero.
3. Apply only `017_safety_ai.sql` in one transaction and insert its exact
   `schema_migrations` record. Verify three tables, two indexes, constraints,
   and `is_synthetic`; do not apply a down migration during rollout.
4. Install the complete runtime, then restart `zbt-backend.service` once.
5. Stop immediately if the service is not active, health is not HTTP 200, or
   recent journal output shows startup/migration failures.

## Zero-Budget Production Verification

After a successful restart and before any nonzero budget:

- Public `/api/health`, privacy, feed, sync/WebSocket, and authenticated
  consumer paths remain healthy.
- `/admin` remains available; App JWT still cannot authorize admin APIs and an
  admin cookie still cannot authorize consumer APIs.
- AI health reports `shadow`, automatic actions disabled, budget zero, the
  fixed model/prompt/policy versions, and no API key or raw response.
- Submit exactly one clearly prefixed disposable report using non-sensitive test
  content. Verify its AI run becomes `budget_blocked`, no `safety_ai_usage` row
  is created, the case remains `manual_review`, and no safety action is applied.
- Verify service logs contain no prompt, evidence, key, raw response, or
  provider request identifier for the blocked run.
- Recheck aggregate consumer/admin counts and isolate any expected increase from
  the disposable report. Clean up only with a separately reviewed transaction,
  or retain the prefixed audit record if deletion would weaken traceability.

This verification does not run `validate-qwen.js --confirm-spend` and does not
authorize a paid call.

## Rollback

First-line rollback is feature/config and compatible-code rollback, not schema
destruction:

1. Set `SAFETY_AI_MODE=off`, keep `SAFETY_AUTO_ACTIONS_ENABLED=false`, and keep
   `SAFETY_AI_MONTHLY_BUDGET_CNY=0` using the protected non-echoing workflow.
2. Restore the timestamped pre-deploy runtime/environment copy with permissions
   preserved and restart `zbt-backend.service` once.
3. Verify public health, consumer feed/auth, sync/WebSocket, `/admin`, admin
   isolation, and service journal status.
4. Leave the additive AI tables and migration record in place during emergency
   rollback. They are inert in AI-off mode and preserve audit/budget evidence.
5. Use `down/017_safety_ai.sql` only on an explicitly approved database rollback
   when no production AI run/evaluation data must be retained; it is never the
   default incident response.

If the deployment fails before the database transaction commits, restore only
the runtime/environment copy. If it fails after migration commit, use AI-off
plus compatible prior code and retain the additive schema.

## Separate Paid-Call Gate

After the zero-budget deployment passes, a later checkpoint must name the fixed
model, official current input/output rates, proposed nonzero monthly budget,
maximum cost for one 900-output-token call, synthetic input, allowlisted output,
and failure rollback. Rudy must explicitly approve that exact spend. A general
instruction to continue or an approval of this zero-budget deployment does not
authorize the paid call.
