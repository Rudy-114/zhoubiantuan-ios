# Qwen Privacy-Safe Diagnostic Preflight - 2026-07-16

Status: DIAGNOSTIC RUNTIME DEPLOYED; SECOND CALL INVALID; LOCAL PROMPT V2 READY

## Authorization Boundary

Rudy authorized future synthetic diagnostic calls for the fixed model
`qwen3.7-plus-2026-05-26` under a hard cumulative spend cap of CNY 1.000000.
The two settled calls consumed CNY 0.003800, leaving CNY 0.996200 of headroom.
The cap is fail-closed: a new call may start only when committed
lifetime spend plus its conservative maximum reservation remains at or below
CNY 1.000000.

This authorization does not enable real-case traffic, continuous shadow
processing, automatic actions, or enforcement. Production service configuration
must remain `shadow`, automatic actions disabled, and monthly budget zero. A
diagnostic CLI process may override only its own in-memory budget after the
explicit command-line confirmation; it does not mutate the service environment.

## Reviewed Diagnostic Interface

```bash
node scripts/validate-qwen.js \
  --confirm-spend \
  --diagnostic-attempt \
  --hard-cap-cny=1
```

- The original `--confirm-spend` path remains single-attempt.
- Diagnostic mode blocks a new paid attempt while an earlier matching run is
  `reserved`, `running`, or `completed`; it permits diagnosis after a settled
  `invalid` or `failed` attempt.
- The database serializes the lifetime cap across calendar months. Settlement
  is rejected if token-derived cost exceeds the conservative reservation.
- Invalid model output exposes only allowlisted `instancePath`, `keyword`, and
  `schemaPath` values from `qwen-case-result-v1`.
- Provider values, validation messages, prompts, evidence, credentials, and raw
  responses are neither printed nor persisted. Synthetic runs continue to keep
  `raw_response` empty and remain excluded from real quality metrics.

## Local Verification

- Qwen/schema/CLI targeted Node tests: 28/28 passed.
- Budget and validation PostgreSQL targeted tests: 12/12 passed.
- Full ordinary Node regression: 146/146 passed.
- PostgreSQL 16 full regression: 221/221 passed.
- JavaScript syntax checks and `git diff --check`: passed.
- Independent Standards and Spec reviews first found one P1 and three P2
  concerns. Test-first fixes added settlement-overrun rejection, diagnostic path
  allowlists, completed-run duplicate blocking, and cross-month concurrency
  coverage. Both review axes then returned PASS with no remaining P1/P2.
- Temporary PostgreSQL clusters and port 55435 were released after testing.

After the production diagnostic exposed a wrong top-level JSON shape, a second
test-first local pass made the prompt contract self-contained from the same
`qwenCaseResultSchema` that Ajv validates, explicitly required the nine
camelCase top-level properties, prohibited wrapper objects, and advanced the
prompt version to `safety-case-prompt-v2`. The prompt regression was observed
red before the fix. Targeted Qwen tests passed 26/26, ordinary Node passed
147/147, and PostgreSQL 16 passed 221/221. Standards and Spec review both
returned PASS with no P1/P2; their two P3 test/wording observations were fixed
and the final targeted pass remained 26/26. Temporary PostgreSQL resources and
ports 55436 and 55437 were released, and syntax plus `git diff --check` passed.

## Production Deployment And Diagnostic Result

Rudy explicitly authorized production deployment of reviewed commit `1c4591b`.
The exact commit archive was installed into a mode-700 staging runtime, production
dependencies, JavaScript syntax, Ajv loading, the known test-fixture-only secret
scan, release marker, and validation-script checksum all passed, and the mode-600
environment file was copied without reading or printing it.

The final read-only baseline confirmed the production service active/running,
`shadow`, automatic actions disabled, monthly budget zero, CNY 2/CNY 8 rates,
the fixed model/prompt/policy versions, a present API key without reading it,
and the official DashScope host. Lifetime committed spend was CNY 0.002080;
there were zero active synthetic runs, zero completed synthetic validations,
one prior invalid synthetic validation, and zero real cases, actions, or AI
evaluations. Public health and `/admin` returned 200, while unauthenticated AI
health returned 401. Remote and local validation-script checksums differed,
independently confirming this diagnostic commit was not deployed. The check
performed no restart, environment change, database write, or provider call.

The deployment created `/opt/zbt-backend.qwen-diagnostic-backup-20260716-034239`
and the immediate rollback directory
`/opt/zbt-backend.qwen-diagnostic-replaced-20260716-034239`, switched once, and
restarted `zbt-backend.service` once. The service became active/running on a new
PID; health, feed, privacy, and `/admin` returned 200; unauthenticated AI health
returned 401; the runtime checksum matched `1c4591b`; the no-confirmation CLI
refused with exit 1; and post-deploy database/configuration counts exactly
matched the baseline. Startup-failure, provider-call, and environment-value
leak markers were all zero before the paid diagnostic.

One subsequently authorized diagnostic attempt returned 288 input and 143
output tokens and settled CNY 0.001720. It failed closed as
`invalid_ai_result`. The allowlisted diagnostic showed all nine approved
top-level properties missing and five disallowed top-level properties, without
retaining their names, values, messages, prompt, evidence, or raw response.
The run is synthetic and invalid, its raw and parsed result are empty, and it
created no real AI run, evaluation, or action. Production remained `shadow`,
automatic actions disabled, monthly budget zero, active diagnostics zero, and
public/service health passed. Lifetime committed spend is CNY 0.003800.

Rollback is to restore the immediately preceding runtime backup, preserve the
existing additive AI schema and audit rows, restart the service with budget
zero, and repeat health/admin/service-flag checks. A failed deployment does not
authorize a provider call.

## Next Paid Call Bound

The next diagnostic attempt requires deploying the reviewed local prompt-v2
fix first; that new production write is not covered by the authorization to
deploy `1c4591b`. It still uses the fixed synthetic invalid-contact packet,
non-thinking JSON Mode, and at most 900 output tokens. At CNY 2/CNY 8 rates the
new self-contained prompt has a conservative maximum reservation of CNY
0.013736; together with settled CNY 0.003800, the worst committed total is CNY
0.017536, below the lifetime cap. Paid-call authority already covers that
synthetic attempt, but no call may occur until a separately authorized deployment
passes its zero-call checks. Stop if preflight state differs, the reservation is
blocked, a matching run is active/completed, or any safety output would exceed
the allowlist.
