// NPay ↔ Supabase connection.
// Fill these in from Supabase: Project Settings → API (or "Connect" → App frameworks).
// The anon public key is meant to be in website code; it can only do what the database's
// row-level security allows. Never put the service_role key here.
//
// You can also leave this file alone and set the GitHub Actions variables
// SUPABASE_URL and SUPABASE_ANON_KEY; the Pages deploy writes them in.
window.NPAY_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
