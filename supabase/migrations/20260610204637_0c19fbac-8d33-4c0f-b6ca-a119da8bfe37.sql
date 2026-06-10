
-- RLS on storage.objects for manual-pdfs bucket: admin-only via has_role.
CREATE POLICY "Admins read manual-pdfs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'manual-pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write manual-pdfs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'manual-pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update manual-pdfs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'manual-pdfs' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'manual-pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete manual-pdfs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'manual-pdfs' AND public.has_role(auth.uid(), 'admin'));
