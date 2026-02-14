/**
 * Microsoft Outlook Integration via Graph API
 *
 * Handles OAuth2 flow and email sending through connected Outlook accounts.
 * Supports multiple connected accounts (info@, ben@, tippy@, etc.)
 */

import { queryOne, queryRows, query } from "./db";

// Microsoft OAuth endpoints
const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com";
const GRAPH_API_URL = "https://graph.microsoft.com/v1.0";

// Environment variables
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const TENANT_ID = process.env.MICROSOFT_TENANT_ID;

// Scopes needed for sending email
const SCOPES = [
  "offline_access", // Required for refresh tokens
  "Mail.Send",      // Send mail as the user
  "User.Read",      // Get user profile (email, name)
].join(" ");

// ============================================================================
// Types
// ============================================================================

export interface OutlookAccount {
  account_id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  last_used_at: string | null;
  connection_error: string | null;
  token_expired: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}

export interface SendOutlookEmailParams {
  accountId: string;
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface SendOutlookEmailResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Configuration Check
// ============================================================================

export function isOutlookConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && TENANT_ID);
}

// ============================================================================
// OAuth Flow
// ============================================================================

/**
 * Generate the Microsoft OAuth authorization URL
 */
export function getAuthUrl(redirectUri: string, state?: string): string {
  if (!CLIENT_ID || !TENANT_ID) {
    throw new Error("Microsoft OAuth not configured");
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state: state || "",
    prompt: "consent", // Always show consent to get refresh token
  });

  return `${MICROSOFT_AUTH_URL}/${TENANT_ID}/oauth2/v2.0/authorize?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID) {
    throw new Error("Microsoft OAuth not configured");
  }

  const response = await fetch(
    `${MICROSOFT_AUTH_URL}/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPES,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || "Failed to exchange code for tokens");
  }

  return response.json();
}

/**
 * Refresh an access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID) {
    throw new Error("Microsoft OAuth not configured");
  }

  const response = await fetch(
    `${MICROSOFT_AUTH_URL}/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: SCOPES,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || "Failed to refresh token");
  }

  return response.json();
}

// ============================================================================
// Graph API Helpers
// ============================================================================

/**
 * Get user profile from Microsoft Graph
 */
export async function getGraphUser(accessToken: string): Promise<GraphUser> {
  const response = await fetch(`${GRAPH_API_URL}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to get user profile");
  }

  return response.json();
}

/**
 * Send email via Microsoft Graph
 */
async function sendViaGraph(
  accessToken: string,
  to: string,
  toName: string | undefined,
  subject: string,
  bodyHtml: string,
  bodyText?: string
): Promise<void> {
  const message = {
    message: {
      subject,
      body: {
        contentType: "HTML",
        content: bodyHtml,
      },
      toRecipients: [
        {
          emailAddress: {
            address: to,
            name: toName || to,
          },
        },
      ],
    },
    saveToSentItems: true,
  };

  const response = await fetch(`${GRAPH_API_URL}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to send email");
  }
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Save or update a connected Outlook account
 */
export async function saveOutlookAccount(
  email: string,
  displayName: string,
  microsoftUserId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  staffId: string
): Promise<string> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const result = await queryOne<{ account_id: string }>(`
    INSERT INTO ops.outlook_email_accounts (
      email, display_name, microsoft_user_id,
      access_token, refresh_token, token_expires_at,
      connected_by_staff_id, last_token_refresh_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (email) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      last_token_refresh_at = NOW(),
      is_active = TRUE,
      connection_error = NULL,
      updated_at = NOW()
    RETURNING account_id
  `, [email, displayName, microsoftUserId, accessToken, refreshToken, expiresAt, staffId]);

  return result!.account_id;
}

/**
 * Get all connected Outlook accounts
 */
export async function getConnectedAccounts(): Promise<OutlookAccount[]> {
  return queryRows<OutlookAccount>(`
    SELECT * FROM ops.v_connected_outlook_accounts
  `);
}

/**
 * Get a specific account by ID
 */
export async function getAccountById(accountId: string): Promise<{
  account_id: string;
  email: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: Date;
  is_active: boolean;
} | null> {
  return queryOne(`
    SELECT account_id, email, display_name, access_token, refresh_token, token_expires_at, is_active
    FROM ops.outlook_email_accounts
    WHERE account_id = $1 AND is_active = TRUE
  `, [accountId]);
}

/**
 * Update tokens after refresh
 */
async function updateTokens(
  accountId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await query(`
    UPDATE ops.outlook_email_accounts
    SET access_token = $2,
        refresh_token = $3,
        token_expires_at = $4,
        last_token_refresh_at = NOW(),
        connection_error = NULL,
        updated_at = NOW()
    WHERE account_id = $1
  `, [accountId, accessToken, refreshToken, expiresAt]);
}

/**
 * Mark account as having an error
 */
