# Qwen Paid Validation Checkpoint - 2026-07-16

Status: EXECUTED ONCE; INVALID RESULT; NO RETRY; BUDGET RESET TO ZERO

## Proposed One-Call Boundary

- Model: `qwen3.7-plus-2026-05-26`
- Endpoint: Alibaba Cloud Model Studio compatible-mode API in the Chinese
  mainland service deployment
- Mode during validation: `shadow`
- Automatic safety actions: disabled
- Maximum provider calls: exactly one
- Thinking: disabled
- JSON mode: enabled
- Maximum output: 900 tokens
- Input: one fixed synthetic invalid-contact case; no real user content
- Enforcement: excluded

Alibaba Cloud's official [Model Studio pricing
page](https://help.aliyun.com/zh/model-studio/model-pricing) lists the fixed
model in the `0 < Token <= 256K` Chinese-mainland tier at CNY 2 per million
input tokens and CNY 8 per million non-thinking output tokens. The proposed
call does not use Batch pricing or assume a context-cache discount.

## Maximum Spend

The validation script's exact serialized synthetic message is 1,423 UTF-8
bytes. The budget guard deliberately reserves as if every byte were one input
token, which is conservative for this English JSON packet. It reserves the full
900-token output allowance.

```text
input maximum  = 1,423 * CNY 2 / 1,000,000 = CNY 0.002846
output maximum =   900 * CNY 8 / 1,000,000 = CNY 0.007200
total maximum                                  CNY 0.010046
```

Proposed production configuration for this checkpoint only:

```dotenv
SAFETY_QWEN_INPUT_CNY_PER_MILLION=2
SAFETY_QWEN_OUTPUT_CNY_PER_MILLION=8
SAFETY_AI_MONTHLY_BUDGET_CNY=0.010046
```

The monthly budget equals the conservative maximum reservation for one call.
The script also takes a model-scoped PostgreSQL advisory lock and rejects any
second provider attempt for the same model, prompt, and policy versions.

## Data And Output Boundary

The provider receives only the fixed system safety instruction and a synthetic
collection packet stating that a synthetic contact channel is unavailable. It
contains no production report, user identity, contact information, credential,
secret, administrator record, or private object key.

The command prints only this allowlist:

- model;
- provider request ID;
- input and output token counts;
- estimated CNY cost;
- pass/fail.

The raw model response, prompt, evidence, API key, database URL, and environment
values are never printed. The synthetic AI run is marked `is_synthetic=true`,
keeps `raw_response` empty, and is excluded from real quality metrics.

Expected semantic result: category `invalid_contact`, subject type
`collection`, impact scope `collection`, and no automatic action.

## Execution And Failure Handling

After explicit authorization, update only the three numeric production values
through the protected mode-600 environment workflow, keep the existing API key
unchanged, restart once, and confirm the administrator health page reports the
fixed versions and nonzero budget before any call. Then run exactly:

```bash
node backend/scripts/validate-qwen.js --confirm-spend
```

Whether the call passes, returns invalid JSON, times out, or produces an
uncertain billing result, do not retry it. Record only the allowlisted summary,
reset monthly budget to zero, keep mode shadow and automatic actions disabled,
restart once, and confirm health, logs, usage settlement/release, and the
synthetic marker. A failed validation routes ordinary cases to manual review and
does not authorize enforcement.

## Authorization And Execution Outcome

Rudy explicitly approved the fixed model, exactly one real call, and maximum
spend CNY 0.010046. The production pre-call check proved zero reports, cases,
AI runs, usage rows, pending/running jobs, prior validation attempts, and current
month committed spend. The API key was present without being read or changed;
the endpoint remained the official Chinese-mainland default.

The first shell command used the repository path
`backend/scripts/validate-qwen.js`, but the deployed runtime is rooted one level
deeper. Node exited with `MODULE_NOT_FOUND` before loading the validation script.
Database, usage, and journal checks proved that this path error created no run,
provider request, or cost. The actual deployed path
`/opt/zbt-backend/scripts/validate-qwen.js` was then discovered rather than
guessed, matched the local `aecfa3b` source checksum, and passed `node --check`.

After a fresh zero-row precondition check and authenticated AI-health check, the
correct script executed once. Its allowlisted result was:

```text
model: qwen3.7-plus-2026-05-26
request ID: d66c6f1c-db37-9f25-af9d-d01ae2e99d17
input tokens: 288
output tokens: 188
estimated cost: CNY 0.002080
pass: false
```

The database recorded exactly one synthetic run with status `invalid`, error
`invalid_ai_result`, the fixed model/prompt/policy versions, zero-byte raw
response, and no parsed result. Its only usage row settled from the conservative
CNY 0.010046 reservation to CNY 0.002080. There were zero reports, real cases,
safety actions, and AI evaluations.

The result means the provider returned billable output but it did not validate
against `qwen-case-result-v1`. The privacy boundary intentionally retained
neither raw output nor validator details, so the exact schema mismatch cannot be
reproduced or diagnosed from the preserved artifact. No retry was attempted.
A future retry requires privacy-safe diagnostic instrumentation, a new reviewed
deployment, and separate explicit paid authorization.

Immediately after the one real execution, monthly budget returned to zero and
the service restarted healthy. Rates 2/8 remain configured but cannot authorize
spend while budget is zero. The authenticated AI-health page showed provider
state `预算为零`, actual/budget CNY 0.0021/0.0000, zero reserved amount, the fixed
versions, zero automatic account actions, and no browser warnings/errors. One
mode-600 pre-validation environment backup remains at
`/opt/zbt-backend/.env.qwen-validation-backup-20260716-103657`; two verified
duplicate/final-state copies were removed.
