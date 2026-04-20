-- MIG_3098: Fix cancelled entry detection — remove broken name matching
--
-- FFS-1316: detect_cancelled_entries() used exact name match to count
-- appointments per owner. Typos, format differences, and foster bookings
-- caused 114 entries to be wrongly hidden as "cancelled".
--
-- Fix: removed 'more_entries_than_appointments' detection entirely.
-- Kept header_row and recheck_different_date which are reliable.
--
-- Created: 2026-04-20

-- Function already updated via psql. This documents the fix.
-- Also clears any remaining wrongly-set cancellation_reason.

UPDATE ops.clinic_day_entries SET cancellation_reason = NULL
WHERE cancellation_reason = 'more_entries_than_appointments';
