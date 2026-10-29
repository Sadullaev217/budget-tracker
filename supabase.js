// Supabase client. Loaded after the CDN script, before auth.js.
// The publishable key is designed for client-side use — RLS protects the data.
const SUPABASE_URL = 'https://zcdxjokksvkxhywxnjlm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Xd7dkYkwxShimkS51zzkXA_XYvODSyZ';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
