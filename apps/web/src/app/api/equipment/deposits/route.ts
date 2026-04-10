import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";

/**
 * GET /api/equipment/deposits
 *
 * Returns all outstanding equipment deposits (items checked out with a
 * deposit_amount > 0 that hasn't been returned yet) plus summary stats.
 *
 * FFS-1204 (Layer 1.3 of the Equipment Overhaul epic FFS-1201).
 */

interface DepositRow {
  equipment_id: string;
  barcode: string | null;
  equipment_name: string;
  type_name: string;
  equipment_category: string;
  deposit_amount: number;
  custodian_person_id: string | null;
  custodian_name: string | null;
  custodian_phone: string | null;
  custodian_email: string | null;
  checked_out_at: string;
  due_date: string | null;
  checkout_purpose: string | null;
  days_out: number;
  is_overdue: boolean;
  days_overdue: number;
}

interface DepositSummary {
  total_deposits_outstanding: number;
  total_amount_outstanding: number;
  overdue_deposits: number;
  overdue_amount: number;
  avg_days_out: number;
  max_days_out: number;
}

export const GET = withErrorHandling(async () => {
  const [deposits, summary] = await Promise.all([
    queryRows<DepositRow>(
      `SELECT
        equipment_id::text,
        barcode,
        equipment_name,
        type_name,
        equipment_category,
        deposit_amount::numeric,
        custodian_person_id::text,
        custodian_name,
        custodian_phone,
        custodian_email,
        checked_out_at::text,
        due_date::text,
        checkout_purpose,
        days_out,
        is_overdue,
        days_overdue
      FROM ops.v_equipment_deposits_outstanding
      LIMIT 200`,
    ),
    queryOne<DepositSummary>(
      `SELECT
        total_deposits_outstanding::int,
        total_amount_outstanding::numeric,
        overdue_deposits::int,
        overdue_amount::numeric,
        avg_days_out::int,
        max_days_out::int
      FROM ops.v_equipment_deposit_summary`,
    ),
  ]);

  return apiSuccess({
    deposits,
    summary: summary || {
      total_deposits_outstanding: 0,
      total_amount_outstanding: 0,
      overdue_deposits: 0,
      overdue_amount: 0,
      avg_days_out: 0,
      max_days_out: 0,
    },
  });
});