async function markAccountError(accountId: string, error: string): Promise<void> {
  await query(`
    UPDATE ops.outlook_email_accounts
    SET connection_error = $2, updated_at = NOW()
    WHERE account_id = $1
  `, [accountId, error]);
}

/**
 * Disconnect an account
 */
export async function disconnectAccount(accountId: string): Promise<void> {
  await query(`
    UPDATE ops.outlook_email_accounts
    SET is_active = FALSE, updated_at = NOW()
    WHERE account_id = $1
  `, [accountId]);
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Get a valid access token, refreshing if needed
 */
async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await getAccountById(accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  if (!account.is_active) {
    throw new Error("Account is disconnected");
  }

  // Check if token is expired or will expire in the next 5 minutes
  const expiresAt = new Date(account.token_expires_at);
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (expiresAt > fiveMinutesFromNow) {
    // Token is still valid
    return account.access_token;
  }

  // Token needs refresh
  try {
    const tokens = await refreshAccessToken(account.refresh_token);
    await updateTokens(
      accountId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in
    );
    return tokens.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    await markAccountError(accountId, message);
    throw new Error(`Failed to refresh token: ${message}`);
  }
}

/**
 * Send an email via a connected Outlook account
 */
export async function sendOutlookEmail(
  params: SendOutlookEmailParams
): Promise<SendOutlookEmailResult> {
  const { accountId, to, toName, subject, bodyHtml, bodyText } = params;

  try {
    // Get valid access token (refreshes if needed)
    const accessToken = await getValidAccessToken(accountId);

    // Send via Graph API
    await sendViaGraph(accessToken, to, toName, subject, bodyHtml, bodyText);

    // Update last used timestamp
    await query(`
      UPDATE ops.outlook_email_accounts
      SET last_used_at = NOW()
      WHERE account_id = $1
    `, [accountId]);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Outlook send error:", error);
    return { success: false, error: message };
  }
}

/**
 * Send a templated email via Outlook
 * Combines template system with Outlook sending
 */
export async function sendTemplatedOutlookEmail(params: {
  accountId: string;
  templateKey: string;
  to: string;
  toName?: string;
  placeholders?: Record<string, string>;
  submissionId?: string;
  personId?: string;
  sentBy?: string;
}): Promise<{ success: boolean; emailId?: string; error?: string }> {
  const { accountId, templateKey, to, toName, placeholders = {}, submissionId, personId, sentBy } = params;

  // Get template
  const template = await queryOne<{
    template_id: string;
    subject: string;
    body_html: string;
    body_text: string | null;
  }>(`
    SELECT template_id, subject, body_html, body_text
    FROM ops.email_templates
    WHERE template_key = $1 AND is_active = TRUE
  `, [templateKey]);

  if (!template) {
    return { success: false, error: `Template not found: ${templateKey}` };
  }

  // Replace placeholders
  let subject = template.subject;
  let bodyHtml = template.body_html;
  let bodyText = template.body_text;

  for (const [key, value] of Object.entries(placeholders)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    subject = subject.replace(regex, value || "");
    bodyHtml = bodyHtml.replace(regex, value || "");
    if (bodyText) {
      bodyText = bodyText.replace(regex, value || "");
    }
  }

  // Send via Outlook
  const result = await sendOutlookEmail({
    accountId,
    to,
    toName,
    subject,
    bodyHtml,
    bodyText: bodyText || undefined,
  });

  // Log the email
  const account = await getAccountById(accountId);
  const emailId = await logSentEmail({
    templateKey,
    to,
    toName,
    subject,
    bodyHtml,
    bodyText,
    success: result.success,
    error: result.error,
    outlookAccountId: accountId,
    fromEmail: account?.email,
    submissionId,
    personId,
    sentBy,
  });

  return {
    success: result.success,
    emailId,
    error: result.error,
  };
}

/**
 * Log sent email to database
 */
async function logSentEmail(params: {
  templateKey: string;
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  success: boolean;
  error?: string;
  outlookAccountId?: string;
  fromEmail?: string;
  submissionId?: string;
  personId?: string;
  sentBy?: string;
}): Promise<string | undefined> {
  try {
    const result = await queryOne<{ email_id: string }>(`
      INSERT INTO ops.sent_emails (
        template_key,
        recipient_email,
        recipient_name,
        subject_rendered,
        body_html_rendered,
        body_text_rendered,
        status,
        error_message,
        outlook_account_id,
        submission_id,
        person_id,
        sent_at,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        CASE WHEN $7 = 'sent' THEN NOW() ELSE NULL END,
        $12
      )
      RETURNING email_id
    `, [
      params.templateKey,
      params.to,
      params.toName || null,
      params.subject,
      params.bodyHtml,
      params.bodyText || null,
      params.success ? "sent" : "failed",
      params.error || null,
      params.outlookAccountId || null,
      params.submissionId || null,
      params.personId || null,
      params.sentBy || "system",
    ]);

    return result?.email_id;
  } catch (err) {
    console.error("Failed to log email:", err);
    return undefined;
  }
}
