-- MIG_2984: Replace emoji icons with Lucide icon names in nav_items
--
-- The Icon component (icon-map.ts) uses string keys like "cat", "hospital"
-- to render Lucide SVG icons. The original seed (MIG_2927) stored emojis,
-- causing a flash: hardcoded fallback renders Lucide icons on first paint,
-- then DB fetch replaces them with emojis.

BEGIN;

-- Admin sidebar
UPDATE ops.nav_items SET icon = 'layout-dashboard' WHERE sidebar = 'admin' AND path = '/admin' AND section = 'Dashboard';
UPDATE ops.nav_items SET icon = 'hospital'          WHERE sidebar = 'admin' AND path = '/admin/clinic-days';
UPDATE ops.nav_items SET icon = 'bar-chart'         WHERE sidebar = 'admin' AND path = '/admin/data';
UPDATE ops.nav_items SET icon = 'upload'            WHERE sidebar = 'admin' AND path = '/admin/data?tab=processing';
UPDATE ops.nav_items SET icon = 'list-checks'       WHERE sidebar = 'admin' AND path = '/admin/data?tab=review';
UPDATE ops.nav_items SET icon = 'map'               WHERE sidebar = 'admin' AND path = '/map';
UPDATE ops.nav_items SET icon = 'cat'               WHERE sidebar = 'admin' AND path = '/admin/beacon/colony-estimates';
UPDATE ops.nav_items SET icon = 'calendar-days'     WHERE sidebar = 'admin' AND path = '/admin/beacon/seasonal';
UPDATE ops.nav_items SET icon = 'trending-up'       WHERE sidebar = 'admin' AND path = '/admin/beacon/forecasts';
UPDATE ops.nav_items SET icon = 'mail'              WHERE sidebar = 'admin' AND path = '/admin/email';
UPDATE ops.nav_items SET icon = 'file-text'         WHERE sidebar = 'admin' AND path = '/admin/email-templates';
UPDATE ops.nav_items SET icon = 'send'              WHERE sidebar = 'admin' AND path = '/admin/email-batches';
UPDATE ops.nav_items SET icon = 'user-cog'          WHERE sidebar = 'admin' AND path = '/admin/staff';
UPDATE ops.nav_items SET icon = 'building-2'        WHERE sidebar = 'admin' AND path = '/admin/organizations';
UPDATE ops.nav_items SET icon = 'wrench'            WHERE sidebar = 'admin' AND path = '/admin/equipment';
UPDATE ops.nav_items SET icon = 'form-input'        WHERE sidebar = 'admin' AND path = '/admin/intake-fields';
UPDATE ops.nav_items SET icon = 'leaf'              WHERE sidebar = 'admin' AND path = '/admin/ecology';
UPDATE ops.nav_items SET icon = 'shield-check'      WHERE sidebar = 'admin' AND path = '/admin/ai-access';
UPDATE ops.nav_items SET icon = 'settings'          WHERE sidebar = 'admin' AND path = '/admin/config';
UPDATE ops.nav_items SET icon = 'compass'           WHERE sidebar = 'admin' AND path = '/admin/nav';
UPDATE ops.nav_items SET icon = 'shield'            WHERE sidebar = 'admin' AND path = '/admin/roles';
UPDATE ops.nav_items SET icon = 'square-kanban'     WHERE sidebar = 'admin' AND path = '/admin/linear';
UPDATE ops.nav_items SET icon = 'clipboard-list'    WHERE sidebar = 'admin' AND path = '/admin/linear/issues';
UPDATE ops.nav_items SET icon = 'bot'               WHERE sidebar = 'admin' AND path = '/admin/linear/sessions';
UPDATE ops.nav_items SET icon = 'code-2'            WHERE sidebar = 'admin' AND path = '/admin/claude-code';
UPDATE ops.nav_items SET icon = 'book-open'         WHERE sidebar = 'admin' AND path = '/admin/knowledge-base';
UPDATE ops.nav_items SET icon = 'pencil'            WHERE sidebar = 'admin' AND path = '/admin/tippy-corrections';

-- Main sidebar
UPDATE ops.nav_items SET icon = 'home'              WHERE sidebar = 'main' AND path = '/';
UPDATE ops.nav_items SET icon = 'map'               WHERE sidebar = 'main' AND path = '/map';
UPDATE ops.nav_items SET icon = 'inbox'             WHERE sidebar = 'main' AND path = '/intake/queue';
UPDATE ops.nav_items SET icon = 'clipboard-list'    WHERE sidebar = 'main' AND path = '/requests';
UPDATE ops.nav_items SET icon = 'hospital'          WHERE sidebar = 'main' AND path = '/admin/clinic-days';
UPDATE ops.nav_items SET icon = 'snail'             WHERE sidebar = 'main' AND path = '/trappers';
UPDATE ops.nav_items SET icon = 'cat'               WHERE sidebar = 'main' AND path = '/cats';
UPDATE ops.nav_items SET icon = 'users'             WHERE sidebar = 'main' AND path = '/people';
UPDATE ops.nav_items SET icon = 'map-pin'           WHERE sidebar = 'main' AND path = '/places';
UPDATE ops.nav_items SET icon = 'search'            WHERE sidebar = 'main' AND path = '/search';
UPDATE ops.nav_items SET icon = 'calendar-days'     WHERE sidebar = 'main' AND path = '/admin/beacon/colony-estimates' AND sidebar = 'main';
UPDATE ops.nav_items SET icon = 'calendar-days'     WHERE sidebar = 'main' AND path = '/admin/beacon/seasonal';
UPDATE ops.nav_items SET icon = 'trending-up'       WHERE sidebar = 'main' AND path = '/admin/beacon/forecasts' AND sidebar = 'main';
UPDATE ops.nav_items SET icon = 'settings'          WHERE sidebar = 'main' AND path = '/admin' AND section = 'Admin';

-- Also update the column comment to reflect the new format
COMMENT ON COLUMN ops.nav_items.icon IS 'Lucide icon name (e.g. "cat", "hospital"). See icon-map.ts for valid names.';

COMMIT;
