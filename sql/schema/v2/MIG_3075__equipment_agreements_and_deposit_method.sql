-- MIG_3075: Equipment agreements + deposit method + return policy
--
-- FFS-1207 (digital waiver), FFS-1208 (deposit method), FFS-1209 (return policy)
-- All part of the Equipment Overhaul epic FFS-1201, Layer 2.
--
-- Run with:
--   psql $DATABASE_URL -f sql/schema/v2/MIG_3075__equipment_agreements_and_deposit_method.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Equipment agreements table (FFS-1207)
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores the signed loan agreement for each equipment checkout. Linked to
-- the checkout event. Typed-name-plus-timestamp signature — legally sufficient
-- for loan agreements in this value range under CA law.

CREATE TABLE IF NOT EXISTS ops.equipment_agreements (
  agreement_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID REFERENCES ops.equipment_events(event_id),
  equipment_id     UUID NOT NULL REFERENCES ops.equipment(equipment_id),
  person_id        UUID REFERENCES sot.people(person_id),
  -- The name as typed by the borrower at the moment of signing
  person_name      TEXT NOT NULL,
  -- Which version of the agreement text was shown
  agreement_version TEXT NOT NULL DEFAULT '1.0',
  -- The full text that was displayed (snapshot — so if the config changes
  -- later, the signed version is preserved)
  agreement_text   TEXT NOT NULL,
  -- Signing metadata
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_type   TEXT NOT NULL DEFAULT 'typed_name'
    CHECK (signature_type IN ('typed_name', 'checkbox', 'digital_signature')),
  -- The typed name or other signature value
  signature_value  TEXT,
  -- Context
  ip_address       TEXT,
  user_agent       TEXT,
  source_system    TEXT NOT NULL DEFAULT 'atlas_ui',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_agreements_event
  ON ops.equipment_agreements(event_id);
CREATE INDEX IF NOT EXISTS idx_equipment_agreements_equipment
  ON ops.equipment_agreements(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_agreements_person
  ON ops.equipment_agreements(person_id);

COMMENT ON TABLE ops.equipment_agreements IS
  'Stores the signed loan agreement for each equipment checkout. The agreement_text is a snapshot of what was displayed — preserved even if the config-driven template changes later. See FFS-1207.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Deposit method column on equipment_events (FFS-1208)
-- ─────────────────────────────────────────────────────────────────────────────
-- Records HOW the deposit was paid. Atlas stores NO card details (zero PCI).

ALTER TABLE ops.equipment_events
  ADD COLUMN IF NOT EXISTS deposit_method TEXT
  CHECK (deposit_method IS NULL OR deposit_method IN ('cash', 'card', 'waived', 'none'));

COMMENT ON COLUMN ops.equipment_events.deposit_method IS
  'How the deposit was paid: cash, card (no card details stored — zero PCI), waived, or none. See FFS-1208.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Config seeds (FFS-1207 + FFS-1209)
-- ─────────────────────────────────────────────────────────────────────────────

-- Default agreement text
INSERT INTO ops.app_config (key, value, category, updated_at)
VALUES (
  'equipment.agreement_text',
  to_jsonb('EQUIPMENT LOAN AGREEMENT

By signing below, I acknowledge that I am borrowing equipment from Forgotten Felines of Sonoma County (FFSC) and agree to the following terms:

1. CARE OF EQUIPMENT — I will use the equipment responsibly and return it in the same condition it was issued. I understand that I am responsible for any damage, loss, or theft of the equipment while in my possession.

2. RETURN DATE — I agree to return the equipment by the due date specified on this form. If I need more time, I will contact FFSC at (707) 576-7999 before the due date to request an extension.

3. DEPOSIT — If a deposit was collected, it will be refunded upon return of the equipment in good condition. Deposits are forfeited if equipment is not returned or is returned damaged.

4. LIABILITY — I understand that FFSC is not responsible for any injury, property damage, or other liability arising from my use of this equipment. I use the equipment at my own risk.

5. IDENTIFICATION — I confirm that the contact information I have provided is accurate and that FFSC may contact me regarding this equipment loan.

By typing my name below and tapping "I Agree," I acknowledge that I have read, understood, and agree to these terms.'::text),
  'equipment',
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- Default return policy text (displayed on slip footer + success screen)
INSERT INTO ops.app_config (key, value, category, updated_at)
VALUES (
  'equipment.return_policy_text',
  to_jsonb('Equipment is loaned in good faith. Please return by the due date listed above. Deposits are refunded on return when the equipment comes back in good condition. Call (707) 576-7999 with any questions.'::text),
  'equipment',
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- Agreement version for tracking which text was shown
INSERT INTO ops.app_config (key, value, category, updated_at)
VALUES (
  'equipment.agreement_version',
  to_jsonb('1.0'::text),
  'equipment',
  NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

\echo 'MIG_3075 applied:'
\echo '  - ops.equipment_agreements table (FFS-1207)'
\echo '  - ops.equipment_events.deposit_method column (FFS-1208)'
\echo '  - equipment.agreement_text config seed (FFS-1207)'
\echo '  - equipment.return_policy_text config seed (FFS-1209)'
\echo '  - equipment.agreement_version config seed'
