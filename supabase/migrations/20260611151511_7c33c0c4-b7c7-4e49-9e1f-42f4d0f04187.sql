CREATE OR REPLACE FUNCTION public.replace_chunks(
  p_document_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Atomic swap: delete old chunks + insert new ones in a single statement
  -- block so search never sees a gap mid-reembed.
  DELETE FROM public.chunks WHERE document_id = p_document_id;

  INSERT INTO public.chunks (document_id, ord, text, token_count, embedding, lang)
  SELECT
    p_document_id,
    (r->>'ord')::int,
    r->>'text',
    (r->>'token_count')::int,
    (r->>'embedding')::vector,
    r->>'lang'
  FROM jsonb_array_elements(p_rows) r;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_chunks(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_chunks(uuid, jsonb) TO service_role;