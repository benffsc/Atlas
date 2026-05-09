-- Integration tests for MIG_3127-3130
-- Run: source .env.local && psql "$DATABASE_URL" -f sql/schema/v2/tests/test_mig_3127_3130.sql
-- Expected: All assertions pass (NOTICE messages), no ERRORs.

DO $$
DECLARE
  v_cat_id UUID;
  v_place_id UUID;
  v_dest_place_id UUID;
  v_snapshot_result BOOLEAN;
  v_account_id UUID;
  v_notif_id UUID;
  v_staff_id UUID;
  v_count INT;
BEGIN
  RAISE NOTICE '=== MIG_3127: Lifecycle trigger handles transfer + foster_end ===';

  -- Setup: create a test cat + places
  INSERT INTO sot.cats (display_name, source_system, source_record_id)
  VALUES ('TEST_MIG3127_Cat', 'test', 'test_mig3127_' || gen_random_uuid()::text)
  RETURNING cat_id INTO v_cat_id;

  INSERT INTO sot.places (formatted_address, source_system)
  VALUES ('99999 TEST Origin Place MIG3127', 'test')
  RETURNING place_id INTO v_place_id;

  INSERT INTO sot.places (formatted_address, source_system)
  VALUES ('99999 TEST Dest Place MIG3127', 'test')
  RETURNING place_id INTO v_dest_place_id;

  -- Link cat to origin
  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, presence_status, evidence_type, confidence, source_system)
  VALUES (v_cat_id, v_place_id, 'home', 'current', 'manual', 0.9, 'test');

  -- Test transfer event: should depart origin, create destination
  INSERT INTO sot.cat_lifecycle_events (cat_id, event_type, event_at, origin_place_id, destination_place_id, source_system, source_record_id)
  VALUES (v_cat_id, 'transfer', NOW(), v_place_id, v_dest_place_id, 'test', 'test_transfer_' || gen_random_uuid()::text);

  -- Assert: origin is departed
  SELECT COUNT(*) INTO v_count FROM sot.cat_place
  WHERE cat_id = v_cat_id AND place_id = v_place_id AND presence_status = 'departed';
  IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: transfer did not depart origin'; END IF;
  RAISE NOTICE 'PASS: transfer departed origin';

  -- Assert: destination created with current status
  SELECT COUNT(*) INTO v_count FROM sot.cat_place
  WHERE cat_id = v_cat_id AND place_id = v_dest_place_id AND presence_status = 'current';
  IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: transfer did not create destination'; END IF;
  RAISE NOTICE 'PASS: transfer created destination';

  -- Test foster_end: create a foster place, link cat, fire event
  UPDATE sot.cat_place SET presence_status = 'current', relationship_type = 'associated'
  WHERE cat_id = v_cat_id AND place_id = v_dest_place_id;

  INSERT INTO sot.cat_lifecycle_events (cat_id, event_type, event_at, origin_place_id, source_system, source_record_id)
  VALUES (v_cat_id, 'foster_end', NOW(), v_dest_place_id, 'test', 'test_fosterend_' || gen_random_uuid()::text);

  SELECT COUNT(*) INTO v_count FROM sot.cat_place
  WHERE cat_id = v_cat_id AND place_id = v_dest_place_id AND presence_status = 'departed';
  IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: foster_end did not depart foster home'; END IF;
  RAISE NOTICE 'PASS: foster_end departed foster home';

  -- Cleanup
  DELETE FROM sot.cat_lifecycle_events WHERE cat_id = v_cat_id;
  DELETE FROM sot.cat_place WHERE cat_id = v_cat_id;
  DELETE FROM sot.cats WHERE cat_id = v_cat_id;
  DELETE FROM sot.places WHERE place_id IN (v_place_id, v_dest_place_id);

  RAISE NOTICE '=== MIG_3128: Staff notifications table ===';

  -- Get any staff member
  SELECT staff_id INTO v_staff_id FROM ops.staff WHERE is_active = TRUE LIMIT 1;
  IF v_staff_id IS NULL THEN RAISE EXCEPTION 'FAIL: no active staff found'; END IF;

  -- Insert + read + mark read
  INSERT INTO ops.staff_notifications (staff_id, title, body, source, source_id)
  VALUES (v_staff_id, 'TEST notification', 'test body', 'system', gen_random_uuid())
  RETURNING id INTO v_notif_id;

  SELECT COUNT(*) INTO v_count FROM ops.staff_notifications
  WHERE id = v_notif_id AND is_read = FALSE;
  IF v_count != 1 THEN RAISE EXCEPTION 'FAIL: notification not created as unread'; END IF;
  RAISE NOTICE 'PASS: notification created as unread';

  UPDATE ops.staff_notifications SET is_read = TRUE WHERE id = v_notif_id;
  SELECT COUNT(*) INTO v_count FROM ops.staff_notifications
  WHERE id = v_notif_id AND is_read = TRUE;
  IF v_count != 1 THEN RAISE EXCEPTION 'FAIL: notification not marked read'; END IF;
  RAISE NOTICE 'PASS: notification mark-read works';

  DELETE FROM ops.staff_notifications WHERE id = v_notif_id;

  RAISE NOTICE '=== MIG_3129: Ownership snapshot function ===';

  -- Create a test clinic account
  INSERT INTO ops.clinic_accounts (owner_first_name, owner_last_name, owner_email, owner_phone, account_type, source_system, source_record_id)
  VALUES ('TestFirst', 'TestLast', 'test3129@example.com', '7075551234', 'resident', 'test', 'test_snap_' || gen_random_uuid()::text)
  RETURNING account_id INTO v_account_id;

  -- No change → should return FALSE
  v_snapshot_result := ops.snapshot_clinic_account_if_changed(
    v_account_id, 'TestFirst', 'TestLast', 'test3129@example.com', '7075551234', NULL, NULL
  );
  IF v_snapshot_result THEN RAISE EXCEPTION 'FAIL: snapshot detected change when none existed'; END IF;
  RAISE NOTICE 'PASS: no-change returns FALSE';

  -- Change email → should return TRUE and create snapshot
  v_snapshot_result := ops.snapshot_clinic_account_if_changed(
    v_account_id, 'TestFirst', 'TestLast', 'newemail@example.com', '7075551234', NULL, NULL
  );
  IF NOT v_snapshot_result THEN RAISE EXCEPTION 'FAIL: snapshot did not detect email change'; END IF;

  SELECT COUNT(*) INTO v_count FROM ops.clinic_account_snapshots
  WHERE account_id = v_account_id AND change_detected = TRUE AND 'email' = ANY(change_fields);
  IF v_count = 0 THEN RAISE EXCEPTION 'FAIL: snapshot row not created with email field'; END IF;
  RAISE NOTICE 'PASS: email change detected and snapshot created';

  -- Change name → should detect first_name + last_name
  v_snapshot_result := ops.snapshot_clinic_account_if_changed(
    v_account_id, 'NewFirst', 'NewLast', NULL, NULL, NULL, NULL
  );
  IF NOT v_snapshot_result THEN RAISE EXCEPTION 'FAIL: snapshot did not detect name change'; END IF;
  RAISE NOTICE 'PASS: name change detected';

  -- Cleanup
  DELETE FROM ops.clinic_account_snapshots WHERE account_id = v_account_id;
  DELETE FROM ops.clinic_accounts WHERE account_id = v_account_id;

  RAISE NOTICE '=== MIG_3130: Conversation quality view exists ===';

  -- Just verify the view is queryable
  PERFORM * FROM ops.v_tippy_conversation_quality LIMIT 0;
  RAISE NOTICE 'PASS: v_tippy_conversation_quality view is queryable';

  -- Verify columns exist on tippy_conversations
  SELECT COUNT(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'ops' AND table_name = 'tippy_conversations'
    AND column_name IN ('iterations_used', 'hit_iteration_limit', 'had_empty_response', 'continue_count', 'schema_exploration_blocked');
  IF v_count != 5 THEN RAISE EXCEPTION 'FAIL: expected 5 quality columns, got %', v_count; END IF;
  RAISE NOTICE 'PASS: all 5 quality metric columns exist';

  RAISE NOTICE '';
  RAISE NOTICE '=== ALL TESTS PASSED ===';
END;
$$;
