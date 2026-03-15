-- MIG_2948: Seed digital form configs into ops.app_config (FFS-497)
--
-- Stores the 5 FormConfig objects (section ordering + props) that were
-- previously hardcoded in form-configs.ts. Admin UI can now edit these
-- via /admin/forms/configs. The TypeScript constants remain as fallback
-- defaults when no DB row exists.

BEGIN;

-- ── FFR New Request ──────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, category)
VALUES (
  'form_config.ffr_new',
  '{
    "id": "ffr_new",
    "label": "New FFR Request",
    "sections": [
      { "component": "place", "label": "Cat Location", "props": { "showPropertyType": true, "showCounty": true, "showWhereOnProperty": true } },
      { "component": "person", "label": "Requester", "props": { "role": "requestor", "allowCreate": true, "required": true } },
      { "component": "propertyAccess" },
      { "component": "catDetails" },
      { "component": "kittens" },
      { "component": "urgencyNotes", "props": { "showDetails": true } }
    ]
  }'::jsonb,
  'form_system'
) ON CONFLICT (key) DO NOTHING;

-- ── Quick Intake ─────────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, category)
VALUES (
  'form_config.quick_intake',
  '{
    "id": "quick_intake",
    "label": "Quick Intake",
    "sections": [
      { "component": "person", "label": "Caller", "props": { "role": "requestor", "allowCreate": true, "compact": true } },
      { "component": "place", "label": "Cat Location", "props": { "showPropertyType": false, "showCounty": true, "showWhereOnProperty": false, "compact": true } },
      { "component": "catDetails", "props": { "compact": true } },
      { "component": "urgencyNotes", "label": "Notes", "props": { "showDetails": false, "compact": true } }
    ]
  }'::jsonb,
  'form_system'
) ON CONFLICT (key) DO NOTHING;

-- ── Dynamic Intake (conversion) ──────────────────────────────────────

INSERT INTO ops.app_config (key, value, category)
VALUES (
  'form_config.dynamic_intake',
  '{
    "id": "dynamic_intake",
    "label": "Convert Intake to Request",
    "sections": [
      { "component": "place", "label": "Cat Location", "props": { "showPropertyType": true, "showCounty": true, "showWhereOnProperty": true } },
      { "component": "person", "label": "Requester", "props": { "role": "requestor", "allowCreate": true } },
      { "component": "catDetails" },
      { "component": "kittens" },
      { "component": "urgencyNotes", "props": { "showDetails": true } }
    ]
  }'::jsonb,
  'form_system'
) ON CONFLICT (key) DO NOTHING;

-- ── Handoff ──────────────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, category)
VALUES (
  'form_config.handoff',
  '{
    "id": "handoff",
    "label": "Handoff Request",
    "sections": [
      { "component": "place", "label": "New Location", "props": { "showPropertyType": false, "showCounty": false, "showWhereOnProperty": false, "compact": true } },
      { "component": "person", "label": "New Contact", "props": { "role": "caretaker", "allowCreate": true, "compact": true } },
      { "component": "catDetails", "props": { "compact": true } },
      { "component": "urgencyNotes", "label": "Handoff Notes", "props": { "showDetails": false, "compact": true } }
    ]
  }'::jsonb,
  'form_system'
) ON CONFLICT (key) DO NOTHING;

-- ── Redirect ─────────────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, category)
VALUES (
  'form_config.redirect',
  '{
    "id": "redirect",
    "label": "Redirect Request",
    "sections": [
      { "component": "place", "label": "New Address", "props": { "showPropertyType": false, "showCounty": false, "showWhereOnProperty": false, "compact": true } },
      { "component": "person", "label": "Contact", "props": { "role": "requestor", "allowCreate": true, "compact": true } },
      { "component": "catDetails", "props": { "compact": true } },
      { "component": "urgencyNotes", "label": "Redirect Notes", "props": { "showDetails": false, "compact": true } }
    ]
  }'::jsonb,
  'form_system'
) ON CONFLICT (key) DO NOTHING;

COMMIT;
