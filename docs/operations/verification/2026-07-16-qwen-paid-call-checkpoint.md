# Qwen Paid Validation Checkpoint - 2026-07-16

Status: AWAITING SEPARATE EXPLICIT SPEND AUTHORIZATION; NO PAID CALL RUN

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

## Required Authorization

A general instruction to continue, the prior zero-budget deployment approval,
or an approval to use the existing ECS environment does not satisfy this gate.
Authorization must explicitly approve the fixed model, exactly one real call,
and a maximum spend of CNY 0.010046.
