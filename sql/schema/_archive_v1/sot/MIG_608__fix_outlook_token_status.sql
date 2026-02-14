\echo '=== MIG_608: Fix Outlook Token Status Display ==='
\echo 'Access token expiration is normal - only show error when refresh fails'

-- The original view showed token_expired = TRUE when access token expires (every ~1 hour)
-- This is NORMAL - the system auto-refreshes using the refresh token when sending
-- Only show "needs reconnection" when there's an actual connection_error

-- Drop and recreate to allow column renaming
DROP VIEW IF EXISTS trapper.v_connected_outlook_accounts;

CREATE VIEW trapper.v_connected_outlook_accounts AS
SELECT
  oa.account_id,
  oa.email,
  oa.display_name,
  oa.is_active,
  oa.last_used_at,
  oa.connection_error,
  oa.created_at,
  s.display_name AS connected_by,
  -- Only flag as problem if refresh actually failed (has connection_error)
  -- Access token expiration alone is not a problem - system will auto-refresh
  CASE
    WHEN oa.connection_error IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS needs_reconnection,
  -- Keep token_expired for debugging but don't use for status
  oa.token_expires_at < NOW() AS token_expired,
  oa.token_expires_at,
  oa.last_token_refresh_at,
  COUNT(se.email_id) AS emails_sent
FROM trapper.outlook_email_accounts oa
LEFT JOIN trapper.staff s ON s.staff_id = oa.connected_by_staff_id
LEFT JOIN trapper.sent_emails se ON se.outlook_account_id = oa.account_id
WHERE oa.is_active = TRUE
GROUP BY oa.account_id, s.display_name
ORDER BY oa.email;

COMMENT ON VIEW trapper.v_connected_outlook_accounts IS
  'Active Outlook accounts connected for email sending. needs_reconnection indicates actual problems (refresh failed), not normal access token expiration.';

\echo 'MIG_608 complete: Token status display fixed'
