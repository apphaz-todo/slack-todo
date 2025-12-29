import { supabase } from './supabase.js'

export async function handleHome({ event, client }) {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', event.user)
    .eq('status', 'open')

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Your Tasks' } },
    ...(data || []).map(task => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `• ${task.title}` }
    }))
  ]

  await client.views.publish({
    user_id: event.user,
    view: { type: 'home', blocks }
  })
}
