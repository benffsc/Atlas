BEGIN;

-- MIG_2941: Service Area Conflict Detection (FFS-547)
-- Checks for overlapping service areas using place families (not ST_DWithin)

CREATE OR REPLACE FUNCTION sot.check_service_area_conflicts(
  p_person_id UUID,
  p_place_id UUID,
  p_service_type TEXT DEFAULT NULL
) RETURNS TABLE (
  person_id UUID,
  person_name TEXT,
  service_type TEXT,
  place_id UUID,
  place_name TEXT,
  match_type TEXT  -- 'exact' or 'family'
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_place_family UUID[];
BEGIN
  -- Get place family (parent, children, siblings, co-located)
  v_place_family := sot.get_place_family(p_place_id);

  RETURN QUERY
  SELECT
    tsp.person_id,
    p.display_name AS person_name,
    tsp.service_type,
    tsp.place_id,
    COALESCE(pl.display_name, pl.formatted_address, 'Unknown') AS place_name,
    CASE
      WHEN tsp.place_id = p_place_id THEN 'exact'
      ELSE 'family'
    END AS match_type
  FROM sot.trapper_service_places tsp
  JOIN sot.people p ON p.person_id = tsp.person_id
  JOIN sot.places pl ON pl.place_id = tsp.place_id
  WHERE tsp.person_id != p_person_id
    AND tsp.end_date IS NULL  -- Only active service areas
    AND p.merged_into_person_id IS NULL
    AND (
      tsp.place_id = p_place_id
      OR tsp.place_id = ANY(v_place_family)
    )
  ORDER BY
    CASE WHEN tsp.place_id = p_place_id THEN 0 ELSE 1 END,
    CASE tsp.service_type
      WHEN 'primary_territory' THEN 1
      WHEN 'regular' THEN 2
      WHEN 'occasional' THEN 3
      ELSE 4
    END;
END;
$$;

COMMIT;
