import { supabase } from './supabase.js'

export async function handleHome({ event, client }) {
  const user = event.user

  const { data: assigned } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', user)
    .eq('status', 'open')

  const { data: watching } = await supabase
    .from('tasks')
    .select('*')
    .contains('watchers', [user])

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Your Tasks' } }
  ]

  if (!assigned?.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No tasks 🎉_' } })
  } else {
    assigned.forEach(t => {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${t.title}*\nID: ${t.id}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Done' },
          action_id: 'task_done',
          value: t.id
        }
      })
    })
  }

  if (watching?.length) {
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Watching' } })
    watching.forEach(t =>
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `👀 ${t.title}` } })
    )
  }

  await client.views.publish({
    user_id: user,
    view: { type: 'home', blocks }
  })
}
