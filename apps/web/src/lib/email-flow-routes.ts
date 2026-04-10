/**
 * Maps email flow slugs to their API route pairs.
 *
 * Each flow keeps its own send/preview routes (different rendering logic),
 * but the suggestion system needs to know which routes to call for each flow.
 *
 * To add a new email flow:
 * 1. INSERT into ops.email_flows (MIG_3066)
 * 2. INSERT into ops.email_action_rules (MIG_3078)
 * 3. Create API routes for preview + send
 * 4. Add mapping here
 */

export interface EmailFlowRoutes {
  preview: string;
  send: string;
}

const FLOW_ROUTE_MAP: Record<string, EmailFlowRoutes> = {
  out_of_service_area: {
    preview: "/api/emails/preview-out-of-service-area",
    send: "/api/emails/send-out-of-service-area",
  },
};

/**
 * Get API routes for a given flow slug.
 * Returns null if the flow has no configured routes.
 */
export function getFlowRoutes(flowSlug: string): EmailFlowRoutes | null {
  return FLOW_ROUTE_MAP[flowSlug] ?? null;
}
