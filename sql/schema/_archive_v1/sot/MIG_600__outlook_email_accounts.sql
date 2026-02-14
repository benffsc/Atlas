\echo '=== MIG_600: Outlook Email Accounts ==='
\echo 'Creates infrastructure for Microsoft Outlook OAuth integration'

-- Connected Outlook accounts for sending emails
CREATE TABLE IF NOT EXISTS trapper.outlook_email_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Microsoft account info
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  microsoft_user_id TEXT,  -- Microsoft's user object ID

  -- OAuth tokens (encrypted at rest by Supabase)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,

  -- Who connected this account
  connected_by_staff_id UUID REFERENCES trapper.staff(staff_id),

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  last_token_refresh_at TIMESTAMPTZ,
  connection_error TEXT,  -- Last error if token refresh failed

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by email
CREATE INDEX IF NOT EXISTS idx_outlook_accounts_email
  ON trapper.outlook_email_accounts(email) WHERE is_active = TRUE;

-- Comments
COMMENT ON TABLE trapper.outlook_email_accounts IS
  'Connected Microsoft Outlook accounts for sending emails via Graph API. Tokens are encrypted at rest.';
COMMENT ON COLUMN trapper.outlook_email_accounts.access_token IS
  'Short-lived access token for Microsoft Graph API';
COMMENT ON COLUMN trapper.outlook_email_accounts.refresh_token IS
  'Long-lived refresh token to get new access tokens';

-- Track sent emails with which account was used
ALTER TABLE trapper.sent_emails
  ADD COLUMN IF NOT EXISTS outlook_account_id UUID REFERENCES trapper.outlook_email_accounts(account_id);

-- Add index for tracking which account sent which emails
CREATE INDEX IF NOT EXISTS idx_sent_emails_outlook_account
  ON trapper.sent_emails(outlook_account_id) WHERE outlook_account_id IS NOT NULL;

-- View for active connected accounts
CREATE OR REPLACE VIEW trapper.v_connected_outlook_accounts AS
SELECT
  oa.account_id,
  oa.email,
  oa.display_name,
  oa.is_active,
  oa.last_used_at,
  oa.connection_error,
  oa.created_at,
  s.display_name AS connected_by,
  oa.token_expires_at < NOW() AS token_expired,
  COUNT(se.email_id) AS emails_sent
FROM trapper.outlook_email_accounts oa
LEFT JOIN trapper.staff s ON s.staff_id = oa.connected_by_staff_id
LEFT JOIN trapper.sent_emails se ON se.outlook_account_id = oa.account_id
WHERE oa.is_active = TRUE
GROUP BY oa.account_id, s.display_name
ORDER BY oa.email;

COMMENT ON VIEW trapper.v_connected_outlook_accounts IS
  'Active Outlook accounts connected for email sending';

\echo 'MIG_600 complete: Outlook email accounts table created'
