-- Stored movements and the lines of posted documents are append-only, and a posted document
-- never changes (decision 0034, spec section 4, invariants 3 and 7): the database itself refuses,
-- whoever asks and however. Written by hand, as 0004 for the audit log: Drizzle's schema can't
-- express a trigger. TRUNCATE stays possible, for resetting test databases. `posted` is compared
-- as text: this runs in the same transaction as the migration that adds it to the enum.
CREATE FUNCTION append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER movements_append_only
  BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION append_only();
--> statement-breakpoint
CREATE TRIGGER document_lines_append_only
  BEFORE UPDATE OR DELETE ON document_lines
  FOR EACH ROW EXECUTE FUNCTION append_only();
--> statement-breakpoint
CREATE FUNCTION posted_document_unchanged() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status::text = 'posted' THEN
    RAISE EXCEPTION 'document % is posted: % is not allowed', OLD.id, TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_posted_unchanged
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION posted_document_unchanged();
