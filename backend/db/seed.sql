-- =========================================================================
--  CCMS — seed data
--  Ported verbatim from src/data/masterData.js so behaviour is unchanged.
--  Safe to re-run: every insert is idempotent (ON CONFLICT DO NOTHING).
--
--  Run:  psql -U postgres -d ccms -f db/seed.sql
-- =========================================================================

BEGIN;

-- ── Departments ─────────────────────────────────────────────────────────
INSERT INTO departments (department_id, department_name, code) VALUES
  ('D001', 'Technical Services (TS)',    'TS'),
  ('D002', 'Quality Control (QC)',       'QC'),
  ('D003', 'Operations',                 'OPS'),
  ('D004', 'Marketing',                  'MKT'),
  ('D005', 'Managing Director Office',   'MD'),
  ('D006', 'Finance',                    'FIN'),
  ('D007', 'Sales',                      'SLS')
ON CONFLICT (department_id) DO NOTHING;

-- ── Roles ───────────────────────────────────────────────────────────────
INSERT INTO roles (role_id, role_name, department_id, can_approve, can_forward, can_reject, level) VALUES
  ('R000', 'Admin',              NULL,   true,  true,  true,  99),
  ('R001', 'TS Officer',         'D001', false, true,  true,  1),
  ('R002', 'TS Head',            'D001', true,  true,  true,  2),
  ('R003', 'QC Analyst',         'D002', false, true,  true,  1),
  ('R004', 'QC Manager',         'D002', true,  true,  true,  2),
  ('R005', 'Operations Analyst', 'D003', false, true,  true,  1),
  ('R006', 'Operations Head',    'D003', true,  true,  true,  3),
  ('R007', 'Product Manager',    'D004', false, true,  true,  1),
  ('R008', 'Marketing Head',     'D004', true,  true,  true,  3),
  ('R009', 'Managing Director',  'D005', true,  true,  true,  4),
  ('R010', 'Finance Officer',    'D006', true,  true,  true,  2),
  ('R011', 'Sales/KAM',          'D007', false, true,  false, 1)
ON CONFLICT (role_id) DO NOTHING;

-- ── Users ───────────────────────────────────────────────────────────────
-- bcrypt hashes carried across unchanged.
--   All staff : Orient@123
--   Admin     : Admin@456
INSERT INTO users (user_id, name, department_id, role_id, email, password_hash, active) VALUES
  ('U001', 'Priya Mehta',    'D001', 'R001', 'priya.mehta@orientpaper.com',    '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U002', 'Kiran Joshi',    'D001', 'R002', 'kiran.joshi@orientpaper.com',    '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U003', 'Amit Verma',     'D002', 'R003', 'amit.verma@orientpaper.com',     '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U004', 'Neha Singh',     'D002', 'R004', 'neha.singh@orientpaper.com',     '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U005', 'Rajesh Gupta',   'D003', 'R005', 'rajesh.gupta@orientpaper.com',   '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U006', 'Sanjay Patel',   'D003', 'R006', 'sanjay.patel@orientpaper.com',   '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U007', 'Deepa Nair',     'D004', 'R007', 'deepa.nair@orientpaper.com',     '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U008', 'Vikram Rao',     'D004', 'R008', 'vikram.rao@orientpaper.com',     '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U009', 'Sumedha Iyer',   'D005', 'R009', 'sumedha.iyer@orientpaper.com',   '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U010', 'Anand Kulkarni', 'D006', 'R010', 'anand.kulkarni@orientpaper.com', '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U011', 'Mohan Das',      'D007', 'R011', 'mohan.das@orientpaper.com',      '$2a$10$fZfWEjCHAmv60K1qsqKzy.NeQpYFsunJ02.2H2maZ5F/B4CzY3/4a', true),
  ('U000', 'CCMS Admin',     NULL,   'R000', 'admin@orientpaper.com',          '$2a$10$LGAEcXXIqJUjC9t1kFFdaOhUuvZyXf4vjIvTjI.l2VYmv.TpTgNnK', true)
ON CONFLICT (user_id) DO NOTHING;

