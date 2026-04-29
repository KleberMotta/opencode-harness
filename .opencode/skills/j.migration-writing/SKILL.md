---
name: j.migration-writing
description: Write Flyway SQL migrations for the financial database following project conventions for file naming, DDL/DML structure, constraint naming, indexes, history/audit tables, grants, soft deletes, and seed data. Use whenever creating or editing files under `src/main/resources/db/migration/*.sql`.
---

# Skill: Flyway Migration Writing

## When this skill activates
- Creating a new file under `src/main/resources/db/migration/V*.sql`.
- Editing an existing migration (rare — migrations are append-only in principle).
- Creating DML seed migrations that initialize reference/accounting data.
- Altering schemas: adding columns, constraints, indexes, sequences, or grants.
- Creating/evolving history (audit) tables tied to `revinfo`.

Do NOT use this skill for local-only fixtures under `src/main/resources/db/dev/` — those are not production migrations.

## Rules

- Treat production migrations as append-only. Prefer a new versioned file over editing an existing migration.
- Follow the naming, schema, constraint, index, grant, history, and seed-data conventions below before writing SQL.

## File Naming Convention

Format: `V<major>.<minor>__<DDL|DML>_<TICKET>_<DESCRIPTION>.sql`

Rules observed in the codebase:
- Prefix `V` + numeric version. Most use major-only (`V30.0`, `V31.0`). Minor version (`V18.1`, `V18.2`, `V19.1..V19.5`, `V27.1`) is used to group related migrations that must be applied together.
- Double underscore `__` separates version from description.
- Second token is `DDL` (schema change) or `DML` (data change). Some older ones omit it (rare) — prefer including it.
- Third token is the ticket ID in the form `PGW_<number>` (e.g., `PGW_7063`, `PGW_8637`). If there is no ticket, use a short descriptive token (e.g., `ALTER` — see `V29.0__DDL_ALTER_TABLE_PAYMENT_ORDER_ADD_REFUSED.sql`). Prefer always having a ticket.
- Remaining tokens describe the change in UPPER_SNAKE_CASE. Common verbs: `CREATE_TABLE_X`, `ALTER_TABLE_X`, `ADD_Y_COLUMN`, `INITIAL_SETUP_X`, `CHANGES_TO_X`.
- Never rewrite an already-applied migration. Add a new versioned file instead.
- When picking a version number, use the next integer major after the last migration; use `.1`, `.2`, ... only when splitting one logical change into multiple files.

## Formatting and Spotless

- SQL formatting is enforced by Spotless. Run `make lint` after editing.
- Indentation: 2 spaces inside `CREATE TABLE (...)`.
- Keywords observed uppercase (`CREATE TABLE`, `ALTER TABLE`, `CHECK`, `FOREIGN`, `REFERENCES`, `DEFAULT`, `NOT NULL`, `PRIMARY KEY`) and some lowercase (`bigserial`, `serial`, `key`, `insert`, `if`, `timezone`). Spotless normalizes this — write naturally and let lint fix it. Don't hand-craft exotic casing.
- Statements are separated by blank lines.
- Multi-value `ALTER TABLE` uses one `ADD COLUMN IF NOT EXISTS ...,` per line (see `V32.0`).
- Long `INSERT` statements group column list at top and use one row per `(...)` block; separate rows with `,` on its own line.

## Column Type Conventions

