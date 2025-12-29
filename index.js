import pkg from '@slack/bolt'
import dotenv from 'dotenv'
import express from 'express'
import { handleHome } from './home.js'
import { supabase } from './supabase.js'

dotenv.config()

const { App, ExpressReceiver } = pkg

// ─────────────────────────────────────────────
// DEBUG: Startup env check
// ─────────────────────────────────────────────
console.log('🚀 Starting Slack Todo App')
console.log('ENV CHECK:', {
  hasBotToken: !!process.env.SLACK_BOT_TOKEN,
  hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
  hasSupabaseUrl: !!process.env.SUPABASE_URL
})

// ─────────────────────────────────────────────
// Express Receiver (Slack Webhook Entry Point)
// ─────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

// Debug ALL incoming Slack HTTP requests
receiver.router.use((req, res, next) => {
  console.log('➡️ Incoming Slack request:', req.method, req.url)
  next()
})

// ─────────────────────────────────────────────
// Slack Bolt App
// ─────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
})

// ─────────────────────────────────────────────
// Slash Command: /todo
// ─────────────────────────────────────────────
app.command('/todo', async ({ command, ack, say }) => {
  console.log('📥 /todo command received')
  console.log('Command payload:', {
    text: command.text,
    user: command.user_id,
    channel: command.channel_id
  })

  try {
    await ack()
    console.log('✅ ACK sent to Slack')

    const text = command.text.trim()

    if (text.startsWith('add')) {
      const title = text.replace(/^add/i, '').trim()

      console.log('📝 Adding task:', title)

      const { error } = await supabase.from('tasks').insert({
        title,
        created_by: command.user_id,
        assigned_to: command.user_id,
        channel_id: command.channel_id
      })

      if (error) {
        console.error('❌ Supabase insert error:', error)
        await say('❌ Failed to add task')
        return
      }

      await say(`✅ Task added: *${title}*`)
      console.log('✅ Task added successfully')
      return
    }

    if (text === 'list') {
      console.log('📋 Listing tasks')

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', command.user_id)
        .eq('status', 'open')

      if (error) {
        console.error('❌ Supabase fetch error:', error)
        await say('❌ Failed to fetch tasks')
        return
      }

      if (!data || data.length === 0) {
        await say('🎉 No open tasks')
        return
      }

      const list = data.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
      await say(`📝 *Your Tasks*\n${list}`)
      console.log('✅ Task list sent')
      return
    }

    await say('❓ Unknown command. Try `/todo add <task>` or `/todo list`')
  } catch (err) {
    console.error('🔥 ERROR inside /todo handler:', err)
  }
})

// ─────────────────────────────────────────────
// App Home Event
// ─────────────────────────────────────────────
app.event('app_home_opened', async (payload) => {
  console.log('🏠 App Home opened by user:', payload.event.user)
  await handleHome(payload)
})

// ─────────────────────────────────────────────
// Start Express Server (Render-friendly)
// ─────────────────────────────────────────────

const server = express()

// Needed to read Slack's challenge payload
server.use(express.json())

// 👇 Handle Slack URL verification explicitly
server.post('/slack/events', (req, res, next) => {
  if (req.body && req.body.type === 'url_verification') {
    console.log('🧩 Slack URL verification challenge received')
    return res.status(200).json({ challenge: req.body.challenge })
  }
  next()
})

// 👇 Pass all other Slack events to Bolt
server.use('/slack/events', receiver.router)



const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`⚡ Slack Todo running on port ${PORT}`)
})
