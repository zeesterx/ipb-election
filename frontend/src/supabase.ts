import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://invalid.local';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing-publishable-key';

export const supabase = createClient(url, key);
export const devAdmin = import.meta.env.VITE_DEV_ADMIN === 'true';