- Surrogate numeric primary keys: `bigserial PRIMARY KEY` (preferred for new tables). `serial` exists in older tables (`amount_type`, `controllership_entry`).
- External/business IDs (UUIDs): `VARCHAR(36) PRIMARY KEY` or `VARCHAR(36) NOT NULL`. For ULIDs use `VARCHAR(26)` (see `controllership_entry.entry_id`). For longer external IDs use `VARCHAR(60)` (see `transfer_acquirer.id`).
- Money amounts: `BIGINT` (minor units, e.g., cents). Default `0` when applicable. NEVER use floating-point.
- Timestamps: `TIMESTAMP WITHOUT TIME ZONE DEFAULT timezone ('utc'::TEXT, NOW()) NOT NULL` for `created_at` / `updated_at`. Newer tables sometimes drop `WITHOUT TIME ZONE` and use just `TIMESTAMP DEFAULT timezone ('utc'::TEXT, NOW()) NOT NULL` (e.g., `V25.0`, `V31.0`) — prefer the explicit `WITHOUT TIME ZONE` for consistency with older tables, but both are accepted.
- Dates (no time): `date` (e.g., `accounting_at`, `started_at`, `ended_at`, `charge_at`).
- Soft delete: `deleted_at TIMESTAMP WITHOUT TIME ZONE` (nullable, no default).
- Audit principals: `created_by JSONB NOT NULL`, `last_modified_by JSONB NOT NULL`. Both are JSON objects shaped like `{"clientId":"TRP","clientName":"trp-financial-api","clientOwnerName":"Transaction Payments"}`.
- Status enums: `VARCHAR(<small>) NOT NULL` with a `CHECK (status IN ('A','B',...))` constraint. Size varies (20, 25, 50) — pick the smallest that fits all known values plus headroom.
- Enum-like type columns: `VARCHAR(6) NOT NULL CHECK (type IN ('DEBIT','CREDIT'))` pattern.
- Tax document: `tax_document_number VARCHAR(14)`, `tax_document_type VARCHAR(4)` (or `VARCHAR(14)` in older tables — match the surrounding schema).
- Flexible structured payloads: `JSONB`. Use for status snapshots (`created`, `transferred`, `approved`, `rejected`, `canceled`), `data`, `extra_data`, `refused`.
- Booleans: `BOOLEAN DEFAULT FALSE NOT NULL` when you need a default. Nullable booleans exist (e.g., `under_analysis BOOLEAN`) but avoid unless needed.
- Hash columns: `VARCHAR(64)` for sha256.

## CREATE TABLE Skeleton

Use this shape. Put PK first, then FKs, then `created_at`/`updated_at`, then domain columns, then `deleted_at`, then audit JSONB, then inline constraints.

```sql
CREATE TABLE <table_name> (
  id bigserial PRIMARY KEY,
  <fk_column> INTEGER NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT timezone ('utc'::TEXT, NOW()) NOT NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT timezone ('utc'::TEXT, NOW()) NOT NULL,
  status VARCHAR(25) NOT NULL,
  amount BIGINT NOT NULL,
  deleted_at TIMESTAMP WITHOUT TIME ZONE,
  created_by JSONB NOT NULL,
  last_modified_by JSONB NOT NULL,
  FOREIGN key (<fk_column>) REFERENCES <other_table> (id),
  CONSTRAINT <table>_chk_<rule_name> CHECK (<expression>)
);
```

Then, AFTER the `CREATE TABLE`, in separate statements and in this order:
1. Unique indexes (`uk`)
2. Regular indexes (`idx`)
3. Additional `ALTER TABLE ... ADD CONSTRAINT <chk|fk>` if needed
4. `GRANT` on table
5. `GRANT ALL ON sequence <table>_id_seq TO trp_financial_db_api_user;` (only if the table has a `serial`/`bigserial`)
6. History table (if audited)
7. Indexes on history table
8. GRANT on history table

## Naming Conventions (MANDATORY — do not invent new prefixes)