-- ── Customers / Distributors ────────────────────────────────────────────
INSERT INTO customers (customer_id, name, type, region, segment, business_line,
                       contact_person, email, phone, city, state, gst_number,
                       is_key_account, sap_business_partner, app_access, active) VALUES
  ('1000123', 'Shree Distributors Pvt Ltd', 'Distributor', 'Central India',  'Distributor-Standard', 'Paper',
   'Ramesh Sharma', 'accounts@shreedist.example.com',      '9876543210', 'Bhopal',  'Madhya Pradesh', '23AAACS1234A1Z5', false, '1000123', 'mobile', true),
  ('1000456', 'Anand Traders',              'Customer',    'Western India',  'Customer-KeyAccount',  'Paper',
   'Suresh Anand', 'finance@anandtraders.example.com',     '9988776655', 'Surat',   'Gujarat',        '24AAAAA0000A1Z5', true,  '1000456', 'mobile', true),
  ('2000001', 'PetroChemicals Ltd',         'Customer',    'Northern India', 'Customer-Standard',    'Chemical',
   'Anil Kumar',   'purchase@petrochemicals.example.com',  '9112233445', 'Noida',   'Uttar Pradesh',  '09AABCP1234R1ZC', false, '2000001', 'mobile', true),
  ('2000002', 'National Packaging Co.',     'Distributor', 'Eastern India',  'Distributor-Premium',  'Paper',
   'Debashish Roy','info@natpack.example.com',             '9033445566', 'Kolkata', 'West Bengal',    '19AABCN9876Q1ZD', true,  '2000002', 'mobile', true),
  -- The only Paper customer in the north, and so the only one that can file
  -- under the Phase 1 pilot (Section 12.8). Without it the pilot phase is
  -- untestable: the gate would reject every seeded customer.
  ('1000789', 'Himalaya Paper Mart',        'Customer',    'Northern India', 'Customer-Standard',    'Paper',
   'Priya Nair',  'orders@himalayapaper.example.com',      '9445566778', 'Ludhiana','Punjab',        '03AABCH5678K1Z2', false, '1000789', 'mobile', true)
ON CONFLICT (customer_id) DO NOTHING;

-- ── Products / SKUs ─────────────────────────────────────────────────────
INSERT INTO products (product_id, product_name, category, uom, business_line, sap_material_no, active) VALUES
  ('P001', 'Maplitho Paper 70 GSM A4',       'Paper',    'Ream',     'Paper',    'MAT-1001', true),
  ('P002', 'Copier Paper 80 GSM A4',         'Paper',    'Ream',     'Paper',    'MAT-1002', true),
  ('P003', 'Kraft Paper Roll 110 GSM',       'Paper',    'Tonne',    'Paper',    'MAT-1003', true),
  ('P004', 'Newsprint Roll 45 GSM',          'Paper',    'Tonne',    'Paper',    'MAT-1004', true),
  ('P005', 'Caustic Soda Lye 48% (IBC)',     'Chemical', 'MT',       'Chemical', 'MAT-2001', true),
  ('P006', 'Chlorine Gas (Cylinder)',        'Chemical', 'Cylinder', 'Chemical', 'MAT-2002', true),
  ('P007', 'Sodium Hypochlorite 12% (Drum)', 'Chemical', 'Drum',     'Chemical', 'MAT-2003', true)
ON CONFLICT (product_id) DO NOTHING;

-- ── Sample types (Section 6.2) ──────────────────────────────────────────
INSERT INTO sample_types (sample_type_id, sample_type_name, applicable_business_line, default_required) VALUES
  ('ST01', 'Paper Roll Cutting',   'Paper',    true),
  ('ST02', 'Ream Sample',          'Paper',    true),
  ('ST03', 'Chemical Drum Sample', 'Chemical', true),
  ('ST04', 'Packaging Sample',     'Both',     true),
  ('ST05', 'Lab Reference Sample', 'Chemical', false)
ON CONFLICT (sample_type_id) DO NOTHING;

-- ── Complaint types ─────────────────────────────────────────────────────
INSERT INTO complaint_types (type_id, type_name, business_line, sample_required, default_sample_type_id) VALUES
  ('CT01', 'Quality Defect',           'Both',     true,  'ST01'),
  ('CT02', 'Size / Dimension Mismatch','Paper',    false, NULL),
  ('CT03', 'Torn / Damaged',           'Paper',    true,  'ST02'),
  ('CT04', 'Short Supply',             'Both',     false, NULL),
  ('CT05', 'Wrong Product Supplied',   'Both',     true,  'ST01'),
  ('CT06', 'Contamination',            'Chemical', true,  'ST03'),
  ('CT07', 'Packing Defect',           'Both',     true,  'ST04'),
  ('CT08', 'Moisture / Dampness',      'Paper',    true,  'ST01'),
  ('CT09', 'Colour / Shade Variation', 'Paper',    true,  'ST02'),
  ('CT10', 'Billing Error',            'Both',     false, NULL)
