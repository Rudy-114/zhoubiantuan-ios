# Stage 8 Task 7 Local Verification - 2026-07-16

Status: PASS

## Scope And Safety Boundary

- Branch: `codex/report-safety-system`
- Verification-fix commit: `30b9775`
- Environment: local disposable PostgreSQL 16 clusters, local admin web, iOS simulators
- Production mutation: none
- Provider calls: none
- Provider tokens and cost: 0 / CNY 0
- Enforcement, merge, and push: not performed
- The user-owned `CODEX_HANDOFF.md` change stayed outside every commit.

## Automated Verification

| Check | Result |
| --- | --- |
| Focused admin web tests after the final fixes | 22/22 PASS |
| Ordinary Node regression | 164/164 PASS |
| PostgreSQL 16 regression | 251/251 PASS |
| Swift Package tests | 27/27 PASS |
| iPhone 17 Pro Debug simulator build | `BUILD SUCCEEDED` |
| JavaScript syntax checks for the four changed admin modules | PASS |
| `git diff --check` | PASS |

The final PostgreSQL run used the Homebrew PostgreSQL 16.14 binaries. Its
temporary database, cluster directory, process, and port 55432 listener were
removed by the test harness after the 251/251 result.

## Browser Verification

Playwright exercised a 1440-wide overview, 1280-wide detailed flows, and the
390x844 narrow layout. Screenshots are retained only under ignored
`output/playwright/task7/screenshots/` and were visually inspected.

| Flow | Result |
| --- | --- |
| Signed admin login and authenticated workspace | PASS |
| Overview, queue filters, case open/close, and return route | PASS |
| A decided case that no longer matches the active filter leaves the queue | PASS |
| Audited evidence reveal with a required reason | PASS |
| Correction before/after comparison stays locked until reveal | PASS |
| Real nested `{ source, report }` evidence and legacy `*_snapshot` metadata | PASS |
| Post evidence for collection-scoped shared-field correction | PASS by contract test |
| Appeal inspection and human overturn | PASS |
| AI/human comparison and typed evaluation submission | PASS |
| AI Health normal, empty/failure, and readable structured-error states | PASS |
| Audit history | PASS |
| Second-device request, signed approval, login, revocation, and immediate session rejection | PASS |
| Explicit logout | PASS |
| Stale/missing case error state | PASS |
| 390px page overflow and responsive tables | PASS |
| Reduced-motion media behavior | PASS |
| Escape closes the mobile navigation and returns focus to its toggle | PASS |

The last focused browser recheck used a local mocked same-origin API and proved
that nested evidence renders `整改前标题` and the legacy contact value, while
the submitted candidate renders the new values. At 390px, Escape left the
toggle at `aria-expanded=false` and `document.activeElement` was the toggle.

Representative evidence:

- `overview-desktop.png`
- `correction-comparison-desktop.png`
- `nested-correction-mobile-recheck.png`
- `ai-comparison-mobile-after-evaluation.png`
- `ai-health-desktop.png`
- `ai-health-error-desktop.png`
- `audit-mobile.png`
- `devices-revoked-desktop.png`
- `revoked-session-desktop.png`
- `stale-case-mobile.png`

The clean browser loading screenshot could not be retained because the
Playwright delay route crashed its session and produced a corrupt image. The
loading renderer remains covered by automated rendering behavior; this record
does not claim a clean browser loading screenshot.

Two Playwright crashes discarded browser-local synthetic device keys. Local
one-time recovery was used only to rebuild the disposable root fixture; old
test roots were revoked. No password, recovery code, private key, session
cookie, or private evidence value is recorded here.

One disposable AI-run UI row used provider label `fixture-no-call`, zero
tokens, and zero cost. It never constructed or called a provider.

## iOS Verification

The current Debug app bundle was installed on both simulators after the final
iOS build:

| Simulator | Current-build check | Result |
| --- | --- | --- |
| iPhone 16 Pro | waiting-correction post and collection, deadlines, and resubmit action | PASS |
| iPhone 16 Pro Max | manual-review, restored/appealable, and appeal form states | PASS |

Screenshots `ios-content-remediation-iphone16pro.png`,
`ios-content-remediation-iphone16promax.png`, and
`ios-appeal-iphone16promax.png` were visually inspected. Both simulators were
shut down afterward; a pre-existing unrelated simulator was not changed.

The unchanged full two-account reporting flow is recorded in
`2026-07-13-two-account-report-flow.md`: five report entry types, collection
scope behavior, default incoming-DM block, My Reports, offline retry, and
own-target rejection. It was not falsely re-described as a fresh manual run.
Current automated coverage additionally verifies same-ID publication with
interactions/history preserved, realtime `sync.available` refresh, foreground
sync, revision and appeal submissions, and manual restoration boundaries.
The realtime fallback begins at 30 seconds and backs off to 60/120/300 seconds;
no three-second idle polling exists.

Stage 8 introduced no iOS source changes after those checks, so the current
two-simulator pass concentrated on the remediation and appeal screens most
likely to regress through end-to-end state changes.

## Findings Closed Test-First

| Finding | Closure |
| --- | --- |
| Filtering an overview-opened case kept an incorrect overview return route. | Promote explicit filters to the cases route and persist the return route. |
| A terminal decision left a now-mismatched case in the current queue. | Reconcile the returned case against active filters and remove it when it no longer matches. |
| Correction comparison exposed no real nested source values and could select the wrong evidence. | Require audited reveal, unwrap the real source, accept the supported post-to-collection path, and compare only allowlisted submitted fields. |
| Structured API errors rendered as `[object Object]`. | Extract bounded message/code values from flat or nested error contracts. |
| Escape did not close the mobile navigation reliably after rerender. | Use the global key listener and return focus to the rebuilt toggle. |

Final independent review results:

| Axis | P1 | P2 | Result |
| --- | ---: | ---: | --- |
| Standards | 0 | 0 | PASS |
| Spec | 0 | 0 | PASS |

## Secret, Privacy, And Process Hygiene

The prescribed secret scan found only committed examples, synthetic database
test values, and cookie-format assertions. No real secret value or private key
was found. Raw screenshots and temporary Playwright files are ignored and were
not staged.

At completion:

- no Playwright browser or daemon remains;
- no local verification server remains on 18083 or 18084;
- no temporary PostgreSQL cluster or 55432 listener remains;
- the existing user SSH tunnel on 18080 remains untouched;
- the staging area contains only intentional Task 7 documentation when this
  record is committed.

## Result

Stage 8 Task 7 local verification is complete. Stage 8 Task 8 remains a
separate production-write boundary and is not authorized by this record.
