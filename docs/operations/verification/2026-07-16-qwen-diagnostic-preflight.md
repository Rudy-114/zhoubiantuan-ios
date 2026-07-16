# Qwen Privacy-Safe Diagnostic Preflight - 2026-07-16

Status: LOCAL PASS; PRODUCTION NOT DEPLOYED; NO NEW PROVIDER CALL

## Authorization Boundary

Rudy authorized future synthetic diagnostic calls for the fixed model
`qwen3.7-plus-2026-05-26` under a hard cumulative spend cap of CNY 1.000000.
The already-settled call consumed CNY 0.002080, leaving CNY 0.997920 of
headroom. The cap is fail-closed: a new call may start only when committed
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

## Production Deployment Checkpoint

No diagnostic code has been deployed and no new paid call has occurred. Before
the first production deployment of this change:

1. Confirm service health and the authenticated AI health page, production
   `shadow` mode, automatic actions disabled, budget zero, fixed versions, and
   no active synthetic validation run.
2. Confirm lifetime committed AI spend remains CNY 0.002080 and the configured
   input/output rates remain the approved CNY 2/CNY 8 per million tokens without
   printing credentials or environment contents.
3. Create a mode-600 runtime/environment backup and record checksums. There is
   no database migration in this change.
4. Deploy the reviewed commit, restart once, and verify public health, admin
   isolation, service flags, and the no-confirmation CLI refusal before any
   provider call.

Rollback is to restore the immediately preceding runtime backup, preserve the
existing additive AI schema and audit rows, restart the service with budget
zero, and repeat health/admin/service-flag checks. A failed deployment does not
authorize a provider call.

## Next Paid Call Bound

One diagnostic attempt still uses the fixed synthetic invalid-contact packet,
non-thinking JSON Mode, and at most 900 output tokens. At the approved CNY
2/CNY 8 rates its existing conservative maximum remains CNY 0.010046; together
with the settled CNY 0.002080, the worst committed total after the next attempt
is CNY 0.012126, below the lifetime cap. Stop without another call if preflight
state differs, the reservation is blocked, a matching run is active/completed,
or any safety output would exceed the allowlist.
