CREATE FUNCTION app.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON app.audit_event
FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
