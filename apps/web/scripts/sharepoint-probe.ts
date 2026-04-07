#!/usr/bin/env npx tsx
/**
 * SharePoint / Graph API probe — diagnose FFS-1110 401 errors
 *
 * Usage:
 *   cd apps/web
 *   npx dotenv -e .env.production.local -- npx tsx scripts/sharepoint-probe.ts
 */
export {}; // module mode — avoid script-scope collision with sibling script files

const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || process.env.MICROSOFT_TENANT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;
const WAIVER_PATH = process.env.SHAREPOINT_WAIVER_PATH || "Spay Neuter Clinics/Clinic HQ Waivers";

if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET || !DRIVE_ID) {
  console.error("Missing required env vars");
  console.error({
    CLIENT_ID: !!CLIENT_ID,
    TENANT_ID: !!TENANT_ID,
    CLIENT_SECRET: !!CLIENT_SECRET,
    DRIVE_ID: !!DRIVE_ID,
  });
  process.exit(1);
}

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
  if (!res.ok) {
    throw new Error(`Token fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  return data.access_token;
}

async function probe(path: string, token: string, label: string) {
  console.log(`\n── ${label} ──`);
  console.log(`  ${path}`);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log(`  status: ${res.status}`);
  if (res.ok) {
    try {
      const j = JSON.parse(text);
      if (j.value) {
        console.log(`  results: ${j.value.length} items`);
        j.value.slice(0, 5).forEach((item: { name: string; folder?: unknown }) => {
          console.log(`    - ${item.name}${item.folder ? "/" : ""}`);
        });
      } else {
        console.log(`  body: ${JSON.stringify(j, null, 2).slice(0, 400)}`);
      }
    } catch {
      console.log(`  body: ${text.slice(0, 400)}`);
    }
  } else {
    console.log(`  ERROR body: ${text.slice(0, 600)}`);
  }
}

async function main() {
  console.log("SharePoint/Graph Probe");
  console.log("======================");
  console.log(`CLIENT_ID: ${CLIENT_ID!.slice(0, 8)}...`);
  console.log(`TENANT_ID: ${TENANT_ID!.slice(0, 8)}...`);
  console.log(`DRIVE_ID:  ${DRIVE_ID!.slice(0, 30)}...`);
  console.log(`WAIVER_PATH: ${WAIVER_PATH}`);

  console.log("\n[1] Acquiring app-only token...");
  const token = await getToken();
  console.log(`    token length: ${token.length}`);

  // Probe 1: Can we read the drive metadata at all?
  await probe(`/drives/${DRIVE_ID}`, token, "1. Drive metadata");

  // Probe 2: Can we list drive root?
  await probe(`/drives/${DRIVE_ID}/root/children?$top=20`, token, "2. Drive root children");

  // Probe 3: List "Spay Neuter Clinics" (trailing s)
  await probe(
    `/drives/${DRIVE_ID}/root:/Spay Neuter Clinics:/children?$top=20`,
    token,
    "3. Spay Neuter Clinics folder"
  );

  // Probe 4: List Clinic HQ Waivers
  await probe(
    `/drives/${DRIVE_ID}/root:/Spay Neuter Clinics/Clinic HQ Waivers:/children?$top=20`,
    token,
    "4. Clinic HQ Waivers folder"
  );

  // Probe 5: List 2026 Waivers
  await probe(
    `/drives/${DRIVE_ID}/root:/Spay Neuter Clinics/Clinic HQ Waivers/2026 Waivers:/children?$top=20`,
    token,
    "5. 2026 Waivers folder"
  );

  // Probe 6: List April 2026 (the folder the cron was trying to hit)
  await probe(
    `/drives/${DRIVE_ID}/root:/Spay Neuter Clinics/Clinic HQ Waivers/2026 Waivers/April 2026:/children?$top=20`,
    token,
    "6. April 2026 folder (cron target)"
  );

  // Probe 7: Alternate — maybe "Spay Neuter Clinic" (no trailing s)?
  await probe(
    `/drives/${DRIVE_ID}/root:/Spay Neuter Clinic:/children?$top=20`,
    token,
    "7. Alternate: 'Spay Neuter Clinic' (no s)"
  );
}

main().catch((err) => {
  console.error("\nCRASH:");
  console.error(err);
  process.exit(1);
});
