/**
 * SharePoint / Microsoft Graph API Client
 *
 * Uses client credentials flow (app-only auth, no user login).
 * Provides folder listing and file download for SharePoint document libraries.
 *
 * Required env vars (in priority order):
 *   1. SHAREPOINT_CLIENT_ID / SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_SECRET
 *      — namespaced vars for the "Atlas - SharePoint Sync" app (Files.Read.All
 *        + Sites.Read.All Application permissions)
 *   2. MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_SECRET
 *      — legacy fallback. DO NOT use for new deployments. These vars are
 *        shared with lib/outlook.ts (user-delegated Mail.Send flow) which
 *        requires a DIFFERENT app registration ("Atlas Email Integration").
 *        Using the Outlook app credentials here causes 401 generalException
 *        on every Graph call because the Outlook app lacks application
 *        roles (only delegated scopes).
 *
 * 2026-04-07: namespaced the vars after discovering Vercel MICROSOFT_*
 * were pointing at the Email Integration app for 4 days, causing 0
 * successful waiver syncs. See microsoft-sharepoint-setup memory.
 *
 * Part of: FFS-1110 (SharePoint Waiver Sync)
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Token cache — client credentials tokens last 3600s, refresh at 3000s
let tokenCache: { token: string; expiresAt: number } | null = null;

export interface SharePointItem {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  childCount?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl?: string;
}

export interface SharePointFile {
  id: string;
  name: string;
  size: number;
  content: Buffer;
  lastModifiedDateTime: string;
}

/**
 * Resolve SharePoint credentials with namespaced-var priority and
 * legacy MICROSOFT_* fallback. Prefer namespaced to avoid collision
 * with lib/outlook.ts which uses the same MICROSOFT_* names for a
 * different app registration.
 */
function resolveCredentials() {
  return {
    clientId: process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID,
    tenantId: process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID,
    clientSecret: process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET,
  };
}

/**
 * Validate that all required env vars are set.
 */
export function validateSharePointConfig(): { valid: boolean; missing: string[] } {
  const creds = resolveCredentials();
  const missing: string[] = [];
  if (!creds.clientId) missing.push("SHAREPOINT_CLIENT_ID (or legacy MICROSOFT_CLIENT_ID)");
  if (!creds.tenantId) missing.push("SHAREPOINT_TENANT_ID (or legacy MICROSOFT_TENANT_ID)");
  if (!creds.clientSecret) missing.push("SHAREPOINT_CLIENT_SECRET (or legacy MICROSOFT_CLIENT_SECRET)");
  return { valid: missing.length === 0, missing };
}

/**
 * Get an access token using client credentials flow.
 * Caches the token until near expiry.
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const { clientId, tenantId, clientSecret } = resolveCredentials();

  if (!clientId || !tenantId || !clientSecret) {
    throw new Error(
      "Missing Microsoft credentials. Set SHAREPOINT_CLIENT_ID / SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_SECRET."
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return tokenCache.token;
}

/**
 * Make an authenticated Graph API request.
 */
async function graphFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API error (${response.status}) ${path}: ${text}`);
  }

  return response;
}

/**
 * List children of a folder in a drive.
 * Returns all items (handles pagination).
 */
export async function listFolderChildren(
  driveId: string,
  folderPath: string
): Promise<SharePointItem[]> {
  const items: SharePointItem[] = [];
  // URL-encode the folder path for the API
  const encodedPath = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  let url: string | null = `/drives/${driveId}/root:/${encodedPath}:/children?$top=200`;

  while (url) {
    const response = await graphFetch(url);
    const data = await response.json();

    for (const item of data.value || []) {
      items.push({
        id: item.id,
        name: item.name,
        size: item.size || 0,
        isFolder: "folder" in item,
        childCount: item.folder?.childCount,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
      });
    }

    url = data["@odata.nextLink"] || null;
  }

  return items;
}

/**
 * List children of a folder by its item ID.
 */
export async function listFolderChildrenById(
  driveId: string,
  itemId: string
): Promise<SharePointItem[]> {
  const items: SharePointItem[] = [];
  let url: string | null = `/drives/${driveId}/items/${itemId}/children?$top=200`;

  while (url) {
    const response = await graphFetch(url);
    const data = await response.json();

    for (const item of data.value || []) {
      items.push({
        id: item.id,
        name: item.name,
        size: item.size || 0,
        isFolder: "folder" in item,
        childCount: item.folder?.childCount,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
      });
    }

    url = data["@odata.nextLink"] || null;
  }

  return items;
}

/**
 * Download a file's content by its item ID.
 */
export async function downloadFile(
  driveId: string,
  itemId: string
): Promise<Buffer> {
  const response = await graphFetch(`/drives/${driveId}/items/${itemId}/content`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download a file with metadata.
 */
export async function downloadFileWithMetadata(
  driveId: string,
  itemId: string,
  name: string,
  lastModifiedDateTime: string
): Promise<SharePointFile> {
  const content = await downloadFile(driveId, itemId);
  return {
    id: itemId,
    name,
    size: content.length,
    content,
    lastModifiedDateTime,
  };
}

/**
 * Get metadata for a single item by path.
 */
export async function getItemByPath(
  driveId: string,
  itemPath: string
): Promise<SharePointItem> {
  const encodedPath = encodeURIComponent(itemPath).replace(/%2F/g, "/");
  const response = await graphFetch(`/drives/${driveId}/root:/${encodedPath}`);
  const item = await response.json();
  return {
    id: item.id,
    name: item.name,
    size: item.size || 0,
    isFolder: "folder" in item,
    childCount: item.folder?.childCount,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    webUrl: item.webUrl,
  };
}
