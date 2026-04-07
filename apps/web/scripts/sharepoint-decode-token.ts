#!/usr/bin/env npx tsx
/**
 * Decode the app-only JWT to see what roles/app the token carries.
 * Diagnoses why Graph API returns 401 on every call.
 */
export {}; // module mode — avoid script-scope collision with sibling script files

const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;

async function getToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
}

async function main() {
  console.log("CLIENT_ID from env:  ", CLIENT_ID);
  console.log("TENANT_ID from env:  ", TENANT_ID);
  console.log("");

  const token = await getToken();
  const claims = decodeJwt(token);

  console.log("Token claims:");
  console.log("  aud (audience):  ", claims.aud);
  console.log("  iss (issuer):    ", claims.iss);
  console.log("  appid:           ", claims.appid);
  console.log("  app_displayname: ", claims.app_displayname);
  console.log("  tid (tenant):    ", claims.tid);
  console.log("  roles:           ", claims.roles);
  console.log("  scp (scopes):    ", claims.scp);
  console.log("  idtyp:           ", claims.idtyp);
  console.log("  exp:             ", new Date((claims.exp as number) * 1000).toISOString());
  console.log("");

  if (CLIENT_ID !== claims.appid) {
    console.log("⚠ CLIENT_ID env var does NOT match token appid claim");
  }

  if (!claims.roles || (Array.isArray(claims.roles) && claims.roles.length === 0)) {
    console.log("⚠ Token has NO application roles — this is why Graph returns 401.");
    console.log("  Fix: grant Files.Read.All + Sites.Read.All Application permissions");
    console.log("  to this app registration in Entra, THEN click 'Grant admin consent'.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
