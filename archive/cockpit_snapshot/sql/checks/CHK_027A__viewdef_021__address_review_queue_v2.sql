-- CHK_027A__viewdef_021__address_review_queue_v2
-- Shows the definition of the v2 address review queue view
SELECT pg_get_viewdef('trapper.v_address_review_queue_v2'::regclass, true);
