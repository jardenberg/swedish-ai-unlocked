
CREATE TABLE public.corpus_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.sources(id) ON DELETE CASCADE,
  embedded integer NOT NULL DEFAULT 0,
  chunks integer NOT NULL DEFAULT 0,
  pending integer NOT NULL DEFAULT 0,
  scraped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  hidden integer NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_corpus_snapshots_source_captured
  ON public.corpus_snapshots (source_id, captured_at DESC);
CREATE INDEX idx_corpus_snapshots_captured
  ON public.corpus_snapshots (captured_at DESC);

GRANT SELECT ON public.corpus_snapshots TO authenticated;
GRANT ALL ON public.corpus_snapshots TO service_role;

ALTER TABLE public.corpus_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read snapshots"
  ON public.corpus_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
