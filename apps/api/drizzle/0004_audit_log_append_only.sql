-- The audit log is append-only (#87, decision 0025): the database itself refuses to change or
-- remove an entry, whoever asks and however (the app, a script, raw SQL). Written by hand: a
-- trigger can't be expressed in Drizzle's schema. TRUNCATE stays possible: like DROP TABLE, it
-- is the table owner's operation, used to reset test databases.
CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
