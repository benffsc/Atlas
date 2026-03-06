-- MIG_2826: Backfill resolved_at from Airtable 'Last Modified Case Status'
--
-- PROBLEM: 156 completed Airtable requests had resolved_at = 2026-01-15
-- (the Atlas import date), not the actual resolution date from Airtable.
-- This inflated the attribution grace period window by 2-8 months.
--
-- SOURCE: Airtable "Trapping Requests" table → "Last Modified Case Status" field
-- (lastModifiedTime type — records when Case Status was last changed)
--
-- Created: 2026-03-06

\echo ''
\echo '=============================================='
\echo '  MIG_2826: Backfill Airtable resolved_at'
\echo '=============================================='
\echo ''

\echo 'Before: completed Airtable requests with import-date resolved_at:'
SELECT COUNT(*) as import_date_count
FROM ops.requests
WHERE source_system = 'airtable_ffsc'
  AND status = 'completed'
  AND DATE(resolved_at) = '2026-01-15';

\echo ''
\echo 'Updating resolved_at from Airtable Last Modified Case Status...'

-- Complete/Closed requests (147 records)
UPDATE ops.requests SET resolved_at = '2025-09-25T23:16:42.000Z' WHERE source_record_id = 'rec02BbjJ0Xzts31X' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-30T20:43:19.000Z' WHERE source_record_id = 'rec0agmZc1ZM7PZrZ' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-12T21:21:23.000Z' WHERE source_record_id = 'rec0hx3AEDOVvDc6r' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:00:25.000Z' WHERE source_record_id = 'rec0joz8MNT58jcUq' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:34:49.000Z' WHERE source_record_id = 'rec0tdX6xVE04S8Nw' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:09:42.000Z' WHERE source_record_id = 'rec1ZNEUnU39juqoN' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:15:51.000Z' WHERE source_record_id = 'rec2gzmlRRFZlUkvT' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-04T22:11:18.000Z' WHERE source_record_id = 'rec3GIYZ1AsQ5bul5' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-23T20:56:23.000Z' WHERE source_record_id = 'rec3eY8JRCREjLCZb' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:20:26.000Z' WHERE source_record_id = 'rec3q2SknJoKEhunB' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-08T17:48:15.000Z' WHERE source_record_id = 'rec3sbrzvzXHVF1d4' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-20T20:06:41.000Z' WHERE source_record_id = 'rec40AfbnwnOzjWDX' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2026-01-05T22:31:29.000Z' WHERE source_record_id = 'rec49wx2BtUjQ9dgj' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-12T21:05:12.000Z' WHERE source_record_id = 'rec4YLiDPGh4Kfy1b' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-06T17:22:34.000Z' WHERE source_record_id = 'rec4nS7srr1EUYKsB' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-13T22:57:30.000Z' WHERE source_record_id = 'rec4rGGLbFC18sWka' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-08T17:53:24.000Z' WHERE source_record_id = 'rec5IDgR4U6ydHGrX' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-03T17:54:51.000Z' WHERE source_record_id = 'rec71LWo8N1FqHHF1' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:11:14.000Z' WHERE source_record_id = 'rec8KKWYFhBHPjIzY' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:03:11.000Z' WHERE source_record_id = 'rec90UGZwDrisPLX6' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:40:02.000Z' WHERE source_record_id = 'rec9cLr6KLocfIToG' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-23T17:06:20.000Z' WHERE source_record_id = 'rec9j0aSfFFvQAOvS' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-22T21:55:44.000Z' WHERE source_record_id = 'recAjHIFJk7l63XtA' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:34:28.000Z' WHERE source_record_id = 'recBQZx7taBSdYR9l' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2026-01-06T00:22:23.000Z' WHERE source_record_id = 'recBdBKfiD5AbyQIe' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:13:07.000Z' WHERE source_record_id = 'recBkjvVveusDodKi' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-19T20:51:07.000Z' WHERE source_record_id = 'recBzQWiGAJ3hjDhF' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-03T17:53:37.000Z' WHERE source_record_id = 'recCeeeXXwq9DuiGp' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:13:07.000Z' WHERE source_record_id = 'recCmGfSnDR9FpVa0' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:31:55.000Z' WHERE source_record_id = 'recCrAcKAKIia4TLD' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:37:05.000Z' WHERE source_record_id = 'recCxkHrSwIJ2Dw8I' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-19T20:38:14.000Z' WHERE source_record_id = 'recD52rYli1JNiIDl' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:30:43.000Z' WHERE source_record_id = 'recDHWHQ6RPTwgf55' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-23T17:49:42.000Z' WHERE source_record_id = 'recDLnq91caSyorpu' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-29T21:44:05.000Z' WHERE source_record_id = 'recDZBb8rUB1vYkq5' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:30:52.000Z' WHERE source_record_id = 'recDcQHuKmErcLoje' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:39:17.000Z' WHERE source_record_id = 'recDyKuv7rH8I9lIo' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:14:14.000Z' WHERE source_record_id = 'recEZeimtIqfQiprf' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-10T22:13:35.000Z' WHERE source_record_id = 'recGA4YBFr1ZPFITn' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-28T22:04:05.000Z' WHERE source_record_id = 'recGLK5M1gpphYxLJ' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:02:15.000Z' WHERE source_record_id = 'recGuW4uVGGUaiugN' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-28T00:35:42.000Z' WHERE source_record_id = 'recGxkztUM7ZIuKGr' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-21T19:07:35.000Z' WHERE source_record_id = 'recH4TFcyHpMuFMBj' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:02:35.000Z' WHERE source_record_id = 'recHBnBA3KocJzwOl' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:33:12.000Z' WHERE source_record_id = 'recHMt4pvo93jd39j' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:03:31.000Z' WHERE source_record_id = 'recHWsTQzez0heh7A' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-15T22:14:24.000Z' WHERE source_record_id = 'recHgbKX1HwlMZFZA' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-20T21:40:07.000Z' WHERE source_record_id = 'recInu38i7AoievHB' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-10T22:12:12.000Z' WHERE source_record_id = 'recJ35mpfEG5iCd9Z' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-10T22:17:11.000Z' WHERE source_record_id = 'recJbsIHAmeuoaTiG' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-02T18:28:07.000Z' WHERE source_record_id = 'recKHLiWM70TzdUxE' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-13T22:57:05.000Z' WHERE source_record_id = 'recKdQl1BBKYfpDsU' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-20T20:18:07.000Z' WHERE source_record_id = 'recLVSQ85Uws19vKt' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-20T21:40:48.000Z' WHERE source_record_id = 'recLcSN2XWnWX1SYZ' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-12T22:45:08.000Z' WHERE source_record_id = 'recLz6UUriyBHrwRi' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:24:55.000Z' WHERE source_record_id = 'recMQfCPk4wQ2qzRN' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-03T17:56:43.000Z' WHERE source_record_id = 'recMZpSo4SNhJtw8c' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:24:35.000Z' WHERE source_record_id = 'recMk0dW9C4lBgFwR' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-11T22:08:47.000Z' WHERE source_record_id = 'recMo8xRiaZWysnt3' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-13T22:55:56.000Z' WHERE source_record_id = 'recMsb6iSu45IBJia' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-12T21:20:45.000Z' WHERE source_record_id = 'recNLeMcYMWgKHUR1' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-19T00:41:22.000Z' WHERE source_record_id = 'recNg0D10T7nHL9Wj' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:37:42.000Z' WHERE source_record_id = 'recO59jekSHcXyP7z' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-19T20:48:20.000Z' WHERE source_record_id = 'recOPZYkN4mOI7Ag5' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:35:30.000Z' WHERE source_record_id = 'recOYDLu1NO5pEp6p' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-30T20:43:35.000Z' WHERE source_record_id = 'recPmP5II31Jihzlu' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:02:07.000Z' WHERE source_record_id = 'recShh8ZFPyxWDnja' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-21T19:11:46.000Z' WHERE source_record_id = 'recSlYML1Mobscwy1' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-02T00:16:01.000Z' WHERE source_record_id = 'recStpmrnXhj8KkYq' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-20T21:24:41.000Z' WHERE source_record_id = 'recT6TzasY9iTYF2f' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-12T22:53:38.000Z' WHERE source_record_id = 'recT77dmyZcxTDBRf' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:10:49.000Z' WHERE source_record_id = 'recTMfSfSIvK2bLLk' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-06T17:19:33.000Z' WHERE source_record_id = 'recTY5Ba7oNViQdio' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:33:24.000Z' WHERE source_record_id = 'recTwov6bOSdLts0s' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:34:06.000Z' WHERE source_record_id = 'recULj5lrfeROjj6k' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:13:21.000Z' WHERE source_record_id = 'recUWJWKGHYJo7AbH' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:04:47.000Z' WHERE source_record_id = 'recVH0QwSALpVqbgy' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-06T17:08:48.000Z' WHERE source_record_id = 'recVIzC09cneeMtRU' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:25:32.000Z' WHERE source_record_id = 'recVLL61PmS0H92D8' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-13T21:50:54.000Z' WHERE source_record_id = 'recVNXqdIyYKTw7oo' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-06T17:41:33.000Z' WHERE source_record_id = 'recVTjfrSeJtSs0Er' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-27T21:28:34.000Z' WHERE source_record_id = 'recViVxpVOjMEsQuj' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:34:58.000Z' WHERE source_record_id = 'recVk9BytpswnJfDA' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:28:52.000Z' WHERE source_record_id = 'recW81LgoCtL5iGk0' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2026-01-05T22:32:09.000Z' WHERE source_record_id = 'recWPyonYlaF8FLjJ' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T20:58:38.000Z' WHERE source_record_id = 'recX5iOb4lUJYMsV6' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-25T17:47:41.000Z' WHERE source_record_id = 'recXI9ASPdiWQwp5A' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:01:46.000Z' WHERE source_record_id = 'recXqk6DIoXZtLYmt' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-24T17:56:27.000Z' WHERE source_record_id = 'recYbBmnhPbMvmxfO' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-09T22:20:11.000Z' WHERE source_record_id = 'recYmlEyHj311hD5E' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:34:39.000Z' WHERE source_record_id = 'recZSc2FHUIEqAU1Z' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-21T19:10:11.000Z' WHERE source_record_id = 'recZtTqaTDMiaAGS8' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-13T22:56:48.000Z' WHERE source_record_id = 'recaINLZ7R4qFVKQt' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-22T22:47:42.000Z' WHERE source_record_id = 'recb8CNHEfTF7C56u' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:36:28.000Z' WHERE source_record_id = 'reccY1n28esPxZmdM' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:14:54.000Z' WHERE source_record_id = 'recdiGnCfy7eam8RB' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-28T22:57:29.000Z' WHERE source_record_id = 'recdiLAzkMp4Vqamw' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-28T22:56:49.000Z' WHERE source_record_id = 'receJZgtah8ajwUvn' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-26T20:46:42.000Z' WHERE source_record_id = 'receK86yqbXDbZcFd' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-15T22:15:34.000Z' WHERE source_record_id = 'receXj9tPcevsxIh5' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:14:28.000Z' WHERE source_record_id = 'recfJhYGyGGZ93MJ1' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:34:14.000Z' WHERE source_record_id = 'recgMh1ETCuTi1oXV' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:34:37.000Z' WHERE source_record_id = 'recghqpRtmCmUGWgf' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-21T19:12:47.000Z' WHERE source_record_id = 'rech22nmgX7xBXOUw' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-01T23:39:31.000Z' WHERE source_record_id = 'rechSWgVmVLCawbpf' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-29T21:45:00.000Z' WHERE source_record_id = 'rechewsdbVr1okX6O' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:39:50.000Z' WHERE source_record_id = 'recigIbTzhxKGvIxJ' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:36:47.000Z' WHERE source_record_id = 'recjJ09anORj8uB9O' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:01:37.000Z' WHERE source_record_id = 'recjNx8kVBmszKeA1' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:01:49.000Z' WHERE source_record_id = 'recjeV7eXkX1DWEPl' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-18T17:32:09.000Z' WHERE source_record_id = 'recjwVRCyPiZ5xpeE' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:26:07.000Z' WHERE source_record_id = 'reckDEI2u4nvqvqlK' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:27:37.000Z' WHERE source_record_id = 'reclWyoeFdgltGf84' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-08T17:53:11.000Z' WHERE source_record_id = 'recltZcm4UCFfCdbS' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:26:48.000Z' WHERE source_record_id = 'recmVeIzzUkJMmaFc' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-11T18:50:29.000Z' WHERE source_record_id = 'recnAADvQXY02q5xg' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-25T17:48:04.000Z' WHERE source_record_id = 'recnLsmHa5JL7ZHco' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:01:10.000Z' WHERE source_record_id = 'recnygALlXl8Cdbp0' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-03T17:56:14.000Z' WHERE source_record_id = 'recoAzO6JKs3I8wRL' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2026-01-05T22:31:51.000Z' WHERE source_record_id = 'recoLo1e8Z9GuYB7C' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:04:26.000Z' WHERE source_record_id = 'recoPn28jAMSSH7yM' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-24T17:55:28.000Z' WHERE source_record_id = 'recoW822kl9936DTq' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:01:13.000Z' WHERE source_record_id = 'recoyQe7fyjNk0JdW' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-11-18T22:27:06.000Z' WHERE source_record_id = 'recp6BjPqrGVOevL7' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-30T20:45:00.000Z' WHERE source_record_id = 'recqKY4pLlB0iKNys' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-16T21:12:41.000Z' WHERE source_record_id = 'recqOZPeary9aDNsw' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-30T20:44:16.000Z' WHERE source_record_id = 'recqy3jVVq0LN3esG' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:15:06.000Z' WHERE source_record_id = 'recrhUqeBE8RbW5TT' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-16T21:11:58.000Z' WHERE source_record_id = 'recrmHCAF1gJgZfs2' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-12T21:22:37.000Z' WHERE source_record_id = 'recsLHZgPf5bqHTrL' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:13:41.000Z' WHERE source_record_id = 'recsM8OxBCcDFnrA8' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:35:38.000Z' WHERE source_record_id = 'recstpLm0XESKde3Q' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-17T23:36:06.000Z' WHERE source_record_id = 'rect9Lr2biyQ1RCpi' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-28T00:34:50.000Z' WHERE source_record_id = 'recuqx6jEmYEI5SNo' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-10T23:06:22.000Z' WHERE source_record_id = 'recvFZZdQ0mIEpQK5' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-16T22:56:45.000Z' WHERE source_record_id = 'recvtsCPU0LBd2wBx' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-31T22:35:38.000Z' WHERE source_record_id = 'recw3hGxBlsNFqqcb' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-28T22:56:08.000Z' WHERE source_record_id = 'recwZO7SBnYmuwC4m' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-05-19T19:16:36.000Z' WHERE source_record_id = 'recwcGu9crUUi1va6' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-25T22:11:29.000Z' WHERE source_record_id = 'recxP5RBBGt17MZel' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-03T17:54:28.000Z' WHERE source_record_id = 'recyEK1JBWP6kwS2m' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:33:43.000Z' WHERE source_record_id = 'recyGkhMdVvc7iVBq' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-09-12T21:22:11.000Z' WHERE source_record_id = 'recySrMpYHf0zEU86' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-01T19:49:02.000Z' WHERE source_record_id = 'recz8Q5jT6j8dyieA' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-21T19:12:16.000Z' WHERE source_record_id = 'reczDzRue53d001rd' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-14T21:15:31.000Z' WHERE source_record_id = 'reczJk43go4kHFUXo' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-12T23:46:20.000Z' WHERE source_record_id = 'reczUDFzmh461mUeM' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';

