import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function main() {
  // Get 3 sample waivers from different dates
  const { rows } = await pool.query(`
    SELECT ws.waiver_id, ws.parsed_last_name, ws.parsed_last4_chip, ws.parsed_date::text,
      fu.file_content, fu.original_filename
    FROM ops.waiver_scans ws
    JOIN ops.file_uploads fu ON fu.upload_id = ws.file_upload_id
    WHERE ws.parsed_date IS NOT NULL AND ws.parsed_last4_chip IS NOT NULL
    ORDER BY ws.parsed_date DESC
    LIMIT 3
  `);

  for (const row of rows) {
    console.log(`\n=== ${row.original_filename} ===`);
    console.log(`Filename: last_name=${row.parsed_last_name}, chip=${row.parsed_last4_chip}, date=${row.parsed_date}`);

    const pdfBase64 = Buffer.from(row.file_content).toString("base64");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: `Extract ALL structured data from this veterinary clinic waiver form. Look for:
- The big clinic number (usually top-right, handwritten or stamped)
- ALL microchip numbers (PetLink stickers, handwritten, printed - could be multiple)
- Owner info, cat info, procedures, notes
- Any handwritten corrections or cross-outs

Return ONLY valid JSON:
{
  "clinic_number": <integer>,
  "date": "<date as written>",
  "owner_last_name": "<string>",
  "owner_first_name": "<string>",
  "cat_name": "<string>",
  "description": "<breed/color>",
  "sex": "<M or F>",
  "weight_lbs": <number>,
  "microchip_numbers": ["<all chip numbers visible>"],
  "microchip_last4": "<last 4 digits>",
  "spay_or_neuter": "<spay or neuter>",
  "ear_tip": "<left/right/both/none>",
  "vaccines": ["<list>"],
  "felv_fiv": "<positive/negative/not_tested>",
  "vet_initials": "<string>",
  "notes": "<any handwritten notes, corrections, or cross-outs>"
}` }
        ]
      }]
    });

    const text = response.content.find((c) => c.type === "text")?.text || "";
    console.log(text);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
