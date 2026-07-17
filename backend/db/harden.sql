

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccms_app') THEN
    CREATE ROLE ccms_app LOGIN PASSWORD 'CHANGE_ME_to_a_strong_random_password';
  END IF;
END $$;



GRANT CONNECT ON DATABASE ccms TO ccms_app;
GRANT USAGE  ON SCHEMA public   TO ccms_app;


GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO ccms_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO ccms_app;


REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ccms_app;


ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO ccms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO ccms_app;


SELECT
  has_table_privilege('ccms_app', 'audit_log',   'INSERT') AS audit_insert,
  has_table_privilege('ccms_app', 'audit_log',   'SELECT') AS audit_select,
  has_table_privilege('ccms_app', 'audit_log',   'UPDATE') AS audit_update_should_be_false,
  has_table_privilege('ccms_app', 'audit_log',   'DELETE') AS audit_delete_should_be_false,
  has_table_privilege('ccms_app', 'complaints',  'UPDATE') AS complaints_update;
