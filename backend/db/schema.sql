-- =========================================================================
--  CCMS — Customer Complaint Management System
--  Orient Paper & Mill  ·  PostgreSQL schema
-- =========================================================================
--  Mirrors the entities defined in the CCMS Data Classification Report:
--    Master data      — Section 3, 6.2, 9.1
--    Transactional    — Section 4, 6.3, 7.1
--    Workflow states  — Section 8
--    Audit log        — Section 12.6 (append-only / immutable)
--
--  Conventions
--    · snake_case columns; the data layer aliases them back to camelCase
--      so application objects keep their existing shape.
--    · money is numeric(15,2) — never float.
--    · timestamps are timestamptz, defaulting to now().
--    · enumerated values use CHECK constraints (easier to evolve than
--      native ENUM types, equally strict).
--
--  Run:  psql -U postgres -d ccms -f db/schema.sql
-- =========================================================================

BEGIN;

-- Drop in dependency order so the script is re-runnable during development.
DROP TABLE IF EXISTS audit_log            CASCADE;
DROP TABLE IF EXISTS credit_notes         CASCADE;
DROP TABLE IF EXISTS capa_records         CASCADE;
DROP TABLE IF EXISTS visits               CASCADE;
DROP TABLE IF EXISTS samples              CASCADE;
DROP TABLE IF EXISTS attachments          CASCADE;
DROP TABLE IF EXISTS complaint_line_items CASCADE;
DROP TABLE IF EXISTS complaints           CASCADE;
DROP TABLE IF EXISTS invoice_line_items   CASCADE;
DROP TABLE IF EXISTS invoices             CASCADE;
DROP TABLE IF EXISTS sales_policies       CASCADE;
DROP TABLE IF EXISTS complaint_types      CASCADE;
DROP TABLE IF EXISTS sample_types         CASCADE;
DROP TABLE IF EXISTS products             CASCADE;
DROP TABLE IF EXISTS customers            CASCADE;
DROP TABLE IF EXISTS users                CASCADE;
DROP TABLE IF EXISTS roles                CASCADE;
DROP TABLE IF EXISTS departments          CASCADE;
DROP SEQUENCE IF EXISTS complaint_no_seq;

-- =========================================================================
--  MASTER DATA
-- =========================================================================

-- ── 1. Departments ──────────────────────────────────────────────────────
CREATE TABLE departments (
    department_id   varchar(10)  PRIMARY KEY,
    department_name varchar(100) NOT NULL,
    code            varchar(10)  NOT NULL UNIQUE
);
COMMENT ON TABLE departments IS 'Section 3 — TS, QC, Operations, Marketing, MD Office, Finance, Sales.';

-- ── 2. Roles ────────────────────────────────────────────────────────────
CREATE TABLE roles (
    role_id       varchar(10)  PRIMARY KEY,
    role_name     varchar(60)  NOT NULL,
    department_id varchar(10)  REFERENCES departments(department_id),
    can_approve   boolean      NOT NULL DEFAULT false,
    can_forward   boolean      NOT NULL DEFAULT false,
    can_reject    boolean      NOT NULL DEFAULT false,
    level         smallint     NOT NULL DEFAULT 1
);
COMMENT ON TABLE roles IS 'Section 3 — authority level per stage. department_id is NULL for Admin (R000).';

