import { SPACING, TYPOGRAPHY } from '@/lib/design-tokens';

interface CaseSectionProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  color?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function CaseSection({ title, icon, children, actions, color = "#166534", collapsed, onToggle }: CaseSectionProps) {
  return (
    <div style={{ marginBottom: SPACING.xl }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: SPACING.md,
        paddingBottom: SPACING.sm,
        borderBottom: `2px solid ${color}20`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm }}>
          {onToggle && (
            <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "0.9rem" }}>
              {collapsed ? "\u25B6" : "\u25BC"}
            </button>
          )}
          {icon && <span style={{ fontSize: "1.1rem" }}>{icon}</span>}
          <h3 style={{ margin: 0, fontSize: TYPOGRAPHY.size.base, fontWeight: TYPOGRAPHY.weight.bold, color }}>{title}</h3>
        </div>
        {actions}
      </div>
      {!collapsed && children}
    </div>
  );
}
