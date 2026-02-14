\echo '=== MIG_606: Email Templates Seed ==='
\echo 'Seeds email templates for common workflows'

-- ============================================================================
-- Appointment Confirmation Templates
-- ============================================================================

-- English - Single Cat
INSERT INTO trapper.email_templates (
  template_key, name, description, subject, body_html, body_text,
  placeholders, category_key, language, is_active
) VALUES (
  'appt_confirm_en_single',
  'Appointment Confirmation (English, 1 Cat)',
  'Confirmation email for tame/pet cat appointments - single cat',
  'Your FFSC Appointment - {{appt_date}}',
  '<div style="font-family: sans-serif; padding: 20px; color:#222; line-height:1.55;">
    <p>Hi {{first_name}},</p>

    <p>Your appointment is confirmed for <strong>{{appt_date}}</strong> at our clinic.</p>

    <h3 style="color:#5a5a5a;">What to bring:</h3>
    <ul>
      <li>Your cat in a secure carrier</li>
      <li>This confirmation email</li>
    </ul>

    <h3 style="color:#5a5a5a;">Location:</h3>
    <p>1814 Empire Industrial Ct, Santa Rosa, CA 95403</p>

    <h3 style="color:#5a5a5a;">Important:</h3>
    <ul>
      <li>Arrive 15 minutes early</li>
      <li>No food after midnight the night before</li>
      <li>Water is OK until morning</li>
    </ul>

    <p>Questions? Reply to this email or call (707) 576-7999.</p>

    <p>Thank you for helping community cats!</p>

    <div style="margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 13px; color:#666;">
      <strong>Forgotten Felines of Sonoma County</strong><br>
      (707) 576-7999 | info@forgottenfelines.com
    </div>
  </div>',
  'Hi {{first_name}},

Your appointment is confirmed for {{appt_date}} at our clinic.

What to bring:
- Your cat in a secure carrier
- This confirmation email

Location:
1814 Empire Industrial Ct, Santa Rosa, CA 95403

Important:
- Arrive 15 minutes early
- No food after midnight the night before
- Water is OK until morning

Questions? Reply to this email or call (707) 576-7999.

Thank you for helping community cats!

Forgotten Felines of Sonoma County
(707) 576-7999 | info@forgottenfelines.com',
  ARRAY['first_name', 'appt_date'],
  'client',
  'en',
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  category_key = EXCLUDED.category_key,
  language = EXCLUDED.language,
  updated_at = NOW();

-- English - Multiple Cats
INSERT INTO trapper.email_templates (
  template_key, name, description, subject, body_html, body_text,
  placeholders, category_key, language, is_active
) VALUES (
  'appt_confirm_en_multiple',
  'Appointment Confirmation (English, Multiple Cats)',
  'Confirmation email for tame/pet cat appointments - multiple cats',
  'Your FFSC Appointment - {{appt_date}} ({{cat_count}} cats)',
  '<div style="font-family: sans-serif; padding: 20px; color:#222; line-height:1.55;">
    <p>Hi {{first_name}},</p>

    <p>Your appointment for <strong>{{cat_count}} cats</strong> is confirmed for <strong>{{appt_date}}</strong> at our clinic.</p>

    <h3 style="color:#5a5a5a;">What to bring:</h3>
    <ul>
      <li>Each cat in a separate, secure carrier</li>
      <li>This confirmation email</li>
    </ul>

    <h3 style="color:#5a5a5a;">Location:</h3>
    <p>1814 Empire Industrial Ct, Santa Rosa, CA 95403</p>

    <h3 style="color:#5a5a5a;">Important:</h3>
    <ul>
      <li>Arrive 15 minutes early</li>
      <li>No food after midnight the night before for any cat</li>
      <li>Water is OK until morning</li>
    </ul>

    <p>Questions? Reply to this email or call (707) 576-7999.</p>

    <p>Thank you for helping community cats!</p>

    <div style="margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 13px; color:#666;">
      <strong>Forgotten Felines of Sonoma County</strong><br>
      (707) 576-7999 | info@forgottenfelines.com
    </div>
  </div>',
  'Hi {{first_name}},

Your appointment for {{cat_count}} cats is confirmed for {{appt_date}} at our clinic.

What to bring:
- Each cat in a separate, secure carrier
- This confirmation email

Location:
1814 Empire Industrial Ct, Santa Rosa, CA 95403

Important:
- Arrive 15 minutes early
- No food after midnight the night before for any cat
- Water is OK until morning

Questions? Reply to this email or call (707) 576-7999.

Thank you for helping community cats!

Forgotten Felines of Sonoma County
(707) 576-7999 | info@forgottenfelines.com',
  ARRAY['first_name', 'appt_date', 'cat_count'],
  'client',
  'en',
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  category_key = EXCLUDED.category_key,
  language = EXCLUDED.language,
  updated_at = NOW();

-- ============================================================================
-- Trapper Welcome Email (Post-Orientation)
-- ============================================================================

INSERT INTO trapper.email_templates (
  template_key, name, description, subject, body_html, body_text,
  placeholders, category_key, language, is_active
) VALUES (
  'trapper_welcome',
  'Trapper Welcome (Post-Orientation)',
  'Welcome email sent after volunteer attends orientation and selected trapping interest',
  'Message from the Trapping Coordinator',
  '<div style="font-family: sans-serif; padding: 20px; color:#222; line-height:1.6;">
    <p>Hi {{first_name}},</p>

    <p>I''m Ben, the Trapping Coordinator with Forgotten Felines of Sonoma County. Thank you for submitting your recent Volunteer Application and for attending Volunteer Orientation. I saw you selected trapping as an area of interest, so I wanted to check in to see if you are still interested or would like to learn more.</p>

    <p>If you want to move forward, I can send the Volunteer Trapper Agreement in a follow-up email. That is the next step to join the trapper team.</p>

    <h3 style="color:#5a5a5a;">Why we need more trappers</h3>
    <p>There are more cats and colonies that need help than we have people for. Extra eyes and hands make a real difference for our clinics and for preventing new litters. Even a few hours a month helps.</p>

    <h3 style="color:#5a5a5a;">How much time does it take?</h3>
    <p>It depends on the site. The active trapping window is usually a few hours, but most of the effort is planning, recon, and follow-up trappings over the next few days. We plan together so the time fits your schedule.</p>

    <h3 style="color:#5a5a5a;">Is there training?</h3>
    <p>Yes. Depending on your comfort level we can start with a ride along, then transition into you taking on assignments. This happens at your own pace with support from me and other experienced trappers.</p>

    <p>If you have questions, reply to this email anytime. If you are interested, let me know and I will send the next step. It also helps if you include:</p>

    <ul>
      <li>Your home base city and how far you can travel</li>
      <li>General availability (weekdays, evenings, weekends)</li>
      <li>Best phone number and whether texting is OK</li>
      <li>Any prior trapping or cat-handling experience</li>
    </ul>

    <h3 style="color:#5a5a5a;">Frequently asked questions</h3>

    <p><strong>What do trappers do?</strong><br>
    Trappers humanely trap unowned cats, coordinate drop-off and pick-up for spay and neuter, and share quick updates from the site.</p>

    <p><strong>Do I need to buy equipment?</strong><br>
    No. FFSC checks out traps, covers, and basic supplies. You return gear clean and in good working order.</p>

    <p><strong>What about safety?</strong><br>
    You never handle cats directly. You use covered traps and follow simple safety steps. You do not trap without a plan or a confirmed clinic appointment. We are here to support you.</p>

    <p><strong>Where are assignments?</strong><br>
    All over Sonoma County. We match you to your travel radius and comfort level.</p>

    <p><strong>Will I need to hold cats overnight?</strong><br>
    Sometimes. We plan for safe, quiet holding when needed or arrange alternatives with staff when approved.</p>

    <p><strong>What about kittens or special cases?</strong><br>
    You coordinate with me before removing kittens or trapping nursing moms. We move forward with a clear plan for each situation.</p>

    <p><strong>Who do I contact if something changes?</strong><br>
    Me directly. Quick updates help us adjust clinic counts and keep everyone safe.</p>

    <p>If you would like to proceed, reply "I''m interested" and I will send the contract and a short follow-up survey. If you are on the fence, feel free to reply with any questions. I am happy to help you decide if trapping is a good fit.</p>

    <p>Thank you for considering trapping with FFSC.</p>
    <p>Best regards,<br>Ben</p>

    <div style="margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 13px; color:#666;">
      <strong>Ben - Trapping Coordinator</strong><br>
      Forgotten Felines of Sonoma County<br>
      ben@forgottenfelines.com
    </div>
  </div>',
  'Hi {{first_name}},

I''m Ben, the Trapping Coordinator with Forgotten Felines of Sonoma County. Thank you for submitting your recent Volunteer Application and for attending Volunteer Orientation. I saw you selected trapping as an area of interest, so I wanted to check in to see if you are still interested or would like to learn more.

If you want to move forward, I can send the Volunteer Trapper Agreement in a follow-up email. That is the next step to join the trapper team.

WHY WE NEED MORE TRAPPERS
There are more cats and colonies that need help than we have people for. Extra eyes and hands make a real difference for our clinics and for preventing new litters. Even a few hours a month helps.

HOW MUCH TIME DOES IT TAKE?
It depends on the site. The active trapping window is usually a few hours, but most of the effort is planning, recon, and follow-up trappings over the next few days. We plan together so the time fits your schedule.

IS THERE TRAINING?
Yes. Depending on your comfort level we can start with a ride along, then transition into you taking on assignments. This happens at your own pace with support from me and other experienced trappers.

If you have questions, reply to this email anytime. If you are interested, let me know and I will send the next step. It also helps if you include:

- Your home base city and how far you can travel
- General availability (weekdays, evenings, weekends)
- Best phone number and whether texting is OK
- Any prior trapping or cat-handling experience

If you would like to proceed, reply "I''m interested" and I will send the contract and a short follow-up survey.

Thank you for considering trapping with FFSC.
Best regards,
Ben

Ben - Trapping Coordinator
Forgotten Felines of Sonoma County
ben@forgottenfelines.com',
  ARRAY['first_name'],
  'trapper',
  'en',
  TRUE
) ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  category_key = EXCLUDED.category_key,
  language = EXCLUDED.language,
  updated_at = NOW();

-- ============================================================================
-- Update existing out_of_county template with richer content
-- ============================================================================

UPDATE trapper.email_templates SET
  body_html = '<div style="font-family: sans-serif; padding: 20px; color:#222; line-height:1.55;">
    <div style="text-align:center; margin-bottom:16px;">
      <img src="https://i.imgur.com/kdZ1GSF.jpeg" alt="Forgotten Felines Logo" width="120" style="margin: 10px auto;" />
      <h2 style="color:#5a5a5a; margin:8px 0 0;">Community Cat Help Near You (Outside Sonoma County)</h2>
    </div>

    <p>Hi {{first_name}},</p>

    <p>Thank you for reaching out about the cats you''re helping. Our clinic and field services are dedicated to unowned cats within Sonoma County. At this time we cannot schedule services outside Sonoma County. This is not a permanent policy. When capacity allows, we do occasionally assist outside our county, and we review our capacity regularly.</p>

    <p>In the meantime, here are reliable resources in our surrounding counties and two statewide directories to find low-cost spay/neuter and TNR support:</p>

    <h3 style="color:#5a5a5a; margin:18px 0 8px;">Statewide directories</h3>
    <ul style="margin:0 0 12px 18px;">
      <li>United Spay Alliance program locator: https://www.unitedspayalliance.org/ca/</li>
      <li>Alley Cat Allies community resource tool: https://gethelp.alleycat.org/</li>
    </ul>

    <h3 style="color:#5a5a5a; margin:18px 0 8px;">Nearby counties and key contacts</h3>

    <p style="margin:10px 0;"><strong>Marin County</strong><br>
      Marin Humane<br>
      171 Bel Marin Keys Blvd, Novato, CA 94949<br>
      415-883-4621<br>
      marinhumane.org
    </p>

    <p style="margin:10px 0;"><strong>Napa County</strong><br>
      Napa Humane<br>
      3265 California Blvd, Napa, CA 94558<br>
      (707) 255-8118<br>
      napahumane.org
    </p>

    <p style="margin:10px 0;">
      Napa County Animal Shelter — Community Cat Program<br>
      942 Hartle Court, Napa, CA 94558<br>
      (707) 253-4382<br>
      www.countyofnapa.org/1023/Animal-Shelter
    </p>

    <p style="margin:10px 0;"><strong>Mendocino County</strong><br>
      Mendocino County Animal Care Services<br>
      298 Plant Rd, Ukiah, CA 95482<br>
      (707) 463-4427<br>
      www.mendocinocounty.gov/government/animal-care-services
    </p>

    <p style="margin:10px 0;">
      Coast Cat Project<br>
      PO Box 993, Fort Bragg, CA 95437<br>
      (707) 969-7781<br>
      www.coastcatproject.org/contact/
    </p>

    <p style="margin:10px 0;"><strong>Lake County</strong><br>
      Lake County Animal Care &amp; Control<br>
      255 N Forbes Street, Lakeport, CA 95453<br>
      (707) 263-0278<br>
      www.lakecountyca.gov/235/Animal-Care-Control
    </p>

    <p style="margin:10px 0;"><strong>Solano County</strong><br>
      Solano County Animal Care<br>
      2510 Clay Bank Rd, Fairfield, CA 94533<br>
      (707) 784-1356<br>
      www.solanocounty.gov/government/sheriff-coroner/animal-care-services/general-information
    </p>

    <p>If your situation ends up being inside Sonoma County, or if our capacity opens to assist out of county again, please reach back out and we''ll walk you through next steps.</p>

    <p>With appreciation,</p>

    <div style="font-size: 13px; color:#333; margin-top: 28px; border-top: 1px solid #ddd; padding-top: 16px;">
      <img src="https://static.wixstatic.com/media/fd3502_db7cb461a9284f4abc32ce0791abff0c~mv2.png" alt="FFSC" width="100" style="vertical-align: middle; margin-right: 12px;" />
      <div style="margin-top: 10px; line-height: 1.6;">
        <strong>Forgotten Felines Team</strong><br>
        (707) 576-7999<br>
        info@forgottenfelines.com<br>
        1814–1820 Empire Industrial Ct, Santa Rosa, CA<br>
        www.forgottenfelines.com
      </div>
    </div>
  </div>',
  category_key = 'client',
  language = 'en',
  updated_at = NOW()
WHERE template_key = 'out_of_county';

\echo 'MIG_606 complete: Email templates seeded'
