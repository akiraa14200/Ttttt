import { createClient } from '@supabase/supabase-js';

// Publishable keys are intended for browser use. Database access is protected by RLS.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://moicrqcddmftjgwjqkvz.supabase.co';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XrJYTYAGNjlfPsWlP1SfUg_-yr9HBrq';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
