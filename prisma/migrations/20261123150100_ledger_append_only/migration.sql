-- The wallet ledger is append-only (src/server/wallet/ledger.ts): entries are added, never
-- changed or removed. Until now only the application code kept that rule. This trigger makes the
-- database refuse an UPDATE or a DELETE of a ledger row, whoever sends it. A correction is a new
-- ADJUSTMENT entry. (TRUNCATE is not a row change and is not blocked: only the test database is
-- ever emptied that way.)
CREATE OR REPLACE FUNCTION "ledger_entry_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_append_only"();
