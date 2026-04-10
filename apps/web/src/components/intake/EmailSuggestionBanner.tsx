"use client";

/**
 * EmailSuggestionBanner — config-driven email suggestion banner.
 *
 * Generalizes OutOfServiceAreaBanner — driven by rule data from
 * ops.email_action_rules. Same visual (colored banner + Preview + Send
 * buttons), but text and action come from the rule config.
 *
 * Does NOT do API calls itself — emits onClick handlers to the parent.
 *
 * @see MIG_3078
 * @see useEmailSuggestions
 */

import type { EmailSuggestion } from "@/hooks/useEmailSuggestions";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { COLORS } from "@/lib/design-tokens";

export interface EmailSuggestionBannerProps {
  suggestion: EmailSuggestion;
  onPreview: (suggestion: EmailSuggestion) => void;
  onSend: (suggestion: EmailSuggestion) => void;
}

export function EmailSuggestionBanner({
  suggestion,
  onPreview,
  onSend,
}: EmailSuggestionBannerProps) {
  const { rule } = suggestion;

  return (
    <div
      style={{
        background: "rgba(220, 53, 69, 0.08)",
        border: `1px solid ${COLORS.error}`,
        borderRadius: "8px",
        padding: "0.75rem",
        marginBottom: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <span style={{ color: COLORS.error, flexShrink: 0, marginTop: "2px" }}>
          <Icon name="mail" size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: COLORS.error, marginBottom: "0.25rem" }}>
            {rule.display_name}
          </div>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary, #4b5563)", lineHeight: 1.4 }}>
            {rule.suggestion_text}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <Button
              variant="outline"
              size="sm"
              icon="eye"
              onClick={() => onPreview(suggestion)}
            >
              Preview
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="send"
              onClick={() => onSend(suggestion)}
            >
              {rule.action_label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