ON CONFLICT (type_id) DO NOTHING;

-- ── Sales policies (Section 9.1) ────────────────────────────────────────
INSERT INTO sales_policies (policy_id, policy_name, business_line, applicable_segment, applicable_region,
                            max_settlement_pct, complaint_window_days, linked_discount_scheme,
                            valid_from, valid_to, approval_override_on_breach) VALUES
  ('SP01', 'Standard Paper Return Policy 2026', 'Paper',    'Customer-Standard',    'All',  80, 30, NULL,                 '2026-01-01', '2026-12-31', true),
  ('SP02', 'Key Account Premium Policy 2026',   'Paper',    'Customer-KeyAccount',  'All', 100, 45, 'KA-SCHEME-2026',     '2026-01-01', '2026-12-31', true),
  ('SP03', 'Chemical Standard Policy 2026',     'Chemical', 'Customer-Standard',    'All',  75, 21, NULL,                 '2026-01-01', '2026-12-31', true),
  ('SP04', 'Distributor Standard Policy 2026',  'Both',     'Distributor-Standard', 'All',  85, 30, 'DIST-REBATE-2026',   '2026-01-01', '2026-12-31', false),
  ('SP05', 'Distributor Premium Policy 2026',   'Both',     'Distributor-Premium',  'All', 100, 60, 'DIST-PREMIUM-2026',  '2026-01-01', '2026-12-31', false)
ON CONFLICT (policy_id) DO NOTHING;

-- ── Invoices (mock SAP billing documents) ───────────────────────────────
INSERT INTO invoices (invoice_number, invoice_date, sold_to_party, payment_terms, net_amount, currency) VALUES
  ('90001234', '2026-05-12', '1000123', 'NT30',  45000.00, 'INR'),
  ('90005678', '2026-06-02', '1000456', 'NT45', 128500.00, 'INR'),
  ('90009999', '2026-04-20', '2000001', 'NT60', 175000.00, 'INR'),
  -- Paper / North India — the invoice that makes the Phase 1 pilot testable.
  ('90002468', '2026-07-01', '1000789', 'NT30',  36000.00, 'INR')
ON CONFLICT (invoice_number) DO NOTHING;

INSERT INTO invoice_line_items (invoice_number, invoice_item_no, sap_material_no, material_description,
                                billing_qty, uom, net_amount, unit_price) VALUES
  ('90001234', '10', 'MAT-1002', 'Copier Paper 80 GSM A4',   500, 'Ream',  45000.00,    90.00),
  ('90005678', '10', 'MAT-1001', 'Maplitho Paper 70 GSM A4', 1000,'Ream',  80000.00,    80.00),
  ('90005678', '20', 'MAT-1004', 'Newsprint Roll 45 GSM',    2,   'Tonne', 48500.00, 24250.00),
  ('90009999', '10', 'MAT-2001', 'Caustic Soda Lye 48%',     5,   'MT',   175000.00, 35000.00),
  ('90002468', '10', 'MAT-1002', 'Copier Paper 80 GSM A4',   400, 'Ream',  36000.00,    90.00)
ON CONFLICT (invoice_number, invoice_item_no) DO NOTHING;

COMMIT;

-- ── Summary ─────────────────────────────────────────────────────────────
SELECT 'departments'     AS table_name, count(*) FROM departments
UNION ALL SELECT 'roles',              count(*) FROM roles
UNION ALL SELECT 'users',              count(*) FROM users
UNION ALL SELECT 'customers',          count(*) FROM customers
UNION ALL SELECT 'products',           count(*) FROM products
UNION ALL SELECT 'sample_types',       count(*) FROM sample_types
UNION ALL SELECT 'complaint_types',    count(*) FROM complaint_types
UNION ALL SELECT 'sales_policies',     count(*) FROM sales_policies
UNION ALL SELECT 'invoices',           count(*) FROM invoices
UNION ALL SELECT 'invoice_line_items', count(*) FROM invoice_line_items;
