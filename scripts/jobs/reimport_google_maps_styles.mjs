#!/usr/bin/env node
/**
 * Re-import Google Maps Icon Styles
 *
 * This script fetches the FFSC Google Maps KML and extracts icon style
 * information to update existing google_map_entries with their original
 * icon types and colors.
 *
 * Icon meanings (per FFSC conventions):
 *   - Black dots (icon-503-000000): Difficult clients, watch list
 *   - Stars (icon-959-*): Volunteers
 *   - Orange diamonds (icon-961-F8971B): FeLV colonies
 *   - Yellow squares (icon-960-*): Disease indicators
 *   - Lime green (icon-503-CDDC39): Relocation clients
 *   - Red (icon-503-DB4436): High priority
 *   - Green (icon-503-009D57): Standard entries
 *
 * Usage:
 *   export $(grep -v '^#' .env | xargs)
 *   node scripts/jobs/reimport_google_maps_styles.mjs [--sync]
 *
 * Options:
 *   --sync   Full sync mode: update all entries, add new ones
 */

import pg from "pg";
import https from "https";
import http from "http";
import { createWriteStream } from "fs";
import { execSync } from "child_process";
import { parseStringPromise } from "xml2js";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// Google Maps KML URL - the direct KML export URL
const KML_URL =
  "https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=11ASW62IbxeTgnXmBTKIr5pyrDAc";

// Command line options
const SYNC_MODE = process.argv.includes("--sync");
const FILE_ARG_INDEX = process.argv.indexOf("--file");
const LOCAL_FILE = FILE_ARG_INDEX !== -1 ? process.argv[FILE_ARG_INDEX + 1] : null;

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        fetchUrl(response.headers.location).then(resolve).catch(reject);
        return;
      }

      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => resolve(data));
      response.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadKMZ(url, destPath) {
  console.log("Downloading KMZ from Google Maps...");
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        downloadKMZ(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      const file = createWriteStream(destPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", reject);
    }).on("error", reject);
  });
}

async function extractKMZ(kmzPath, extractDir) {
  console.log("Extracting KMZ...");
  execSync(`rm -rf ${extractDir} && mkdir -p ${extractDir}`);
  execSync(`cd ${extractDir} && unzip -o ${kmzPath}`);
  return `${extractDir}/doc.kml`;
}

async function fetchKMLWithNetworkLinks(kmlContent, depth = 0) {
  if (depth > 3) {
    console.warn("Max NetworkLink depth reached");
    return kmlContent;
  }

  const result = await parseStringPromise(kmlContent);

  // Check for NetworkLink
  async function processNode(node) {
    if (!node) return;

    // If this node has NetworkLink, fetch and merge
    if (node.NetworkLink) {
      const links = Array.isArray(node.NetworkLink) ? node.NetworkLink : [node.NetworkLink];
      for (const link of links) {
        const href = link.Link?.[0]?.href?.[0];
        if (href) {
          console.log(`Following NetworkLink: ${href.substring(0, 80)}...`);
          try {
            const linkedContent = await fetchUrl(href);
            // Return the linked content instead
            return await fetchKMLWithNetworkLinks(linkedContent, depth + 1);
          } catch (e) {
            console.error(`Failed to fetch NetworkLink: ${e.message}`);
          }
        }
      }
    }

    // Process Document
    if (node.Document) {
      for (const doc of Array.isArray(node.Document) ? node.Document : [node.Document]) {
        const result = await processNode(doc);
        if (result) return result;
      }
    }

    return null;
  }

  const linkedContent = await processNode(result.kml);
  return linkedContent || kmlContent;
}

