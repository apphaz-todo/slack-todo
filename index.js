import { App } from '@slack/bolt'
import dotenv from 'dotenv'
import { handleHome } from './home.js'
import { supabase } from './supabase.js'

dotenv.config()

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

app.event('app_home_opened', handleHome)

app.command('/todo', async ({ command, ack, say }) => {
  await ack()

  const text = command.text.trim()

  if (text.startsWith('add')) {
    const title = text.replace('add', '').trim()

    await supabase.from('tasks').insert({
      title,
      created_by: command.user_id,
      assigned_to: command.user_id
    })

    await say(`✅ Task added: *${title}*`)
  }

  if (text === 'list') {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', command.user_id)
      .eq('status', 'open')

    if (!data.length) {
      await say('🎉 No open tasks')
      return
    }

    const list = data.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    await say(`📝 *Your Tasks*\n${list}`)
  }
})

(async () => {
  await app.start(process.env.PORT || 3000)
  console.log('⚡ Slack Todo running')
})()
