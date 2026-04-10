-- MIG_3076: Update equipment agreement text with liability release language
--
-- FFS-1227 (Equipment Overhaul epic FFS-1201).
--
-- Per Alley Cat Allies (alleycat.org/resources/how-to-start-a-trap-depot):
-- The trap loan form "may also serve as a release form, to protect you
-- from any liability for any injury resulting from the trap."
--
-- Updates the agreement text seeded in MIG_3075 to include:
-- 1. Liability release for injury from trap/cage use
-- 2. Humane treatment requirement
-- 3. Proper trap placement (not on others' property without permission)
-- 4. Non-target animal handling instructions
-- 5. Explicit deposit forfeiture terms
-- 6. Org contact info for emergencies
--
-- Run with:
--   psql $DATABASE_URL -f sql/schema/v2/MIG_3076__equipment_agreement_liability_language.sql

UPDATE ops.app_config
SET value = to_jsonb('EQUIPMENT LOAN AGREEMENT

By signing below, I acknowledge that I am borrowing equipment from Forgotten Felines of Sonoma County (FFSC) and agree to the following terms:

1. CARE OF EQUIPMENT — I will use the equipment responsibly and return it in the same condition it was issued. I understand that I am responsible for any damage, loss, or theft of the equipment while in my possession.

2. RETURN DATE — I agree to return the equipment by the due date specified on this form. If I need more time, I will contact FFSC at (707) 576-7999 BEFORE the due date to request an extension. Extensions are generally granted given the unpredictability of cat trapping.

3. HUMANE USE ONLY — I agree to use this equipment ONLY for the humane capture of cats for the purpose of spay/neuter (TNR) or rescue. I will check the trap at least every 12 hours. Trapped cats must be provided with shelter from weather, and traps must be covered with a towel or sheet to reduce stress.

4. PROPER PLACEMENT — I will not place traps on property I do not own or have permission to access. If trapping on another person''s property, I will obtain their permission first.

5. NON-TARGET ANIMALS — If a non-target animal (skunk, raccoon, opossum, etc.) is caught, I will release it immediately by opening the trap door. I will NOT attempt to handle the animal. If I catch an injured or sick animal, I will contact FFSC or Sonoma County Animal Services at (707) 565-7100.

6. DEPOSIT — If a deposit was collected, it will be refunded upon return of the equipment in good condition. Deposits are forfeited if equipment is not returned within 30 days of the due date, or if returned in a damaged or non-functional condition.

7. LIABILITY RELEASE — I understand that FFSC provides this equipment as a public service and assumes no liability for any injury, property damage, animal injury, or other loss arising from my use of this equipment. I assume all risks associated with the use of trapping equipment and release FFSC, its staff, volunteers, and agents from any and all claims related to my use of this equipment.

8. IDENTIFICATION — I confirm that the contact information I have provided is accurate and that FFSC may contact me regarding this equipment loan.

By typing my name below and tapping "I Agree," I acknowledge that I have read, understood, and agree to all terms above.'::text),
    updated_at = NOW()
WHERE key = 'equipment.agreement_text';

-- Bump the version so signed agreements track which text was shown
UPDATE ops.app_config
SET value = to_jsonb('2.0'::text),
    updated_at = NOW()
WHERE key = 'equipment.agreement_version';

\echo 'MIG_3076 applied: agreement text updated with liability release + version bumped to 2.0'
