# Out-of-Service-Area Email Pipeline — Go Live Runbook

**Linear:** [FFS-1190](https://linear.app/ffsc/issue/FFS-1190) (Phase 6 of [FFS-1181](https://linear.app/ffsc/issue/FFS-1181))
**Owner:** Ben
**Last reviewed:** 2026-04-07

This runbook is the **manual checklist** Ben must walk through before
flipping the out-of-service-area email pipeline to LIVE. None of the
technical safety nets (env var, DB toggle, send-time gate) replace
this checklist — they only enforce that Ben has explicitly chosen to
proceed.

## Prerequisites

Before starting:

- All migrations applied through `MIG_3062`
- Phase 0–5 code deployed to production
- `EMAIL_DRY_RUN=true` set in Vercel env vars
- `EMAIL_TEST_RECIPIENT_OVERRIDE=ben@forgottenfelines.com` set in Vercel
- `EMAIL_OUT_OF_AREA_LIVE` **NOT set** (or `false`) in Vercel
- DB config:
  - `email.global.dry_run = true`
  - `email.test_recipient_override = "ben@forgottenfelines.com"`
  - `email.out_of_area.live = false`

---

## Section A — Pre-flight (steps 1–10)

> Goal: confirm the rendered output matches Ben's approved Airtable email and the pipeline behaves correctly while still in dry-run mode.

- [ ] **1.** Open `/admin/email-settings` and confirm the Pipeline Mode card shows **DRY RUN** with the yellow warning.
- [ ] **2.** Confirm the test recipient override shows `ben@forgottenfelines.com`.
- [ ] **3.** Confirm the Out-of-Service-Area Pipeline status shows 🔴 **Disabled** and the "Enable Go Live" button is **disabled**.
- [ ] **4.** Open `/intake/queue` with the **Out of Area** filter chip on. Pick three test submissions (one per neighbor county if possible — Marin, Napa, Mendocino).
- [ ] **5.** For each, click **Preview email** and screenshot the rendered HTML.
- [ ] **6.** Compare each screenshot against Ben's approved Airtable body. Verify:
  - Subject contains the org service area name
  - Greeting uses recipient first name
  - County name is correct
  - All resource cards render with phone + address + URL
  - Footer has org address + phone + website
- [ ] **7.** Verify the resource list contains both county-specific AND statewide directories.
- [ ] **8.** Verify there is **no** hardcoded "FFSC" or "Sonoma County" string outside of the placeholder substitutions.
- [ ] **9.** Click **Approve & Send** on one of the previews. Confirm modal shows **DRY RUN MODE** indicator. Confirm.
- [ ] **10.** Check `ops.sent_emails` for a new row with `status='dry_run'`, `template_key='out_of_service_area'`, and the original recipient email preserved.

---

## Section B — Test send (steps 11–20)

> Goal: send one real email to ben@forgottenfelines.com to verify deliverability end-to-end.

- [ ] **11.** Open `/admin/email-settings`. Click **Send Test Email** in the Out-of-Service-Area row.
- [ ] **12.** Confirm a success toast appears.
- [ ] **13.** Wait up to 5 minutes. Check `ben@forgottenfelines.com` inbox.
- [ ] **14.** Verify the email arrived. Verify:
  - Subject prefixed with `[TEST SEND]`
  - Body renders correctly in Outlook web + mobile
  - Marin Humane card visible
  - Statewide directories visible
  - Footer org info correct
- [ ] **15.** Open the email's Resend dashboard via `data.id` to confirm delivery.
- [ ] **16.** Query `ops.sent_emails` to confirm a new row with `status='sent'`, `recipient_email='ben@forgottenfelines.com'`, `template_key='out_of_service_area'`.
- [ ] **17.** Re-open `/admin/email-settings`. Confirm the test-send count is now **≥ 1** and the **Enable Go Live** button is no longer disabled.
- [ ] **18.** Run the e2e suite locally: `npm run test:e2e -- out-of-service-area-workflow` — verify all 5 scenarios green.
- [ ] **19.** Run the spot-check SQL queries from `MIG_3057`:
  ```sql
  SELECT sot.service_area_membership(38.4404, -122.7141);  -- Santa Rosa → 'in'
  SELECT sot.service_area_membership(37.9735, -122.5311);  -- San Rafael → 'out'
  SELECT sot.service_area_membership(38.3266, -122.7094);  -- Cotati     → 'ambiguous'
  ```
- [ ] **20.** Verify `ops.v_pending_out_of_service_area_emails` returns the expected count (zero unless an approved-but-not-sent submission exists).

---

## Section C — Pilot single real send (steps 21–25)

> Goal: send ONE real email to a known real recipient (with their consent) before opening the floodgates.

- [ ] **21.** Pick ONE out-of-area submission with a known, real recipient who has consented to receive a test (or use a friend's email). Note the submission_id.
- [ ] **22.** Temporarily clear the test recipient override:
  ```sql
  UPDATE ops.app_config SET value = '""'::jsonb WHERE key = 'email.test_recipient_override';
  ```
- [ ] **23.** Set `email.global.dry_run = false`:
  ```sql
  UPDATE ops.app_config SET value = 'false'::jsonb WHERE key = 'email.global.dry_run';
  ```
- [ ] **24.** Open the chosen submission in `/intake/queue` and click **Approve & Send**. Confirm the modal shows **LIVE** in green. Confirm.
- [ ] **25.** Verify the recipient confirmed receipt (out-of-band — phone call or text).
- [ ] **25a.** Restore safe defaults:
  ```sql
  UPDATE ops.app_config SET value = '"ben@forgottenfelines.com"'::jsonb WHERE key = 'email.test_recipient_override';
  UPDATE ops.app_config SET value = 'true'::jsonb WHERE key = 'email.global.dry_run';
  ```
- [ ] **25b.** Try to re-approve the same submission. Verify it is rejected with the suppression message (90-day window).

---

## Section D — Go Live (steps 26–29)

> Goal: flip both safety flags to enable production.

- [ ] **26.** In Vercel, set `EMAIL_OUT_OF_AREA_LIVE=true` and trigger a redeploy.
- [ ] **27.** Wait for deploy to complete. Verify by `curl -X POST https://atlas.forgottenfelines.com/api/cron/send-emails`. Expected: 503 with message about DB flag (not env flag).
- [ ] **28.** In `/admin/email-settings`, click **Enable Go Live**. Confirm the modal acknowledging the runbook completion. Confirm.
- [ ] **29.** Verify the Pipeline Mode card now shows the Out-of-Service-Area Pipeline as 🟢 **Live**. Verify a new row in `ops.entity_edits` with `entity_type='email_pipeline'`, `field_name='out_of_area_live'`, `new_value='true'`.

---

## Post-launch monitoring (first 7 days)

- [ ] **Daily:** review `ops.sent_emails` for any `status='failed'` rows where `template_key='out_of_service_area'`.
- [ ] **Daily:** review `/intake/queue?outofarea=1` for any submissions sitting in pending state for more than 24 hours.
- [ ] **Weekly:** cross-check the suppression list — confirm no recipient has received more than one out-of-area email in the 90-day window.
- [ ] **Weekly:** spot-check 3 random sent emails by clicking through to the rendered body in `/admin/email-templates` audit log.

---

## Rollback (three tiers)

If something is wrong, roll back from the **highest** layer first:

1. **DB toggle** (instant, no redeploy):
   ```sql
   UPDATE ops.app_config SET value = 'false'::jsonb WHERE key = 'email.out_of_area.live';
   ```
2. **Global dry-run** (catches everything, instant):
   ```sql
   UPDATE ops.app_config SET value = 'true'::jsonb WHERE key = 'email.global.dry_run';
   ```
3. **Env var redeploy** (nuclear, requires Vercel redeploy):
   - Set `EMAIL_OUT_OF_AREA_LIVE=false` (or unset) in Vercel.
   - Redeploy.

After rollback, the cron + send route will return 503 immediately. Any
in-flight submissions remain in their pre-send state and can be retried
once the issue is resolved.

---

## Linear references

| Phase | Issue | What it does |
|-------|-------|--------------|
| 0 | [FFS-1182](https://linear.app/ffsc/issue/FFS-1182) | Defuse the legacy out_of_county cron |
| 1 | [FFS-1183](https://linear.app/ffsc/issue/FFS-1183) | PostGIS service area boundary + trigger |
| 2 | [FFS-1184](https://linear.app/ffsc/issue/FFS-1184) | Expand community resources |
| 2 | [FFS-1185](https://linear.app/ffsc/issue/FFS-1185) | New email template + renderer |
| 3 | [FFS-1186](https://linear.app/ffsc/issue/FFS-1186) | View fix + approval gate + suppression |
| 4 | [FFS-1187](https://linear.app/ffsc/issue/FFS-1187) | Intake UI: banner + preview/approve/override |
| 5 | [FFS-1188](https://linear.app/ffsc/issue/FFS-1188) | Dry-run + test override + Go Live toggle |
| 6 | [FFS-1189](https://linear.app/ffsc/issue/FFS-1189) | E2E Playwright tests |
| 6 | [FFS-1190](https://linear.app/ffsc/issue/FFS-1190) | This runbook |
