import { withErrorHandling } from "@/lib/api-validation";
import { apiSuccess } from "@/lib/api-response";
import { loadSoftBlacklist } from "@/lib/soft-blacklist";

/**
 * GET /api/config/soft-blacklist
 *
 * Returns the current soft blacklist (emails + phones) from the database.
 * Client-side consumers use this to keep shouldBePerson() in sync with DB.
 *
 * @see FFS-686
 */
export const GET = withErrorHandling(async () => {
  const blacklist = await loadSoftBlacklist();
  return apiSuccess(blacklist);
});