- Primary-key constraint (when named explicitly): `<table>_pkey` (Postgres default; see `V20.0` where we drop `accounting_account_transaction_pkey`). For `CREATE TABLE`, prefer the inline form `id <type> PRIMARY KEY` on the column (main tables) or `PRIMARY KEY (id, rev)` at the end of the column list (history tables) — do NOT wrap either in `CONSTRAINT <name>`. Postgres generates the `<table>_pkey` name automatically.
- Sequence: `<table>_id_seq` (Postgres default from `bigserial`/`serial`).
- Unique index: `<table>_uk_<columns>` (`amount_type_uk_name`, `amount_type_uk_origin_attribute_name`, `balance_uk_seller_payment_account_id_type`). One exception prefix in newer `bank_account` code: `ux_bank_account_unique_account` — do NOT follow that; prefer `<table>_uk_<cols>`.
- Partial unique index on soft-deletable tables: include a `WHERE deleted_at IS NULL` or `WHERE <col> IS NOT NULL` clause. Example: `amount_type_uk_undo_id_not_null ... WHERE undo_id IS NOT NULL`.
- Regular index: `<table>_idx_<column>` (`cashout_idx_updated_at`, `operational_entry_idx_seller_payment_account_id`). Older `bank_account` uses `idx_<table>_<column>` — prefer the `<table>_idx_<col>` form for consistency.
- Foreign key constraint (when named explicitly): `<table>_<column>_fkey` (Postgres default). When you name your own, use `<table>_<col>_fkey` or `fk_<table>_<target>` (both appear; prefer `<table>_<col>_fkey`). **Exception — history→revinfo FK**: always write it inline as `FOREIGN key (rev) REFERENCES revinfo (rev)` WITHOUT `CONSTRAINT <name>`. Postgres autogenerates the name. This is the universal pattern across every history table in the project.
- Check constraint: `<table>_chk_<rule_name>` (`amount_type_chk_id_undo_id`, `balance_chk_balance_non_negative`, `balance_appropriated_chk_balance_non_negative`). For status checks created via `ALTER`, the form `<table>_status_check` is also used.
- History table: `<table>_history`.
- History index: `<table>_history_idx_<column>`. **Never create an index on `rev`** — the composite PK `(id, rev)` already covers the `rev` access paths Envers needs, and no existing history table in the project has a `_idx_rev`. Index only the tracked business columns (id lookups, status filters, `updated_at`, etc.).

## Separate uniques from the CREATE TABLE

Do NOT inline `UNIQUE (...)` in the `CREATE TABLE`. Always declare uniques as a separate `CREATE UNIQUE INDEX if NOT EXISTS <table>_uk_<cols> ON <table> (<cols>);` statement after the table. Rationale: it keeps partial uniqueness (soft delete / nullable) uniform and makes uniques cheap to drop and recreate (see `V34.0`).

Example:
```sql
CREATE UNIQUE INDEX if NOT EXISTS accounting_account_uk_number ON accounting_account (number)
WHERE
  deleted_at IS NULL;
```

## Index Conventions

- Create indexes for: FK columns, all status-like filters, `created_at`, `updated_at`, and any column used by repository queries.
- Use `CREATE INDEX if NOT EXISTS ...` (idempotent). The same applies to uniques.
- Include a covering index for each FK on both sides (`<table>_idx_<fk_col>` on the child table).
- Partial indexes: use `WHERE <predicate>` for soft-deletes, for "only one row with status X" rules (see `V33.0` `batch_status_pending_unique`), and for nullable uniqueness.
- `USING btree` is explicit in `bank_account`; it is the default and may be omitted.

## Grants — MANDATORY on every new table and sequence

Two users matter:
- Writer: `trp_financial_db_api_user` — gets `insert, SELECT, UPDATE` on normal tables. Occasionally `delete` is added when business logic deletes rows (see `accounting_account_initial_balance` in `V12.0`: `GRANT delete, insert, SELECT, UPDATE`). Add `delete` only when the code actually deletes rows; do NOT add it blindly.
- Sequence: `trp_financial_db_api_user` gets `GRANT ALL ON sequence <table>_id_seq` for every `bigserial`/`serial` column.

NOTE on read-only user: the existing migrations in this repo do NOT grant anything to a read-only user. There is no precedent in the migration history for a reader grant. Do NOT invent one unless the ticket explicitly asks; if you must add one, use `GRANT SELECT ON TABLE <t> TO <reader_user>;` and call it out in the PR.

Template to paste after every new table:
```sql
GRANT insert,
SELECT
,
UPDATE ON TABLE <table_name> TO trp_financial_db_api_user;

GRANT ALL ON sequence <table_name>_id_seq TO trp_financial_db_api_user;
```

For history tables, grant the same (`insert, SELECT, UPDATE`) — history tables do NOT have their own sequence.

## History (Audit) Table Pattern

Any table whose entity is `@Audited` (Hibernate Envers) needs a matching `_history` table. Pattern:

