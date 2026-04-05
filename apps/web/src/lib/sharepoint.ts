/**
 * SharePoint / Microsoft Graph API Client
 *
 * Uses client credentials flow (app-only auth, no user login).
 * Provides folder listing and file download for SharePoint document libraries.
 *
 * Required env vars:
 *   MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_SECRET
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
 * Validate that all required env vars are set.
 */
export function validateSharePointConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.MICROSOFT_CLIENT_ID) missing.push("MICROSOFT_CLIENT_ID");
  if (!process.env.MICROSOFT_TENANT_ID) missing.push("MICROSOFT_TENANT_ID");
  if (!process.env.MICROSOFT_CLIENT_SECRET) missing.push("MICROSOFT_CLIENT_SECRET");
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

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId || !tenantId || !clientSecret) {
    throw new Error("Missing Microsoft credentials. Set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_SECRET.");
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
