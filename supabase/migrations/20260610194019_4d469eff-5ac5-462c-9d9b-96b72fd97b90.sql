
-- 1. Drop bare-host ai.se duplicates where www.ai.se twin exists (chunks cascade)
DELETE FROM public.documents d1
WHERE d1.url LIKE 'https://ai.se/%'
  AND EXISTS (
    SELECT 1 FROM public.documents d2
    WHERE d2.url = replace(d1.url, 'https://ai.se/', 'https://www.ai.se/')
  );

-- 2. Canonicalize remaining bare-host ai.se rows to www.
UPDATE public.documents
SET url = replace(url, 'https://ai.se/', 'https://www.ai.se/')
WHERE url LIKE 'https://ai.se/%';

-- 3. Also handle the bare-domain root case
DELETE FROM public.documents d1
WHERE d1.url = 'https://ai.se'
  AND EXISTS (SELECT 1 FROM public.documents d2 WHERE d2.url = 'https://www.ai.se');
UPDATE public.documents SET url = 'https://www.ai.se' WHERE url = 'https://ai.se';

-- 4. Extend AI Sweden URL filter patterns to cover Swedish equivalents
UPDATE public.sources
SET url_filter_patterns = ARRAY[
  '/project','/adoption','/ai-labs','/sector','/ecosystem','/news','/blogpost',
  '/research','/report','/about','/data-factory','/language-models',
  '/sv/projekt','/sv/nyheter','/sv/tillampning','/sv/sektorsinitiativ-projekt',
  '/sv/ekosystem','/sv/forskning','/sv/rapport','/sv/om-oss','/sv/sprakmodeller',
  '/sv/datafabrik','/sv/ai-labs'
]
WHERE slug = 'ai_sweden';
