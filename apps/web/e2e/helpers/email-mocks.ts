/**
 * FFS-1189 — Email-pipeline route mocks for Playwright tests.
 *
 * Centralized helpers for stubbing the email-pipeline endpoints so
 * test specs don't have to repeat the route definitions.
 */

import type { Page, Route } from '@playwright/test';

export interface PipelineStateMockOptions {
  mode?: 'dry_run' | 'test_override' | 'live' | 'unknown';
  testOverride?: string | null;
  outOfAreaLive?: boolean;
  testSends?: number;
}

export async function mockPipelineState(
  page: Page,
  opts: PipelineStateMockOptions = {}
) {
  const {
    mode = 'dry_run',
    testOverride = 'ben@forgottenfelines.com',
    outOfAreaLive = false,
    testSends = 0,
  } = opts;

  await page.route('**/api/admin/email-settings/state', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          mode,
          global_dry_run: mode === 'dry_run',
          test_recipient_override: testOverride,
          out_of_area_live: outOfAreaLive,
          env_dry_run: mode === 'dry_run',
          env_out_of_area_live: outOfAreaLive,
          gate_env_live: outOfAreaLive,
          gate_db_live: outOfAreaLive,
          gate_combined_live: outOfAreaLive,
          go_live_prerequisite: {
            required_recipient: 'ben@forgottenfelines.com',
            test_sends: testSends,
            latest_test_send_at:
              testSends > 0 ? new Date().toISOString() : null,
            ready_for_go_live: testSends >= 1,
          },
        },
      }),
    });
  });
}

export async function mockEmailPreview(page: Page, html?: string) {
  await page.route('**/api/emails/preview-out-of-service-area*', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          submission_id: '00000000-0000-0000-0000-000000000000',
          recipient: { email: 'jane@example.com', name: 'Jane', county: 'Marin', service_area_status: 'out' },
          template_key: 'out_of_service_area',
          subject: 'Community Cat Help Near You (Outside Sonoma County)',
          body_html:
            html ??
            '<html><body><p>Hi Jane, here are Marin resources: Marin Humane (415) 883-4621</p></body></html>',
          body_text: 'Hi Jane',
          resource_count: 3,
        },
      }),
    });
  });
}

/**
 * Mocks /api/emails/send-out-of-service-area to return a dry-run success
 * response. Returns a function that, when called, returns a boolean
 * indicating whether the route was hit during the test.
 */
export async function mockDryRunSend(page: Page): Promise<() => boolean> {
  let hit = false;
  await page.route('**/api/emails/send-out-of-service-area', (route: Route) => {
    hit = true;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          success: true,
          message: 'Dry-run mode — email rendered and logged but not sent',
          email_id: 'fake-dry-run-email-id',
          dry_run: true,
        },
      }),
    });
  });
  return () => hit;
}