```sql
CREATE TABLE <table>_history (
  rev BIGINT NOT NULL,
  revtype SMALLINT NOT NULL,   -- sometimes NULLable in older tables (V31.0 batch_history), prefer NOT NULL
  id <same type as main table PK> NOT NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  status VARCHAR(<size>) NOT NULL,
  <other tracked columns>,
  last_modified_by JSONB NOT NULL,
  PRIMARY KEY (id, rev),
  FOREIGN key (rev) REFERENCES revinfo (rev)
);

CREATE INDEX if NOT EXISTS <table>_history_idx_id ON <table>_history (id);
CREATE INDEX if NOT EXISTS <table>_history_idx_updated_at ON <table>_history (updated_at);
CREATE INDEX if NOT EXISTS <table>_history_idx_status ON <table>_history (status);
-- plus one idx per tracked domain column that is queried

GRANT insert,
SELECT
,
UPDATE ON TABLE <table>_history TO trp_financial_db_api_user;
```

Rules:
- `revinfo` is created by `V1.0`. Always reference it with `FOREIGN key (rev) REFERENCES revinfo (rev)` inline, WITHOUT a `CONSTRAINT <name>` wrapper.
- Composite PK is `(id, rev)`, declared inline as `PRIMARY KEY (id, rev)` WITHOUT a `CONSTRAINT <name>` wrapper. Postgres autogenerates `<table>_history_pkey`.
- **Never index `rev`.** No history table in the project has a `<table>_history_idx_rev`. The PK `(id, rev)` handles Envers's access patterns; adding a `rev` index is redundant and off-pattern.
- Do not create a sequence for history tables.
- Mirror tracked columns from the main table; don't mirror `created_at`/`created_by` because they do not change.
- When altering the main table with new audited columns, also `ALTER` the `_history` table (see `V32.0` → `cashout_history`, `V39.0` → `payment_order_method_history`).

## ALTER TABLE Patterns

- Add columns: `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>[ DEFAULT <v>][ NOT NULL];` (use `IF NOT EXISTS` for idempotency). Multi-column shape as in `V32.0`. If a column is `NOT NULL` without a default, backfill before marking NOT NULL on large tables (the project uses `DEFAULT 0` with `NOT NULL` — see `V39.0`).
- Alter column type: use `ALTER COLUMN <col> type <new_type> USING <col>::<cast>;` (see `V20.0`, `V35.0`).
- Drop + recreate PK/FK/sequence: numbered comments `-- 1.`, `-- 2.`, ... as in `V20.0`.
- Drop constraint: `ALTER TABLE <t> DROP CONSTRAINT if EXISTS <name>;` then re-add with `ADD CONSTRAINT <name> ...`.
- Drop index: `DROP INDEX if EXISTS <name>;` before recreating.
- Status enum changes: drop the existing check, add the new one (see `V33.0`).

## DML (Seed Data) Pattern

When seeding reference data for `serial`/`bigserial` tables, always:
1. `INSERT INTO <t> (<cols>) VALUES (<row>), (<row>), ...;`
2. Follow immediately with a PL/pgSQL `DO $$` block that advances the sequence past the highest inserted `id`, so subsequent app-generated inserts don't collide:

```sql
DO $$
  DECLARE
    next_val bigint;
  BEGIN
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_val FROM <table>;
    EXECUTE format('ALTER SEQUENCE <table>_id_seq RESTART WITH %s', next_val);
  END;
$$;
```

Other DML rules:
- Include `created_by` and `last_modified_by` JSON literals matching the standard principal shape.
- Quote reserved/identifier-conflicting column names with double quotes (`"name"`, `"number"`, `"type"`) as in `V19.1`.
- Put DML in its own `V<x>__DML_*.sql` file (do not mix DDL + DML in the same file unless the DDL is a one-off setup that cannot be split — rare).
- Use explicit `id` values for reference data so tests and reports can rely on them. Keep the IDs monotonically ordered.

## Comments

- Use `--` for inline or line comments. Keep them in English, short, and informative (see `V22.0` accounting_report column comments like `--COMPLETED/FAILED/PROCESSING/CANCELED`).
- Use `-- <number>. <step>` numbered step comments when the migration performs a destructive sequence (see `V20.0`).
- Do NOT use `/* ... */` block comments.

## Idempotency Guidelines

