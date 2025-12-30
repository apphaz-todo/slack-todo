import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// Test Supabase connection
export async function checkSupabaseConnection() {
  const { error } = await supabase
    .from('tasks')
    .select('id')
    .limit(1);

  if (error) {
    console.error('❌ Supabase connection test failed:', error);
    return false;
  }
  console.log('✅ Supabase connection validated');
  return true;
}
