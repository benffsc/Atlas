import { NextRequest } from "next/server";
import { queryRows, execute } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import {
  scrapePage,
  computeDiffs,
  type VerificationResult,
} from "@/lib/resource-scraper";

const CRON_SECRET = process.env.CRON_SECRET;

/** Rate limit between scrapes to be polite */
const SCRAPE_DELAY_MS = 2000;

interface ResourceRow {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  address: string | null;
  scrape_url: string;
  scrape_status: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET /api/cron/verify-resources
 *
 * Scrapes all community resources that have a scrape_url.
 * Extracts phone numbers and addresses from each page.
 * Compares against stored values and flags changes for staff review.
 *
 * Does NOT auto-update — only sets scrape_status and scrape_diff.
 *
 * FFS-1113
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  try {
    // Get all active resources with scrape URLs
    const resources = await queryRows<ResourceRow>(
      `SELECT id, slug, name, phone, address, scrape_url
       FROM ops.community_resources
       WHERE is_active = TRUE
         AND scrape_url IS NOT NULL
       ORDER BY display_order`,
    );

    if (resources.length === 0) {
      return apiSuccess({ message: "No resources to verify", results: [] });
    }

    const results: VerificationResult[] = [];
    let okCount = 0;
    let changedCount = 0;
    let errorCount = 0;

    for (const resource of resources) {
      // Scrape the page
      const scrapeResult = await scrapePage(resource.scrape_url);

      let status: VerificationResult["status"];
      let diffs: VerificationResult["diffs"] = [];

      if (!scrapeResult.success) {
        status = scrapeResult.error?.includes("timed out") ? "unreachable" : "error";
        errorCount++;
      } else {
        // Compare against stored data
        diffs = computeDiffs(
          { phone: resource.phone, address: resource.address },
          scrapeResult,
        );

        if (diffs.length > 0) {
          status = "changed";
          changedCount++;
        } else {
          status = "ok";
          okCount++;
        }
      }

      // Update the resource record
      await execute(
        `UPDATE ops.community_resources
         SET scrape_status = $1,
             scrape_diff = $2,
             scrape_phones_found = $3,
             scrape_error = $4,
             last_scraped_at = NOW(),
             updated_at = NOW()
         WHERE id = $5`,
        [
          status,
          diffs.length > 0 ? JSON.stringify(diffs) : null,
          scrapeResult.phones_found,
          scrapeResult.error || null,
          resource.id,
        ],
      );

      results.push({
        slug: resource.slug,
        scrape_result: scrapeResult,
        diffs,
        status,
      });

      // Rate limit
      await sleep(SCRAPE_DELAY_MS);
    }

    // Update verify_by for resources that passed
    await execute(
      `UPDATE ops.community_resources
       SET verify_by = NOW() + INTERVAL '90 days'
       WHERE scrape_status = 'ok'
         AND (verify_by IS NULL OR verify_by < NOW())`,
    );

    console.log(
      `[VERIFY-RESOURCES] Scraped ${resources.length} resources: ${okCount} ok, ${changedCount} changed, ${errorCount} errors`,
    );

    return apiSuccess({
      total: resources.length,
      ok: okCount,
      changed: changedCount,
      errors: errorCount,
      results: results.map((r) => ({
        slug: r.slug,
        status: r.status,
        diffs: r.diffs,
        phones_found: r.scrape_result.phones_found,
        error: r.scrape_result.error,
      })),
    });
  } catch (error) {
    console.error("[VERIFY-RESOURCES] Cron error:", error);
    return apiServerError("Resource verification failed");
  }
}

/** POST just calls GET (Vercel cron compatibility) */
export async function POST(request: NextRequest) {
  return GET(request);
}
