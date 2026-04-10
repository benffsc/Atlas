/**
 * useEmailSuggestions — evaluates email action rules against a submission.
 *
 * Fetches all enabled rules once (cached), evaluates conditions client-side,
 * returns sorted suggestions. Guard conditions check submission's email
 * presence and sent-at fields.
 *
 * @see MIG_3078 for the email_action_rules table
 */

import { useState, useEffect, useRef } from "react";
import { fetchApi } from "@/lib/api-client";
import type { IntakeSubmission } from "@/lib/intake-types";
import { getFlowRoutes, type EmailFlowRoutes } from "@/lib/email-flow-routes";

export interface EmailActionRule {
  rule_id: string;
  flow_slug: string;
  display_name: string;
  description: string | null;
  condition_field: string;
  condition_operator: "eq" | "neq" | "in" | "is_null" | "is_not_null";
  condition_value: string | null;
  guard_email_not_sent: boolean;
  guard_not_suppressed: boolean;
  guard_has_email: boolean;
  suggestion_text: string;
  action_label: string;
  priority: number;
  enabled: boolean;
}

export interface EmailSuggestion {
  rule: EmailActionRule;
  routes: EmailFlowRoutes;
}

// Module-level cache so multiple components share the same fetch
let rulesCache: EmailActionRule[] | null = null;
let rulesFetchPromise: Promise<EmailActionRule[]> | null = null;

async function fetchRules(): Promise<EmailActionRule[]> {
  if (rulesCache) return rulesCache;
  if (rulesFetchPromise) return rulesFetchPromise;

  rulesFetchPromise = fetchApi<EmailActionRule[]>("/api/admin/email-action-rules")
    .then((data) => {
      rulesCache = data;
      return data;
    })
    .catch(() => {
      rulesFetchPromise = null;
      return [] as EmailActionRule[];
    });

  return rulesFetchPromise;
}

/** Invalidate the cached rules (call after admin edits) */
export function invalidateEmailRulesCache() {
  rulesCache = null;
  rulesFetchPromise = null;
}

function evaluateCondition(
  rule: EmailActionRule,
  submission: IntakeSubmission
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldValue = (submission as any)[rule.condition_field];

  switch (rule.condition_operator) {
    case "eq":
      return String(fieldValue ?? "") === (rule.condition_value ?? "");
    case "neq":
      return String(fieldValue ?? "") !== (rule.condition_value ?? "");
    case "in": {
      const values = (rule.condition_value ?? "").split(",").map((v) => v.trim());
      return values.includes(String(fieldValue ?? ""));
    }
    case "is_null":
      return fieldValue == null || fieldValue === "";
    case "is_not_null":
      return fieldValue != null && fieldValue !== "";
    default:
      return false;
  }
}

function checkGuards(
  rule: EmailActionRule,
  submission: IntakeSubmission,
  isSuppressed: boolean
): boolean {
  if (rule.guard_has_email && !submission.email) return false;
  if (rule.guard_email_not_sent && submission.out_of_service_area_email_sent_at) return false;
  if (rule.guard_not_suppressed && isSuppressed) return false;
  return true;
}

export function useEmailSuggestions(
  submission: IntakeSubmission | null,
  isSuppressed: boolean = false
): { suggestions: EmailSuggestion[]; loading: boolean } {
  const [rules, setRules] = useState<EmailActionRule[]>(rulesCache ?? []);
  const [loading, setLoading] = useState(!rulesCache);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!rulesCache) {
      fetchRules().then((r) => {
        if (mounted.current) {
          setRules(r);
          setLoading(false);
        }
      });
    }
    return () => { mounted.current = false; };
  }, []);

  if (!submission) return { suggestions: [], loading };

  const suggestions: EmailSuggestion[] = rules
    .filter((rule) => {
      if (!evaluateCondition(rule, submission)) return false;
      if (!checkGuards(rule, submission, isSuppressed)) return false;
      const routes = getFlowRoutes(rule.flow_slug);
      return routes !== null;
    })
    .map((rule) => ({
      rule,
      routes: getFlowRoutes(rule.flow_slug)!,
    }))
    .sort((a, b) => b.rule.priority - a.rule.priority || a.rule.display_name.localeCompare(b.rule.display_name));

  return { suggestions, loading };
}
