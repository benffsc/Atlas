-- MIG_2951: Fix get_trapper_info() wrong column references (FFS-586)
--
-- MIG_2301 line 419 references rta.appointment_id and rta.person_id
-- which don't exist on ops.request_trapper_assignments. Correct columns
-- are rta.request_id and rta.trapper_person_id.

BEGIN;

CREATE OR REPLACE FUNCTION ops.get_trapper_info(p_person_id UUID)
RETURNS TABLE(
  is_trapper BOOLEAN,
  trapper_type TEXT,
  role_status TEXT,
  total_cats_caught INT
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    TRUE AS is_trapper,
    pr.role AS trapper_type,
    pr.role_status,
    COALESCE((
      SELECT COUNT(DISTINCT rta.request_id)::INT
      FROM ops.request_trapper_assignments rta
      WHERE rta.trapper_person_id = p_person_id
    ), 0) AS total_cats_caught
  FROM ops.person_roles pr
  WHERE pr.person_id = p_person_id
    AND pr.role = 'trapper'
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION ops.get_trapper_info IS 'Returns trapper info for a person including assignment count (fixed column refs from MIG_2301)';

COMMIT;
