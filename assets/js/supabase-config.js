import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const SUPABASE_URL = 'https://oloivzcaqhodkzyxswsq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_nseZ7xRqcEO2TPBOAKwQHA_xHQKGrgr';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
