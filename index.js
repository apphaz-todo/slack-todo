import pkg from '@slack/bolt'
import dotenv from 'dotenv'
import express from 'express'
import { handleHome } from './home.js'
import { supabase } from './supabase.js'

dotenv.config()

const { App, ExpressReceiver } = pkg

// 👇 Explicit receiver (IMPORTANT)
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

// 👇 Bolt App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
})

// 👇 Slash command
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
    return
  }

  if (text === 'list') {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', command.user_id)
      .eq('status', 'open')

    if (!data || data.length === 0) {
      await say('🎉 No open tasks')
      return
    }

    const list = data.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
    await say(`📝 *Your Tasks*\n${list}`)
  }
})

// 👇 App Home
app.event('app_home_opened', handleHome)

// 👇 Start Express manually (Render-friendly)
const server = express()
server.use('/slack/events', receiver.router)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`⚡ Slack Todo running on port ${PORT}`)
})