function parseStyleId(styleUrl) {
  // styleUrl looks like "#icon-503-009D57" or "#icon-961-F8971B"
  if (!styleUrl) return { iconType: null, iconColor: null, styleId: null };

  const match = styleUrl.match(/#?(icon-\d+)-([A-F0-9]+)/i);
  if (match) {
    return {
      iconType: match[1].toLowerCase(),
      iconColor: match[2].toUpperCase(),
      styleId: `${match[1].toLowerCase()}-${match[2].toUpperCase()}`,
    };
  }
  return { iconType: null, iconColor: null, styleId: styleUrl };
}

async function parseKMLContent(kmlContent) {
  console.log("Parsing KML content...");
  const result = await parseStringPromise(kmlContent);

  const placemarks = [];

  function extractPlacemarks(node, folderName = "") {
    if (!node) return;

    // Handle Folder
    if (node.Folder) {
      for (const folder of Array.isArray(node.Folder) ? node.Folder : [node.Folder]) {
        const name = folder.name?.[0] || "";
        extractPlacemarks(folder, name);
      }
    }

    // Handle Placemark
    if (node.Placemark) {
      for (const pm of Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark]) {
        const name = pm.name?.[0] || "";
        const description = pm.description?.[0] || "";
        const styleUrl = pm.styleUrl?.[0] || "";
        const coords = pm.Point?.coordinates?.[0] || "";

        const [lng, lat] = coords.split(",").map((s) => parseFloat(s.trim()));

        if (lat && lng) {
          const { iconType, iconColor, styleId } = parseStyleId(styleUrl);
          placemarks.push({
            name,
            description,
            lat,
            lng,
            iconType,
            iconColor,
            styleId,
            folderName,
          });
        }
      }
    }

    // Handle Document
    if (node.Document) {
      for (const doc of Array.isArray(node.Document) ? node.Document : [node.Document]) {
        extractPlacemarks(doc, folderName);
      }
    }
  }

  extractPlacemarks(result.kml);

  console.log(`Found ${placemarks.length} placemarks with coordinates`);
  return placemarks;
}

async function parseKML(kmlPath) {
  const kmlContent = readFileSync(kmlPath, "utf-8");

  // Check for and follow NetworkLinks
  const resolvedContent = await fetchKMLWithNetworkLinks(kmlContent);

  return parseKMLContent(resolvedContent);
}