- Prefer `IF NOT EXISTS` / `if NOT EXISTS` on: `CREATE TABLE`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, `ADD COLUMN`.
- Prefer `IF EXISTS` / `if EXISTS` on: `DROP INDEX`, `DROP CONSTRAINT`.
- `CREATE SEQUENCE` does not support `IF NOT EXISTS` here historically — fine to leave as-is.
- Raw `CREATE TABLE` without `IF NOT EXISTS` is common in the repo; both are accepted. When modifying an older table, match its style unless fixing a bug.

## Anti-patterns to avoid
- Inlining `UNIQUE (...)` inside `CREATE TABLE` — always use `CREATE UNIQUE INDEX`.
- Forgetting grants on the table or on its sequence.
- Using `TIMESTAMP WITH TIME ZONE` or `timestamptz` — we standardize on UTC-normalized `TIMESTAMP WITHOUT TIME ZONE`.
- Using `NUMERIC`/`DECIMAL`/`FLOAT` for money — always `BIGINT` in minor units.
- Creating an `@Audited` entity without a matching `_history` table and grants.
- Seeding data into a `serial` table without advancing the sequence afterwards.
- Renaming or editing an already-applied migration file. Add a new `V<next>` instead.
- Mixing DDL and DML in the same file for unrelated concerns.
- Inventing new naming prefixes (`uq_`, `ix_`, `fk_` when already named `_fkey`, etc.). Stick to `_pkey`, `_uk_`, `_idx_`, `_chk_`, `_fkey`.
- Dropping a FK, PK, or sequence without recreating the structure in the same migration (leaves the schema half-valid — see the numbered steps in `V20.0` for the correct flow).
- Adding grants to users that have no precedent in prior migrations (e.g., a reader user) without explicit product/ticket authorization.
- Adding `NOT NULL` columns to large tables without a `DEFAULT` or a prior backfill step.

## Canonical examples in the repo
- Full happy path with uniques, indexes, grants, check constraint, FK self-reference, history table: `src/main/resources/db/migration/V2.0__DDL_PGW_6508_CREATE_TABLE_AMOUNT_TYPE.sql`.
- Complex schema with soft-delete partial uniques, FKs, history: `V8.0__DDL_PGW_7063_CREATE_TABLE_ACCOUNTING_ACCOUNT.sql`.
- Table with `delete` grant precedent: `V12.0__DDL_PGW_7063_CREATE_TABLE_ACCOUNTING_ACCOUNT_INITIAL_BALANCE.sql`.
- Modern table with `CREATE TABLE IF NOT EXISTS` + explicit `CONSTRAINT <t>_pkey PRIMARY KEY`: `V25.0__DDL_PGW_7557_CREATE_TABLE_INACTIVE_FEE.sql`.
- Partial unique for soft-delete: `V34.0__DDL_PGW_8637_ALTER_BANK_ACCOUNT_UNIQUE_CONSTRAINT.sql`.
- Partial unique for "only-one-row-with-status": `V33.0__DDL_PGW_8639_ALTER_BATCH_STATUS_CONSTRAINTS.sql`.
- Destructive column/PK/FK/sequence swap: `V20.0__DDL_PGW_7096_CHANGES_TO_DAILY_CLOSING_ROUTINE.sql`.
- DML seed with sequence restart: `V19.1__DML_PGW_7014_INITIAL_SETUP_AMOUNT_TYPE.sql`, `V27.1__DML_PGW_7598_INITIAL_SETUP_ACCOUNTING_PERIOD_CLOSE.sql`.
- Adding audited JSONB columns to main + history: `V32.0__DDL_PGW_8634_ALTER_TABLE_CASHOUT.sql` + index/grant pair.
- Adding a `NOT NULL` column with default-backfill pattern on main and history: `V39.0__DDL_ADD_REVERSED_AMOUNT_COLUMN.sql`.

## Verification
- Run `make lint` (Spotless enforces SQL format).
- Start the app locally or run a focused persistence/integration test for the touched domain (`./mvnw test -Dtest=<Class>`).
- If the change affects repository queries, JPA mappings, or report queries, run the relevant module's tests.
- For DML that resets sequences, verify the `DO $$` block ran by inserting a new row via the app and confirming no ID collision.
