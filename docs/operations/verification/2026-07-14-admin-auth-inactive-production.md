# Admin Authentication Inactive Production Deployment - 2026-07-14

Status: PASS

## Scope

- Source commit before deployment: `38acbba`
- Production service: `zbt-backend.service`
- Production directory: `/opt/zbt-backend`
- Applied migration: `017_admin_auth.sql`
- Web flag: `ADMIN_WEB_ENABLED=false`
- Real administrator creation: not performed
- Paid APIs: not called

Production was still recorded at migration 013 before this deployment. To keep
the Stage 5 authorization boundary exact, the deployment synchronized only the
Stage 5 administrator files and applied migration 017 directly in one
transaction. Migrations 014, 015, and 016 remain unapplied in production.

## Rollback Points

- Full code and environment copy: `/opt/zbt-backend.backup-20260714-085636`
- PostgreSQL 16 custom-format backup: private
  `.project-secrets/backups/zbt-before-admin-auth-20260714-085636.dump`
- The database backup passed `pg_restore --list` validation.
- The production environment file remained mode `600`.

Neither backup is tracked by Git. The database backup contains production data
and must remain inside the ignored private secrets directory.

## Deployment Verification

- Local Node suite passed: 76/76.
- Local PostgreSQL suite passed: 186/186.
- The 16-file deployment staging set matched the local source by checksum.
- Every deployed administrator JavaScript file passed `node --check` on the
  server before installation.
- `ADMIN_RECOVERY_PEPPER` was generated and written only on the server without
  terminal output; only presence and minimum length were checked.
- `ADMIN_WEB_ENABLED=false` was written once and verified.
- Migration 017 created exactly eight `admin_*` tables and one migration record.
- Consumer `users`, `reports`, and `safety_cases` aggregate counts were identical
  immediately before and after migration 017.
- Migrations 014-016 remained absent.
- `admin_users` remained empty.
- `zbt-backend.service` restarted active with a zero main-process status.
- Recent service journal output contained no startup-failure markers.

## Isolation Verification

All tokens used for verification remained inside the server process and were
not printed or written to disk.

| Check | Result |
| --- | --- |
| Public health | HTTP 200 |
| Public feed | HTTP 200 |
| Valid App JWT to `/api/me` | HTTP 200 |
| Same valid App JWT to `/admin/api/auth/session` | HTTP 401 |
| Valid App JWT to `/api/me/reports` | HTTP 200 |
| Admin session cookie sent to `/api/me` | HTTP 401 |
| Unauthenticated consumer report submission | HTTP 401 |
| Admin API permissive CORS header | Absent |
| Admin API cache policy | `Cache-Control: no-store` |
| Public `/admin` while disabled | HTTP 404 |
| Real administrator rows | 0 |

## Rollback Boundary

While no administrator exists, rollback is the Stage 5 down migration, removal
of its `schema_migrations` record, the timestamped code/environment copy, and one
service restart. After Stage 6 creates the real administrator, do not drop the
administrator tables; disable the web flag and restore compatible code instead.
