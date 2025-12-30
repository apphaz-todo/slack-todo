import { supabase } from './supabase.js';

export async function sendReminders(client) {
  // Query overdue/incomplete tasks
  const { data: overdueTasks } = await supabase
    .from('tasks')
    .select('*')
    .lt('due_at', new Date().toISOString())
    .eq('status', 'open');

  for (const task of overdueTasks) {
    await client.chat.postMessage({
      channel: task.assigned_to,
      text: `🚨 Reminder: Task *${task.title}* is overdue!`,
    });
  }
}
