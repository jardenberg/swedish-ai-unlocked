
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS include_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclude_tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS filter_miss boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS documents_filter_miss_idx
  ON public.documents (filter_miss) WHERE filter_miss = true;

UPDATE public.sources
  SET include_tags = ARRAY['main'],
      exclude_tags = ARRAY['.captcha','form','.Paragraph-contact-card','.card__contact__drawer_form','.contact_card__trigger','header','footer','nav']
  WHERE slug = 'rise';

UPDATE public.sources
  SET include_tags = ARRAY['#block-zeus-theme-content'],
      exclude_tags = ARRAY[]::text[]
  WHERE slug = 'ai_sweden';