-- ── 3. Users ────────────────────────────────────────────────────────────
CREATE TABLE users (
    user_id       varchar(10)  PRIMARY KEY,
    name          varchar(100) NOT NULL,
    department_id varchar(10)  REFERENCES departments(department_id),
    role_id       varchar(10)  NOT NULL REFERENCES roles(role_id),
    email         varchar(150) NOT NULL UNIQUE,
    password_hash varchar(120) NOT NULL,
    active        boolean      NOT NULL DEFAULT true,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash — never store plaintext.';
CREATE INDEX idx_users_role ON users(role_id);

-- ── 4. Customers / Distributors ─────────────────────────────────────────
CREATE TABLE customers (
    customer_id          varchar(20)  PRIMARY KEY,
    name                 varchar(200) NOT NULL,
    type                 varchar(20)  NOT NULL CHECK (type IN ('Customer','Distributor')),
    region               varchar(60),
    segment              varchar(40),
    business_line        varchar(20)  CHECK (business_line IN ('Paper','Chemical','Both')),
    contact_person       varchar(100),
    email                varchar(150),
    phone                varchar(20),
    city                 varchar(80),
    state                varchar(80),
    gst_number           varchar(20),
    is_key_account       boolean      NOT NULL DEFAULT false,
    sap_business_partner varchar(20)  UNIQUE,
    app_access           varchar(20),
    active               boolean      NOT NULL DEFAULT true,
    last_sap_sync        timestamptz
);
COMMENT ON TABLE customers IS 'Section 3 — synced nightly from SAP Business Partner (API_BUSINESS_PARTNER).';
COMMENT ON COLUMN customers.segment IS 'Drives sales-policy matching (see sales_policies.applicable_segment).';
COMMENT ON COLUMN customers.is_key_account IS 'Triggers the mandatory customer-visit gate regardless of settlement value.';
CREATE INDEX idx_customers_segment ON customers(segment);

-- ── 5. Products / SKUs ──────────────────────────────────────────────────
CREATE TABLE products (
    product_id      varchar(10)  PRIMARY KEY,
    product_name    varchar(150) NOT NULL,
    category        varchar(20)  NOT NULL CHECK (category IN ('Paper','Chemical')),
    uom             varchar(20)  NOT NULL,
    business_line   varchar(20)  NOT NULL CHECK (business_line IN ('Paper','Chemical')),
    sap_material_no varchar(40)  NOT NULL UNIQUE,
    active          boolean      NOT NULL DEFAULT true,
    last_sap_sync   timestamptz
);
COMMENT ON TABLE products IS 'Section 3 — synced nightly from SAP Material Master (API_PRODUCT_SRV).';
COMMENT ON COLUMN products.category IS 'Routes the complaint to the correct Product Manager at Stage 5.';

-- ── 6. Sample types ─────────────────────────────────────────────────────
CREATE TABLE sample_types (
    sample_type_id           varchar(10)  PRIMARY KEY,
    sample_type_name         varchar(80)  NOT NULL,
    applicable_business_line varchar(20)  NOT NULL CHECK (applicable_business_line IN ('Paper','Chemical','Both')),
    default_required         boolean      NOT NULL DEFAULT true
);
COMMENT ON TABLE sample_types IS 'Section 6.2 — physical sample categories.';

-- ── 7. Complaint types ──────────────────────────────────────────────────
CREATE TABLE complaint_types (
    type_id                varchar(10)  PRIMARY KEY,
    type_name              varchar(80)  NOT NULL,
    business_line          varchar(20)  NOT NULL CHECK (business_line IN ('Paper','Chemical','Both')),
    sample_required        boolean      NOT NULL DEFAULT false,
    default_sample_type_id varchar(10)  REFERENCES sample_types(sample_type_id)
);
COMMENT ON COLUMN complaint_types.sample_required IS 'Drives the QC_Review sample gate (Section 8).';

-- ── 8. Sales policies ───────────────────────────────────────────────────
CREATE TABLE sales_policies (
    policy_id                   varchar(10)  PRIMARY KEY,
    policy_name                 varchar(120) NOT NULL,
    business_line               varchar(20)  NOT NULL CHECK (business_line IN ('Paper','Chemical','Both')),
    applicable_segment          varchar(40)  NOT NULL,
    applicable_region           varchar(40)  NOT NULL DEFAULT 'All',
    max_settlement_pct          numeric(5,2) NOT NULL CHECK (max_settlement_pct BETWEEN 0 AND 100),
    complaint_window_days       integer      NOT NULL CHECK (complaint_window_days > 0),
    linked_discount_scheme      varchar(60),
    valid_from                  date         NOT NULL,
    valid_to                    date         NOT NULL,
    approval_override_on_breach boolean      NOT NULL DEFAULT false,
    last_sap_sync               timestamptz,
    CONSTRAINT policy_valid_range CHECK (valid_to >= valid_from)
);
COMMENT ON TABLE sales_policies IS 'Section 9.1 — synced from SAP pricing condition records. Matched on business_line + customer segment.';
COMMENT ON COLUMN sales_policies.approval_override_on_breach IS 'When true, a policy breach forces MD approval regardless of settlement value.';

-- ── 9. Invoices (SAP cache) ─────────────────────────────────────────────
CREATE TABLE invoices (
    invoice_number varchar(20)   PRIMARY KEY,
    invoice_date   date          NOT NULL,
    sold_to_party  varchar(20)   REFERENCES customers(customer_id),
    payment_terms  varchar(20),
    net_amount     numeric(15,2) NOT NULL DEFAULT 0,
    currency       char(3)       NOT NULL DEFAULT 'INR',
    last_sap_sync  timestamptz
);
COMMENT ON TABLE invoices IS 'Section 11.1 #1 — fetched real-time from SAP (API_BILLING_DOCUMENT_SRV); cached here.';

CREATE TABLE invoice_line_items (
    invoice_number       varchar(20)   NOT NULL REFERENCES invoices(invoice_number) ON DELETE CASCADE,
    invoice_item_no      varchar(10)   NOT NULL,
    sap_material_no      varchar(40)   NOT NULL,
    material_description varchar(150),
    billing_qty          numeric(12,3) NOT NULL DEFAULT 0,
    uom                  varchar(20),
    net_amount           numeric(15,2) NOT NULL DEFAULT 0,
    unit_price           numeric(15,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (invoice_number, invoice_item_no)
);

-- =========================================================================
--  TRANSACTIONAL DATA
-- =========================================================================

-- Complaint numbers survive restarts (the in-memory counter did not).
CREATE SEQUENCE complaint_no_seq START 1;

-- ── 10. Complaints ──────────────────────────────────────────────────────
CREATE TABLE complaints (
    complaint_no            varchar(20)   PRIMARY KEY
        DEFAULT ('COMP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('complaint_no_seq')::text, 5, '0')),
    title                   varchar(200)  NOT NULL DEFAULT '',
    remarks                 text          NOT NULL DEFAULT '',
    status                  varchar(30)   NOT NULL DEFAULT 'Logged'
        CHECK (status IN (
            'Draft','Logged','TS_Review','QC_Review','Sample_Awaited','CAPA_Pending',
            'Ops_Head_Approval','Marketing_Review','Marketing_Head_Approval','MD_Approval',
            'Visit_Pending','Finance_Processing','Closed',
            'Rejected','Clarification_Sought','Auto_Closed')),
    prior_status            varchar(30),
    business_line           varchar(20)   CHECK (business_line IN ('Paper','Chemical','Both')),

    -- Invoice snapshot (denormalised on purpose: the complaint must reflect
    -- the invoice as it stood when filed, even if SAP later changes it).
    invoice_number          varchar(20),
    invoice_date            date,
    invoice_value           numeric(15,2) NOT NULL DEFAULT 0,
    currency                char(3)       NOT NULL DEFAULT 'INR',

    -- Customer snapshot (same rationale).
    customer_id             varchar(20)   REFERENCES customers(customer_id),
    customer_name           varchar(200),
    customer_segment        varchar(40),
    is_key_account          boolean       NOT NULL DEFAULT false,

    settlement_value        numeric(15,2) NOT NULL DEFAULT 0 CHECK (settlement_value >= 0),

    -- Sales policy evaluation (Section 9)
    policy_id               varchar(10)   REFERENCES sales_policies(policy_id),
    -- Values emitted by checkPolicyCompliance() in masterData.js.
    policy_flag             varchar(30)   CHECK (policy_flag IN ('Within Policy','Breach','No Policy Found')),
    -- Deliberately text, not boolean: the route stores a display string
    -- ('Within Policy' / 'Breach'), which the UI renders as-is.
    policy_compliance       varchar(30),
    policy_clause_breached  text,
    policy_forces_md_approval boolean     NOT NULL DEFAULT false,

    -- Gate inputs (Section 8)
    sample_required         boolean       NOT NULL DEFAULT false,
    visit_requested         boolean       NOT NULL DEFAULT false,

    reported_by             varchar(20),
    sap_validation_pending  boolean       NOT NULL DEFAULT false,
    credit_note_number      varchar(30),

    created_at              timestamptz   NOT NULL DEFAULT now(),
    updated_at              timestamptz   NOT NULL DEFAULT now(),
    closed_at               timestamptz,

    -- A complaint may only carry a closed_at once it is actually terminal.
    CONSTRAINT closed_at_only_when_terminal
        CHECK (closed_at IS NULL OR status IN ('Closed','Auto_Closed'))
);
COMMENT ON TABLE complaints IS 'Section 4 — complaint header. Status sequence per Section 8.';
COMMENT ON COLUMN complaints.prior_status IS 'Status to return to when Clarification_Sought is resolved, or on reject.';
COMMENT ON COLUMN complaints.settlement_value IS 'Sum of line-item defective_value; drives the MD (>1L) and visit (>50K) gates.';
CREATE INDEX idx_complaints_status        ON complaints(status);
CREATE INDEX idx_complaints_customer      ON complaints(customer_id);
CREATE INDEX idx_complaints_business_line ON complaints(business_line);
CREATE INDEX idx_complaints_created       ON complaints(created_at DESC);

-- ── 11. Complaint line items ────────────────────────────────────────────
CREATE TABLE complaint_line_items (
    line_item_id       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no       varchar(20)   NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    invoice_number     varchar(20),
    invoice_item_no    varchar(10),
    sap_material_no    varchar(40),
    product_name       varchar(150),
    invoice_qty        numeric(12,3) NOT NULL DEFAULT 0 CHECK (invoice_qty >= 0),
    unit_price         numeric(15,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    defective_qty      numeric(12,3) NOT NULL DEFAULT 0 CHECK (defective_qty >= 0),
    uom                varchar(20)   NOT NULL DEFAULT 'Ream',
    -- The DB owns this invariant so it can never drift from its inputs.
    defective_value    numeric(15,2) GENERATED ALWAYS AS (round(defective_qty * unit_price, 2)) STORED,
    complaint_type_id  varchar(10)   REFERENCES complaint_types(type_id),
    complaint_type_name varchar(80),
    sample_required    boolean       NOT NULL DEFAULT false,
    created_at         timestamptz   NOT NULL DEFAULT now(),
    -- You cannot claim more defective units than were invoiced.
    CONSTRAINT defective_not_more_than_invoiced CHECK (defective_qty <= invoice_qty)
);
COMMENT ON COLUMN complaint_line_items.defective_value IS 'Generated: unit_price × defective_qty (Section 4).';
CREATE INDEX idx_line_items_complaint ON complaint_line_items(complaint_no);

-- ── 12. Attachments ─────────────────────────────────────────────────────
CREATE TABLE attachments (
    attachment_id  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no   varchar(20)  NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    line_item_id   uuid         REFERENCES complaint_line_items(line_item_id) ON DELETE CASCADE,
    file_reference varchar(300) NOT NULL,
    file_type      varchar(20)  NOT NULL DEFAULT 'photo' CHECK (file_type IN ('photo','video','document')),
    description    text         NOT NULL DEFAULT '',
    uploaded_by    varchar(20)  REFERENCES users(user_id),
    uploaded_at    timestamptz  NOT NULL DEFAULT now(),
    purged         boolean      NOT NULL DEFAULT false,
    purged_at      timestamptz
);
COMMENT ON COLUMN attachments.purged IS 'Archival engine flags the file as purged; metadata is retained for audit.';
CREATE INDEX idx_attachments_complaint ON attachments(complaint_no);

-- ── 13. Sample records ──────────────────────────────────────────────────
CREATE TABLE samples (
    sample_id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no         varchar(20)  NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    line_item_id         uuid         REFERENCES complaint_line_items(line_item_id) ON DELETE SET NULL,
    sample_type_id       varchar(10)  NOT NULL REFERENCES sample_types(sample_type_id),
    sample_type_name     varchar(80),
    dispatch_mode        varchar(30)  NOT NULL DEFAULT 'Courier'
                         CHECK (dispatch_mode IN ('Courier','Hand Delivery','Field Pickup')),
    dispatched_date      date,
    received_date        date,
    received_by          varchar(20)  REFERENCES users(user_id),
    sample_status        varchar(20)  NOT NULL DEFAULT 'Awaited'
                         CHECK (sample_status IN ('Awaited','Received','Under Testing','Tested','Disposed')),
    test_result          varchar(20)  CHECK (test_result IN ('Pass','Fail','Inconclusive')),
    test_result_notes    text,
    test_report_reference varchar(120),
    disposal_date        date,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    -- A sample cannot be marked received without a received date.
    CONSTRAINT received_needs_date
        CHECK (sample_status = 'Awaited' OR received_date IS NOT NULL)
);
COMMENT ON TABLE samples IS 'Section 6.3 — physical sample lifecycle. QC_Review cannot advance until status is Received or beyond.';
CREATE INDEX idx_samples_complaint ON samples(complaint_no);

-- ── 14. Visit records ───────────────────────────────────────────────────
CREATE TABLE visits (
    visit_id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no            varchar(20)  NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    visit_type              varchar(20)  NOT NULL DEFAULT 'Optional' CHECK (visit_type IN ('Mandatory','Optional')),
    trigger_reason          text,
    scheduled_date          date,
    assigned_to             varchar(20)  REFERENCES users(user_id),
    visit_status            varchar(20)  NOT NULL DEFAULT 'Planned'
                            CHECK (visit_status IN ('Planned','Completed','Cancelled')),
    visit_date              date,
    findings                text,
    customer_acknowledgement text,
    outcome                 varchar(40)  CHECK (outcome IN ('Resolved On-Site','Escalation Confirmed','No Further Action')),
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE visits IS 'Section 7.1 — customer visit records.';
CREATE INDEX idx_visits_complaint ON visits(complaint_no);

-- ── 15. CAPA records ────────────────────────────────────────────────────
CREATE TABLE capa_records (
    capa_id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no          varchar(20) NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    root_cause_description text       NOT NULL DEFAULT '',
    corrective_action     text        NOT NULL DEFAULT '',
    preventive_action     text        NOT NULL DEFAULT '',
    documented_by         varchar(20) REFERENCES users(user_id),
    documented_by_name    varchar(100),
    documented_date       timestamptz NOT NULL DEFAULT now(),
    sample_test_reference varchar(120)
);
COMMENT ON TABLE capa_records IS 'Section 4 — Corrective & Preventive Action, documented by Operations at Stage 4.';
CREATE INDEX idx_capa_complaint ON capa_records(complaint_no);

-- ── 16. Credit notes ────────────────────────────────────────────────────
CREATE TABLE credit_notes (
    credit_note_id     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_no       varchar(20)   NOT NULL REFERENCES complaints(complaint_no) ON DELETE CASCADE,
    credit_note_number varchar(30)   NOT NULL,
    sap_document_number varchar(30),
    amount             numeric(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    currency           char(3)       NOT NULL DEFAULT 'INR',
    raised_by          varchar(20)   REFERENCES users(user_id),
    raised_by_name     varchar(100),
    raised_date        timestamptz   NOT NULL DEFAULT now(),
    notified_to        jsonb         NOT NULL DEFAULT '[]'::jsonb
);
COMMENT ON TABLE credit_notes IS 'Section 11.1 #5/#6 — raised in SAP, number written back here. Required before a complaint can close.';
COMMENT ON COLUMN credit_notes.notified_to IS 'JSON array, e.g. ["Marketing Head","KAM","Customer"].';
CREATE INDEX idx_credit_notes_complaint ON credit_notes(complaint_no);

-- =========================================================================
--  AUDIT LOG  —  Section 12.6 (append-only, immutable)
-- =========================================================================
CREATE TABLE audit_log (
    log_id       bigserial   PRIMARY KEY,
    complaint_no varchar(20),
    stage        varchar(30),
    from_status  varchar(30),
    to_status    varchar(30),
    action       varchar(80) NOT NULL,
    actor_type   varchar(30) NOT NULL DEFAULT 'User',
    actor_id     varchar(30) NOT NULL DEFAULT 'UNKNOWN',
    actor_role   varchar(60),
    remarks      text,
    "timestamp"  timestamptz NOT NULL DEFAULT now(),
    checksum     varchar(64) NOT NULL
);
COMMENT ON TABLE audit_log IS 'Section 12.6 — append-only. UPDATE and DELETE are blocked by trigger, not convention.';
CREATE INDEX idx_audit_complaint ON audit_log(complaint_no);
CREATE INDEX idx_audit_timestamp ON audit_log("timestamp" DESC);

-- Enforce immutability in the database itself. JS Object.freeze() only
-- protects the running process; this protects the data.
CREATE OR REPLACE FUNCTION audit_log_is_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (Section 12.6): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_immutable();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_immutable();
-- Row-level triggers do NOT fire on TRUNCATE, which would otherwise leave a
-- hole big enough to wipe the whole log. This statement-level guard closes it.
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_immutable();

-- =========================================================================
--  updated_at maintenance
-- =========================================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER complaints_touch BEFORE UPDATE ON complaints
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER samples_touch BEFORE UPDATE ON samples
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER visits_touch BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
