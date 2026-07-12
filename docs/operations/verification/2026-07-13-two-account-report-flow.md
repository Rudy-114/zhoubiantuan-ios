# Two-Account Report Flow Verification - 2026-07-13

Status: PASS

## Environment

| Check | HTTP status | Result |
| --- | ---: | --- |
| Local non-production database on port `55435` | - | PASS |
| Local backend on port `18082` | - | PASS |
| Safety intake enabled | - | PASS |
| Safety AI mode off | - | PASS |
| Automatic safety actions disabled | - | PASS |
| Backend health | 200 | PASS |
| No production or remote database calls | - | PASS |
| No OSS calls | - | PASS |
| No AI calls | - | PASS |

## Build Provenance

| Checkpoint | Value | Result |
| --- | --- | --- |
| Execution window | `2026-07-13 07:41-08:10 CST` | PASS |
| Backend tested source commit | `1a801cb` | PASS |
| Pre-hardening amended Task 6 commit | `cffff71` | PASS |
| iOS Debug binary source checkpoint | `2e02d1d` | PASS |
| Task 6 iOS source changes | None | PASS |
| Simulator | iPhone 16 Pro, iOS 18.5 | PASS |
| Simulator | iPhone 16 Pro Max, iOS 18.5 | PASS |
| Final seed-guard hardening scope | Seed script, seed integration tests, and verification documentation only | PASS |
| Seed-guard hardening verification | Covered by automated tests; does not change the already verified report API or iOS flow | PASS |

## Report Results

| Report ID | Source type | Subject type | Reported field | HTTP status | Database status | Client-visible status | Evidence count | Result |
| --- | --- | --- | --- | ---: | --- | --- | ---: | --- |
| `rp-3aee50b7-64c4-4b7e-a9b9-897cd8e45f5e` | `post` | `post` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |
| `rp-d7ce3f03-fa6b-4fc0-9ea6-8646cecb19a2` | `collection` | `collection` | `contact_wechat` | 201 | `pending` | `reviewing` | 1 | PASS |
| `rp-a4483534-936b-4703-8501-9141b643329e` | `comment` | `comment` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |
| `rp-1251d8c2-55ff-4206-8fb3-bb18c27b0e75` | `user` | `user` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |
| `rp-f23f3146-0e2e-4bab-aa11-9cdf146597a5` | `direct_message` | `direct_message` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |
| `rp-684ceefd-ff74-4192-82e3-8732a8ec18a5` | `post` | `post` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |

## My Reports

| Check | HTTP status | Client-visible status | Result |
| --- | ---: | --- | --- |
| Listed report IDs returned by `/api/me/reports` | 200 | `reviewing` | PASS |
| `post` report shown in iOS | - | `reviewing` (`审核中`) | PASS |
| `collection` report shown in iOS | - | `reviewing` (`审核中`) | PASS |
| `comment` report shown in iOS | - | `reviewing` (`审核中`) | PASS |
| `user` report shown in iOS | - | `reviewing` (`审核中`) | PASS |
| `direct_message` report shown in iOS | - | `reviewing` (`审核中`) | PASS |

## Blocking

| Report ID | Source type | Subject type | Evidence count | Block count | Result |
| --- | --- | --- | ---: | ---: | --- |
| `rp-1251d8c2-55ff-4206-8fb3-bb18c27b0e75` | `user` | `user` | 1 | 0 | PASS |
| `rp-f23f3146-0e2e-4bab-aa11-9cdf146597a5` | `direct_message` | `direct_message` | 1 | 1 | PASS |

| Manual entry-point check | Report entry available | Result |
| --- | --- | --- |
| Outgoing direct-message report entry | `false` | PASS |
| Incoming direct-message report entry | `true` | PASS |

## Own-Target Rejection

| Source type | Subject type | Own-target UI report entry | Result |
| --- | --- | --- | --- |
| `post` | `post` | `false` | PASS |
| `collection` | `collection` | `false` | PASS |
| `comment` | `comment` | `false` | PASS |
| `user` | `user` | `false` | PASS |
| `direct_message` | `direct_message` | `false` | PASS |

| Source type | Subject type | HTTP status | Database status | Result |
| --- | --- | ---: | --- | --- |
| `post` | `post` | 400 | `absent` | PASS |
| `collection` | `collection` | 400 | `absent` | PASS |
| `comment` | `comment` | 400 | `absent` | PASS |
| `user` | `user` | 400 | `absent` | PASS |
| `direct_message` | `direct_message` | 400 | `absent` | PASS |

## Offline Retry

| Stage | Report ID | Source type | Subject type | Reported field | HTTP status | Database status | Client-visible status | Evidence count | Result |
| --- | --- | --- | --- | --- | ---: | --- | --- | ---: | --- |
| Offline attempt | - | `post` | `post` | `content` | - | `absent` | - | 0 | PASS |
| Retried submission | `rp-684ceefd-ff74-4192-82e3-8732a8ec18a5` | `post` | `post` | `content` | 201 | `pending` | `reviewing` | 1 | PASS |

| Retry check | Result |
| --- | --- |
| Offline failure preserved the retry state | PASS |
| Retry created exactly one report with one initial evidence row | PASS |
| Report and evidence request correlation matched | PASS |

## Regression Coverage

| Check | Result |
| --- | --- |
| Hosted `ZhouBianTuanTests/ReportEntryPointTests.swift` own-target policy coverage | PASS |
| Prior hosted XCTest verification (`84/84`) | PASS |
| Prior Swift Package verification (`24/24`) | PASS |
| The E2E flow required no additional source fix after the prerequisite migrated-seed repair in this Task 6 commit. | PASS |

## Result

All two-account report-flow checks passed under the stated local, non-production safety configuration.
