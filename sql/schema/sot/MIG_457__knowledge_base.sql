\echo === MIG_457: Knowledge Base System ===
\echo Creating knowledge_articles table for Tippy AI retrieval

-- Knowledge articles table
CREATE TABLE IF NOT EXISTS trapper.knowledge_articles (
  article_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Content
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- URL-friendly identifier
  summary TEXT,               -- Short description for search results
  content TEXT NOT NULL,      -- Full markdown content

  -- Categorization
  category TEXT NOT NULL CHECK (category IN (
    'procedures',     -- Standard operating procedures
    'training',       -- Training materials
    'faq',           -- Frequently asked questions
    'troubleshooting', -- Problem resolution guides
    'talking_points', -- Scripts for client conversations
    'equipment',      -- Equipment guides
    'policy'          -- Organizational policies
  )),

  -- Access control
  access_level TEXT DEFAULT 'staff' CHECK (access_level IN (
    'public',        -- Anyone (including public Tippy)
    'staff',         -- FFSC staff only
    'admin',         -- Admins only
    'volunteer'      -- Volunteers and above
  )),

  -- Search optimization
  keywords TEXT[],     -- Manual keywords for search
  tags JSONB,          -- Flexible tags

  -- Source tracking
  source_system TEXT,       -- 'sharepoint', 'manual', 'docs_folder'
  source_path TEXT,         -- Original file path
  source_synced_at TIMESTAMPTZ,

  -- Metadata
  is_published BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES trapper.staff(staff_id),
  updated_by UUID REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_knowledge_search ON trapper.knowledge_articles
  USING gin(to_tsvector('english', title || ' ' || COALESCE(summary, '') || ' ' || content));

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON trapper.knowledge_articles(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_access ON trapper.knowledge_articles(access_level);
CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON trapper.knowledge_articles USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_knowledge_slug ON trapper.knowledge_articles(slug);
CREATE INDEX IF NOT EXISTS idx_knowledge_published ON trapper.knowledge_articles(is_published) WHERE is_published = TRUE;

-- Search function
CREATE OR REPLACE FUNCTION trapper.search_knowledge(
  p_query TEXT,
  p_access_level TEXT DEFAULT 'staff',
  p_category TEXT DEFAULT NULL,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  article_id UUID,
  title TEXT,
  slug TEXT,
  summary TEXT,
  category TEXT,
  relevance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ka.article_id,
    ka.title,
    ka.slug,
    ka.summary,
    ka.category,
    ts_rank(to_tsvector('english', ka.title || ' ' || COALESCE(ka.summary, '') || ' ' || ka.content),
            plainto_tsquery('english', p_query)) as relevance
  FROM trapper.knowledge_articles ka
  WHERE ka.is_published = TRUE
    AND (
      ka.access_level = 'public'
      OR (p_access_level = 'volunteer' AND ka.access_level IN ('public', 'volunteer'))
      OR (p_access_level = 'staff' AND ka.access_level IN ('public', 'volunteer', 'staff'))
      OR (p_access_level = 'admin')
    )
    AND (p_category IS NULL OR ka.category = p_category)
    AND (
      to_tsvector('english', ka.title || ' ' || COALESCE(ka.summary, '') || ' ' || ka.content)
      @@ plainto_tsquery('english', p_query)
      OR p_query = ANY(ka.keywords)
      OR ka.title ILIKE '%' || p_query || '%'
    )
  ORDER BY relevance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Helper function to generate slug from title
CREATE OR REPLACE FUNCTION trapper.generate_slug(p_title TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(REGEXP_REPLACE(
    REGEXP_REPLACE(p_title, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION trapper.knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_updated ON trapper.knowledge_articles;
CREATE TRIGGER trg_knowledge_updated
  BEFORE UPDATE ON trapper.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION trapper.knowledge_updated_at();

-- Table to track Tippy's knowledge base usage (for analytics)
CREATE TABLE IF NOT EXISTS trapper.knowledge_usage_log (
  usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID REFERENCES trapper.knowledge_articles(article_id),
  query TEXT,
  relevance_score FLOAT,
  session_id TEXT,
  staff_id UUID REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_usage_article ON trapper.knowledge_usage_log(article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage_date ON trapper.knowledge_usage_log(created_at);

-- Comments
COMMENT ON TABLE trapper.knowledge_articles IS 'Knowledge base for Tippy AI - stores procedures, training, FAQs, talking points';
COMMENT ON COLUMN trapper.knowledge_articles.access_level IS 'Controls who can view: public (anyone), volunteer, staff, admin';
COMMENT ON COLUMN trapper.knowledge_articles.keywords IS 'Manual keywords to help search find this article';
COMMENT ON FUNCTION trapper.search_knowledge IS 'Full-text search of knowledge base with access control';

\echo MIG_457 complete: knowledge_articles table and search function created
