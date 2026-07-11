# Migration 013 Dry Run - 2026-07-11

Status: PASS

## Scope

- Schema: `public`
- Migration: `013_safety_cases.sql`
- Down migration: `down/013_safety_cases.sql`
- PostgreSQL server: 16.14
- PostgreSQL client: 16.14
- Environment: disposable local PostgreSQL 16.14 cluster on an ephemeral loopback port
- Source implementation commit: `54113f585b1f5e2cf9ccc795fae3a9bed9635e37`
- Migration SHA-256: `0925c3a102a08269c0ffe6d7956219239fa8ddaf0515d29f556a9745967c392c`
- Down migration SHA-256: `2a8269689ae49a9da3eb073df58df1aeacdcf68c6adbc04ae52b9a386bc11ce2`

Task 8 scope is intake on, AI off, and automatic actions off. Shadow analysis and production action rollback drills are later-phase release gates, not Task 8 acceptance checks.

## Object Counts

| Stage | Tables | Indexes |
| --- | ---: | ---: |
| Before migration 013 | 18 | 48 |
| After migration 013 | 23 | 62 |
| After down migration | 18 | 48 |

## Preservation Checks

| Check | Result |
| --- | --- |
| Legacy report reason preserved through migration | PASS |
| Legacy report detail preserved through migration | PASS |
| Legacy report reporter reference preserved through migration | PASS |
| Legacy report reason preserved through down migration | PASS |
| Legacy report detail preserved through down migration | PASS |
| Legacy report reporter reference preserved through down migration | PASS |
| Legacy report uniqueness index restored by down migration | PASS |
| Replacement report request index removed by down migration | PASS |
| Safety tables removed by down migration | PASS |

## Command Form

1. Initialize a disposable local PostgreSQL 16 cluster on a free loopback port.
2. Apply migrations through `012_report_dedup.sql`.
3. Insert a disposable legacy report fixture, capture aggregate `public` table/index counts, and apply `013_safety_cases.sql`.
4. Verify legacy report fields using boolean-only assertions, capture aggregate counts, and apply `down/013_safety_cases.sql`.
5. Re-check aggregate counts, schema objects, and legacy-field preservation; destroy the temporary database and cluster.

## Reproducible Assertions

Aggregate public base-table and index counts were collected without querying business rows:

```sql
SELECT count(*)::int AS public_table_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE';

SELECT count(*)::int AS public_index_count
FROM pg_indexes
WHERE schemaname = 'public';
```

The corresponding assertions were:

```js
assert.deepEqual(before, { public_table_count: 18, public_index_count: 48 });
assert.deepEqual(afterUp, { public_table_count: 23, public_index_count: 62 });
assert.deepEqual(afterDown, { public_table_count: 18, public_index_count: 48 });
```

Legacy-field preservation was checked after both the up and down migrations with bound local-fixture values. The query returns booleans only:

```sql
SELECT
  reason IS NOT DISTINCT FROM $2::text AS reason_equal,
  detail IS NOT DISTINCT FROM $3::text AS detail_equal,
  reporter_id IS NOT DISTINCT FROM $4::text AS reporter_equal
FROM reports
WHERE id = $1::text;
```

The parameters are, in order, the disposable fixture report ID and its expected reason, detail, and reporter reference. No production values are used or emitted. The exact assertion form was:

```js
assert.deepEqual(rows, [{
  reason_equal: true,
  detail_equal: true,
  reporter_equal: true
}]);
```
