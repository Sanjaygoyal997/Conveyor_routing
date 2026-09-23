-- Audit trail for master-data fixes made from the validation UI.
-- Every write stores who, when, what, and the row before/after as JSON.
CREATE TABLE IF NOT EXISTS master.rim_validation_audit
(
    id          bigserial PRIMARY KEY,
    dtandtime   timestamp without time zone NOT NULL DEFAULT now(),
    user_name   character varying(50)  NOT NULL,
    action      character varying(50)  NOT NULL,
    table_name  character varying(100) NOT NULL,
    row_ref     character varying(100),
    before      jsonb,
    after       jsonb
);

CREATE INDEX IF NOT EXISTS idx_rim_validation_audit_dtandtime
    ON master.rim_validation_audit (dtandtime);
