-- VIEW_053__this_week_focus
-- Rolling 14-day window: requests from last 14 days + upcoming in next 14 days
-- Adds age_days and needs_follow_up columns
-- Contract: explicit columns, no ORDER BY
CREATE OR REPLACE VIEW trapper.v_this_week_focus AS
SELECT
    uf.feed_type,
    uf.is_scheduled,
    uf.event_date,
    uf.submitted_at,
    uf.appt_date,
    uf.person_full_name,
    uf.email,
    uf.phone,
    uf.address,
    uf.county,
    uf.status,
    uf.animal_name,
    uf.ownership_type,
    uf.client_type,
    uf.source_system,
    uf.source_file,
    uf.source_row_hash,
    uf.created_at,
    uf.updated_at,
    uf.id,
    -- Derived: age in days
    -- Requests: days since submitted (positive = older)
    -- Upcoming: days until appointment (positive = future)
    CASE
        WHEN uf.is_scheduled = false THEN (current_date - uf.event_date)
        ELSE (uf.appt_date - current_date)
    END AS age_days,
    -- Derived: needs follow-up if missing contact OR missing address
    (
        (NULLIF(TRIM(uf.email), '') IS NULL AND NULLIF(TRIM(uf.phone), '') IS NULL)
        OR
        (NULLIF(TRIM(uf.address), '') IS NULL)
    ) AS needs_follow_up,
    -- Reserved: kittens flag (not yet wired to source data)
    NULL::boolean AS kittens_flag
FROM trapper.v_intake_unified_feed uf
WHERE
    -- Requests: submitted in last 14 days
    (uf.is_scheduled = false AND uf.event_date BETWEEN (current_date - 14) AND current_date)
    OR
    -- Upcoming: scheduled in next 14 days
    (uf.is_scheduled = true AND uf.appt_date BETWEEN current_date AND (current_date + 14));
