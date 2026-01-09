-- CHK_027__viewdef_021__address_review_queue
-- Shows the definition of the address review queue view
SELECT pg_get_viewdef('trapper.v_address_review_queue'::regclass, true);
