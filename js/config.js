// NPay ↔ Supabase connection.
// From Supabase: Project Settings → Data API (URL) and API Keys (publishable key).
// The publishable (anon) key is meant to be in website code; it can only do what the database's
// row-level security allows. Never put the service_role key here.
//
// You can also leave this file alone and set the GitHub Actions variables
// SUPABASE_URL and SUPABASE_ANON_KEY; the Pages deploy writes them in.
window.NPAY_CONFIG = {
  supabaseUrl: "https://xlexhmoaatjtdmawkvbe.supabase.co",
  supabaseAnonKey: "sb_publishable_C_889ts17viVCSrAIp_FVA_wIFBnSzd",
};
