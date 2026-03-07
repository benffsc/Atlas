-- MIG_2850: Backfill structured intake fields from situation_description text blob
-- The intake form concatenated call_type, cat_name, cat_description, feeding_situation
-- into situation_description. This extracts them into their proper columns.
-- Depends on MIG_2849 (call_type column) and MIG_2531 (cat_name, cat_description, feeding_situation columns).

DO $$
DECLARE
  v_call_type_count INT;
  v_cat_name_count INT;
  v_cat_description_count INT;
  v_feeding_count INT;
BEGIN
  -- Pattern: "Call type: <value>\n"
  UPDATE ops.intake_submissions
  SET call_type = TRIM(SUBSTRING(situation_description FROM 'Call type: ([^\n]+)'))
  WHERE call_type IS NULL
    AND situation_description LIKE 'Call type:%';
  GET DIAGNOSTICS v_call_type_count = ROW_COUNT;

  -- Pattern: "Cat name: <value>\n"
  UPDATE ops.intake_submissions
  SET cat_name = TRIM(SUBSTRING(situation_description FROM 'Cat name: ([^\n]+)'))
  WHERE cat_name IS NULL
    AND situation_description LIKE '%Cat name:%';
  GET DIAGNOSTICS v_cat_name_count = ROW_COUNT;

  -- Pattern: "Description: <value>\n"
  UPDATE ops.intake_submissions
  SET cat_description = TRIM(SUBSTRING(situation_description FROM 'Description: ([^\n]+)'))
  WHERE cat_description IS NULL
    AND situation_description LIKE '%Description:%';
  GET DIAGNOSTICS v_cat_description_count = ROW_COUNT;

  -- Pattern: "Feeding: <value>\n"
  UPDATE ops.intake_submissions
  SET feeding_situation = TRIM(SUBSTRING(situation_description FROM 'Feeding: ([^\n]+)'))
  WHERE feeding_situation IS NULL
    AND situation_description LIKE '%Feeding:%';
  GET DIAGNOSTICS v_feeding_count = ROW_COUNT;

  RAISE NOTICE 'MIG_2850 backfill: call_type=%, cat_name=%, cat_description=%, feeding_situation=%',
    v_call_type_count, v_cat_name_count, v_cat_description_count, v_feeding_count;
END $$;
