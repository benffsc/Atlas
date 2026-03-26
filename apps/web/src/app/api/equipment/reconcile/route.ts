import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling, ApiError } from "@/lib/api-validation";
import type { VEquipmentInventoryRow, EquipmentReconcileResult, EquipmentReconcileSummary } from "@/lib/types/view-contracts";
import { NextRequest } from "next/server";

/**
 * POST /api/equipment/reconcile
 *
 * Compares scanned barcodes against inventory to produce a reconciliation report.
 * Used by the restock/inventory page for physical inventory checks.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();
  const scannedBarcodes: string[] = body.scanned_barcodes;

  if (!Array.isArray(scannedBarcodes) || scannedBarcodes.length === 0) {
    throw new ApiError("scanned_barcodes must be a non-empty array", 400);
  }

  // Normalize scanned barcodes (trim, lowercase for comparison)
  const scannedSet = new Set(scannedBarcodes.map((b: string) => b.trim()));

  // Fetch all non-retired equipment
  const allEquipment = await queryRows<VEquipmentInventoryRow>(
    `SELECT * FROM ops.v_equipment_inventory ORDER BY display_name`
  );

  // Build barcode → equipment lookup
  const barcodeMap = new Map<string, VEquipmentInventoryRow>();
  for (const item of allEquipment) {
    if (item.barcode) {
      barcodeMap.set(item.barcode, item);
    }
  }

  // Classify each equipment item
  const results: EquipmentReconcileResult[] = [];
  const matchedBarcodes = new Set<string>();

  for (const item of allEquipment) {
    const wasScanned = item.barcode ? scannedSet.has(item.barcode) : false;
    if (wasScanned && item.barcode) {
      matchedBarcodes.add(item.barcode);
    }

    let scanStatus: string;
    let suggestedAction: string | null = null;

    if (wasScanned) {
      switch (item.custody_status) {
        case "available":
          scanStatus = "confirmed";
          break;
        case "checked_out":
        case "in_field":
          scanStatus = "found_here";
          suggestedAction = "check_in";
          break;
        case "missing":
          scanStatus = "found";
          suggestedAction = "mark_found";
          break;
        default:
          scanStatus = "confirmed";
      }
    } else {
      switch (item.custody_status) {
        case "available":
          scanStatus = "possibly_missing";
          suggestedAction = "mark_missing";
          break;
        case "checked_out":
        case "in_field":
          scanStatus = "expected_out";
          break;
        case "missing":
          scanStatus = "still_missing";
          break;
        default:
          scanStatus = "expected_out";
      }
    }

    results.push({
      ...item,
      was_scanned: wasScanned,
      scan_status: scanStatus,
      suggested_action: suggestedAction,
    });
  }

  // Find unknown barcodes (scanned but not in system)
  const unknownBarcodes = Array.from(scannedSet).filter((b) => !matchedBarcodes.has(b));

  // Build summary
  const summary: EquipmentReconcileSummary = {
    total_equipment: allEquipment.length,
    total_scanned: scannedSet.size,
    confirmed: results.filter((r) => r.scan_status === "confirmed").length,
    found_here: results.filter((r) => r.scan_status === "found_here").length,
    found: results.filter((r) => r.scan_status === "found").length,
    possibly_missing: results.filter((r) => r.scan_status === "possibly_missing").length,
    expected_out: results.filter((r) => r.scan_status === "expected_out").length,
    still_missing: results.filter((r) => r.scan_status === "still_missing").length,
    unknown_barcodes: unknownBarcodes,
  };

  return apiSuccess({ results, summary });
});
