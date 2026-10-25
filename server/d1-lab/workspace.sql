DO $$ BEGIN
 IF NOT ((current_setting('port')='55483' AND current_database() ~ '^ruy_d1_rc_[a-f0-9]{16}$') OR (current_setting('port')='55496' AND current_database()='ruy_d1_disposable' AND coalesce(current_setting('ruy.initializing_installation',true),'')='windows-operational')) THEN RAISE EXCEPTION 'New isolated workspace required'; END IF;
END $$;
CREATE TABLE d1_workspace (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),owner_id uuid NOT NULL REFERENCES lab_users,
 cutover_date date NOT NULL,activation_approved boolean NOT NULL DEFAULT false,
 source_database text NOT NULL,source_sha256 text NOT NULL CHECK(length(source_sha256)=64),
 records integer NOT NULL CHECK(records=1186),attachments integer NOT NULL CHECK(attachments=59)
);
CREATE TABLE d1_imported_masters(id uuid PRIMARY KEY,entity text NOT NULL,source_sha256 text NOT NULL CHECK(length(source_sha256)=64));
CREATE TABLE d1_legacy_guard(id uuid PRIMARY KEY,entity text NOT NULL);
CREATE FUNCTION reject_legacy_operational_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM d1_legacy_guard WHERE id=NEW.id) THEN RAISE EXCEPTION 'Preserved historical identity cannot be written' USING ERRCODE='42501'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_legacy_catalog BEFORE INSERT OR UPDATE ON d2_catalog FOR EACH ROW EXECUTE FUNCTION reject_legacy_operational_write();
REVOKE ALL ON d1_workspace,d1_imported_masters,d1_legacy_guard FROM PUBLIC,ruy_d1_app;
GRANT SELECT ON d1_workspace,d1_imported_masters,d1_legacy_guard TO ruy_d1_app;
