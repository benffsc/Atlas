-- MIG_3141: Trapper Meeting Management
-- Three tables: meetings, slides, and a reusable slide library.
-- Meetings own slides (cloned from library, not referenced).
-- Past meetings are immutable snapshots.

BEGIN;

-- 1. Trapper Meetings
CREATE TABLE IF NOT EXISTS ops.trapper_meetings (
  meeting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  meeting_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'presented', 'archived')),
  description TEXT,
  created_by UUID REFERENCES ops.staff(staff_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trapper_meetings_status
  ON ops.trapper_meetings (status);
CREATE INDEX IF NOT EXISTS idx_trapper_meetings_date
  ON ops.trapper_meetings (meeting_date DESC);

-- 2. Meeting Slides (owned by a meeting, CASCADE delete)
CREATE TABLE IF NOT EXISTS ops.meeting_slides (
  slide_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES ops.trapper_meetings(meeting_id) ON DELETE CASCADE,
  slide_type TEXT NOT NULL DEFAULT 'content'
    CHECK (slide_type IN ('title', 'content', 'stats', 'photo', 'two_column', 'quote')),
  title TEXT,
  body TEXT,
  image_url TEXT,
  image_caption TEXT,
  background_style TEXT NOT NULL DEFAULT 'default'
    CHECK (background_style IN ('default', 'dark', 'accent', 'photo_bg')),
  custom_data JSONB DEFAULT '{}'::jsonb,
  display_order INT NOT NULL DEFAULT 0,
  is_from_library BOOLEAN NOT NULL DEFAULT false,
  library_slide_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_slides_meeting
  ON ops.meeting_slides (meeting_id, display_order);

-- 3. Slide Library (reusable templates)
CREATE TABLE IF NOT EXISTS ops.slide_library (
  library_slide_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('opening', 'mission', 'scoreboard', 'process', 'reminder', 'closing', 'general')),
  slide_type TEXT NOT NULL DEFAULT 'content'
    CHECK (slide_type IN ('title', 'content', 'stats', 'photo', 'two_column', 'quote')),
  title TEXT,
  body TEXT,
  image_url TEXT,
  image_caption TEXT,
  background_style TEXT NOT NULL DEFAULT 'default'
    CHECK (background_style IN ('default', 'dark', 'accent', 'photo_bg')),
  custom_data JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slide_library_category
  ON ops.slide_library (category, is_active);

-- 4. Auto-update updated_at triggers
CREATE OR REPLACE FUNCTION ops.trapper_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trapper_meetings_updated ON ops.trapper_meetings;
CREATE TRIGGER trg_trapper_meetings_updated
  BEFORE UPDATE ON ops.trapper_meetings
  FOR EACH ROW EXECUTE FUNCTION ops.trapper_meetings_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_slides_updated ON ops.meeting_slides;
CREATE TRIGGER trg_meeting_slides_updated
  BEFORE UPDATE ON ops.meeting_slides
  FOR EACH ROW EXECUTE FUNCTION ops.trapper_meetings_updated_at();

DROP TRIGGER IF EXISTS trg_slide_library_updated ON ops.slide_library;
CREATE TRIGGER trg_slide_library_updated
  BEFORE UPDATE ON ops.slide_library
  FOR EACH ROW EXECUTE FUNCTION ops.trapper_meetings_updated_at();

-- 5. Seed reusable library slides matching the observed meeting arc
INSERT INTO ops.slide_library (name, category, slide_type, title, body, background_style) VALUES
  ('Welcome', 'opening', 'title',
   'Trapper Meeting',
   'Welcome and thank you for being here!',
   'dark'),
  ('FFSC Mission', 'mission', 'content',
   'Our Mission',
   '- Forgotten Felines of Sonoma County is the only dedicated spay/neuter clinic for community cats in the county\n- We rely on volunteer trappers to bring cats in for TNR\n- Together we reduce the population humanely',
   'default'),
  ('Scoreboard', 'scoreboard', 'stats',
   'By the Numbers',
   NULL,
   'default'),
  ('TNR Process Refresher', 'process', 'content',
   'TNR Process Refresher',
   '- Set traps evening before clinic day\n- Cover traps with towels/sheets\n- Transport in vehicle with traps secured\n- Pick up from clinic same day\n- Hold cats 24hr post-surgery\n- Release at original location',
   'default'),
  ('Important Reminders', 'reminder', 'content',
   'Reminders',
   '- Always check traps every 12 hours\n- Kittens under 2 lbs cannot be altered — contact us\n- Report any sick or injured cats immediately\n- Update your availability in the system',
   'accent'),
  ('Thank You & Q&A', 'closing', 'title',
   'Thank You!',
   'Questions? Reach out anytime.\ninfo@forgottenfelines.com',
   'dark')
ON CONFLICT DO NOTHING;

COMMIT;
