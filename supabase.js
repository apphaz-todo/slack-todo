import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────
// DEBUG: Supabase ENV sanity check
// ─────────────────────────────────────────────
console.log('🗄️ Initializing Supabase client')
console.log('SUPABASE ENV CHECK:', {
  hasUrl: !!process.env.SUPABASE_URL,
  hasAnonKey: !!process.env.SUPABASE_ANON_KEY,
  urlPreview: process.env.SUPABASE_URL
    ? process.env.SUPABASE_URL.substring(0, 30) + '...'
    : 'MISSING'
})

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false
    }
  }
)

// ─────────────────────────────────────────────
// DEBUG HELPERS (OPTIONAL USE)
// ─────────────────────────────────────────────
export async function debugSupabaseConnection() {
  console.log('🔎 Testing Supabase connection...')

  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .limit(1)

  if (error) {
    console.error('❌ Supabase connection FAILED:', error)
    return false
  }

  console.log('✅ Supabase connection OK')
  return true
}
