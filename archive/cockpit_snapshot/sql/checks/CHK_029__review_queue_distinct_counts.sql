-- CHK_029__review_queue_distinct_counts
-- Shows distinct counts from the address review queue
SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT address_id) AS distinct_addresses
FROM trapper.v_address_review_queue;
