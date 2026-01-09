-- CHK_030__request_case_number_integrity
-- Verifies case_number coverage + duplicates
SELECT
  COUNT(*) AS total_requests,
  COUNT(case_number) AS with_case_number,
  COUNT(*) - COUNT(case_number) AS null_case_numbers,
  COUNT(DISTINCT case_number) AS distinct_case_numbers,
  COUNT(*) - COUNT(DISTINCT case_number) AS duplicate_case_numbers
FROM trapper.requests;
