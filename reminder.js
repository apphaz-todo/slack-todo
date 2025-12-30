import dotenv from 'dotenv'
import pkg from '@slack/bolt'
import { supabase } from './supabase.js'

dotenv.config()
const { WebClient } = pkg
const slack = new WebClient(process.env.SLACK_BOT_TOKEN)

const now = new Date().toISOString()

const { data } = await supabase
  .from('reminders')
  .select('*, tasks(title, assigned_to)')
  .eq('sent', false)
  .lte('remind_at', now)

for (const r of data || []) {
  await slack.chat.postMessage({
    channel: r.tasks.assigned_to,
    text: `⏰ Reminder: *${r.tasks.title}*`
  })

  await supabase.from('reminders')
    .update({ sent: true })
    .eq('id', r.id)
}
