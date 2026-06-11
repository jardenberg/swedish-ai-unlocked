
REVOKE ALL ON FUNCTION public.replace_chunks(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_chunks(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.match_chunks(vector, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, integer, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.lexical_match_chunks(text, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lexical_match_chunks(text, integer, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.find_mentions_chunks(text, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mentions_chunks(text, integer, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.find_mentions_total(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mentions_total(text, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.match_similar_documents(uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_similar_documents(uuid, integer, uuid, text) TO service_role;