-- Denied/Duplicate/Referred requests (10 records)
UPDATE ops.requests SET resolved_at = '2025-06-06T17:22:41.000Z' WHERE source_record_id = 'recfdUQlCOgOvutm2' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T17:10:18.000Z' WHERE source_record_id = 'rectaBhQCz6ECok3U' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-07-17T20:47:12.000Z' WHERE source_record_id = 'recELQuBu4JUxlH94' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-06-27T18:49:19.000Z' WHERE source_record_id = 'recOBJ66TT5kBtwnR' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-10T16:35:13.000Z' WHERE source_record_id = 'recWosOsXbfOrXgab' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-08-11T18:02:02.000Z' WHERE source_record_id = 'recQTWoilJmk8Nb3s' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-24T22:02:31.000Z' WHERE source_record_id = 'recNlX71Mj8OvFzJ9' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-10-07T16:10:45.000Z' WHERE source_record_id = 'recoZWOyrws30Veo0' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2025-12-19T23:28:55.000Z' WHERE source_record_id = 'recbuzsZGppgtqsO7' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';
UPDATE ops.requests SET resolved_at = '2026-01-05T22:31:36.000Z' WHERE source_record_id = 'recI532fOu4nOcFLq' AND source_system = 'airtable_ffsc' AND DATE(resolved_at) = '2026-01-15';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Completed Airtable requests still with import-date resolved_at (should be 0):'
SELECT COUNT(*) as remaining
FROM ops.requests
WHERE source_system = 'airtable_ffsc'
  AND status = 'completed'
  AND DATE(resolved_at) = '2026-01-15';

\echo ''
\echo 'Resolved date distribution:'
SELECT
  MIN(resolved_at)::date as earliest,
  MAX(resolved_at)::date as latest,
  COUNT(*) as total
FROM ops.requests
WHERE source_system = 'airtable_ffsc'
  AND status = 'completed';

\echo ''
\echo '=============================================='
\echo '  MIG_2826 Complete'
\echo '=============================================='
\echo ''