async function updateEntries(placemarks) {
  console.log(`Updating database entries with icon styles... (sync mode: ${SYNC_MODE})`);

  let updated = 0;
  let inserted = 0;
  let notFound = 0;
  const iconStats = {};

  for (const pm of placemarks) {
    // Track icon stats
    const key = `${pm.iconType}-${pm.iconColor}`;
    iconStats[key] = (iconStats[key] || 0) + 1;

    if (SYNC_MODE) {
      // Sync mode: upsert - update if exists, insert if new
      const updateResult = await pool.query(
        `UPDATE ops.google_map_entries
         SET
           icon_type = $1,
           icon_color = $2,
           icon_style_id = $3,
           kml_folder = COALESCE($4, kml_folder),
           kml_name = COALESCE($5, kml_name),
           original_content = COALESCE($6, original_content),
           synced_at = NOW()
         WHERE
           ROUND(lat::numeric, 5) = ROUND($7::numeric, 5)
           AND ROUND(lng::numeric, 5) = ROUND($8::numeric, 5)
         RETURNING entry_id`,
        [pm.iconType, pm.iconColor, pm.styleId, pm.folderName, pm.name, pm.description, pm.lat, pm.lng]
      );

      if (updateResult.rowCount > 0) {
        updated += updateResult.rowCount;
      } else {
        // Insert new entry
        try {
          await pool.query(
            `INSERT INTO ops.google_map_entries
             (kml_name, original_content, lat, lng, icon_type, icon_color, icon_style_id, kml_folder, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [pm.name, pm.description, pm.lat, pm.lng, pm.iconType, pm.iconColor, pm.styleId, pm.folderName]
          );
          inserted++;
        } catch (e) {
          // Entry might exist with slightly different coordinates
          notFound++;
        }
      }
    } else {
      // Initial import mode: only update entries missing icon data
      const result = await pool.query(
        `UPDATE ops.google_map_entries
         SET
           icon_type = $1,
           icon_color = $2,
           icon_style_id = $3,
           kml_folder = COALESCE(kml_folder, $4)
         WHERE
           ROUND(lat::numeric, 5) = ROUND($5::numeric, 5)
           AND ROUND(lng::numeric, 5) = ROUND($6::numeric, 5)
           AND icon_type IS NULL
         RETURNING entry_id`,
        [pm.iconType, pm.iconColor, pm.styleId, pm.folderName, pm.lat, pm.lng]
      );

      if (result.rowCount > 0) {
        updated += result.rowCount;
      } else {
        notFound++;
      }
    }
  }

  console.log("\nIcon Style Distribution:");
  const sortedStats = Object.entries(iconStats).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedStats.slice(0, 15)) {
    console.log(`  ${key}: ${count}`);
  }

  console.log(`\nUpdated: ${updated} entries`);
  if (SYNC_MODE) {
    console.log(`Inserted: ${inserted} new entries`);
  }
  console.log(`Not matched: ${notFound} (may already have icon data or coordinates differ)`);

  return { updated, inserted, notFound };
}

async function deriveIconMeanings() {
  console.log("\nDeriving icon meanings...");

  const result = await pool.query(`
    UPDATE ops.google_map_entries
    SET icon_meaning = ops.derive_icon_meaning(icon_type, icon_color)
    WHERE icon_type IS NOT NULL AND icon_meaning IS NULL
    RETURNING entry_id
  `);

  console.log(`Derived meanings for ${result.rowCount} entries`);
  return result.rowCount;
}

async function showSummary() {
  const summary = await pool.query(`
    SELECT
      icon_meaning,
      COUNT(*) as count
    FROM ops.google_map_entries
    WHERE icon_meaning IS NOT NULL
    GROUP BY icon_meaning
    ORDER BY count DESC
  `);

  console.log("\nIcon Meaning Summary:");
  for (const row of summary.rows) {
    console.log(`  ${row.icon_meaning}: ${row.count}`);
  }

  const withIcons = await pool.query(`
    SELECT COUNT(*) as count
    FROM ops.google_map_entries
    WHERE icon_type IS NOT NULL
  `);

  const total = await pool.query(`
    SELECT COUNT(*) as count
    FROM ops.google_map_entries
  `);

  console.log(`\nTotal entries with icon data: ${withIcons.rows[0].count} / ${total.rows[0].count}`);
}

async function main() {
  console.log(`\n=== Google Maps Icon Style ${SYNC_MODE ? "Sync" : "Import"} ===\n`);

  try {
    let kmlContent;

    // Option 1: Load from local file
    if (LOCAL_FILE) {
      console.log(`Loading from local file: ${LOCAL_FILE}`);

      if (!existsSync(LOCAL_FILE)) {
        console.error(`File not found: ${LOCAL_FILE}`);
        process.exit(1);
      }

      if (LOCAL_FILE.endsWith(".kmz")) {
        const tmpDir = "/tmp/google_maps_reimport";
        const extractDir = `${tmpDir}/extract`;
        execSync(`mkdir -p ${tmpDir}`);
        execSync(`rm -rf ${extractDir} && mkdir -p ${extractDir}`);
        execSync(`cd ${extractDir} && unzip -o "${LOCAL_FILE}"`);
        kmlContent = readFileSync(`${extractDir}/doc.kml`, "utf-8");
        execSync(`rm -rf ${tmpDir}`);
      } else {
        kmlContent = readFileSync(LOCAL_FILE, "utf-8");
      }
    } else {
      // Option 2: Try direct KML fetch first (faster and handles NetworkLinks)
      console.log("Fetching KML from Google Maps...");

      try {
        kmlContent = await fetchUrl(KML_URL);
        // Check if we got valid KML
        if (!kmlContent.includes("<kml") && !kmlContent.includes("<Placemark")) {
          throw new Error("Invalid KML response");
        }
      } catch (e) {
        console.log(`Direct fetch failed: ${e.message}`);
        console.log("Trying KMZ download...");

        const tmpDir = "/tmp/google_maps_reimport";
        const kmzPath = `${tmpDir}/ffsc.kmz`;
        const extractDir = `${tmpDir}/extract`;

        execSync(`mkdir -p ${tmpDir}`);

        // Use the original KMZ URL
        const kmzUrl = "https://www.google.com/maps/d/u/0/kml?mid=11ASW62IbxeTgnXmBTKIr5pyrDAc&lid=zvIbq0p2i2IA.k1sU_DlUhk7s";
        await downloadKMZ(kmzUrl, kmzPath);
        const kmlPath = await extractKMZ(kmzPath, extractDir);
        kmlContent = readFileSync(kmlPath, "utf-8");

        execSync(`rm -rf ${tmpDir}`);
      }
    }

    // Resolve any NetworkLinks
    const resolvedContent = await fetchKMLWithNetworkLinks(kmlContent);

    // Parse placemarks
    const placemarks = await parseKMLContent(resolvedContent);

    if (placemarks.length === 0) {
      console.log("\nNo placemarks found. The KML may require authentication or the URL may have changed.");
      console.log("Try downloading the KMZ file manually and running:");
      console.log("  node scripts/jobs/reimport_google_maps_styles.mjs --file /path/to/file.kmz");
      process.exit(1);
    }

    // Update database
    await updateEntries(placemarks);
    await deriveIconMeanings();
    await showSummary();

    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
