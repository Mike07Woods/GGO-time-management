// src/supabaseClient.js
// Creates a single, shared Supabase client for the whole app.
// All keys come from environment variables — nothing is hardcoded here.

import { createClient } from '@supabase/supabase-js';

// These are injected at build time by Create React App from the .env file.
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Fail loudly (but don't crash) if the environment is not configured yet.
if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[GGO] Missing Supabase environment variables. ' +
      'Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in your .env file, ' +
      'then restart the dev server.'
  );
}

// Export ONE client instance and reuse it everywhere.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Keep the user logged in across page refreshes and restore the session automatically.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
