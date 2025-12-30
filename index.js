import pkg from '@slack/bolt'
import dotenv from 'dotenv'
import express from 'express'
import { handleHome } from './home.js'
import { supabase } from './supabase.js'

dotenv.config()

const { App, ExpressReceiver } = pkg

console.log('🚀 Starting Slack Todo App')

// ─────────────────────────────────────────────
// Express Receiver
// ─────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

// 🔍 SAFE request logger
receiver.router.use((req, res, next) => {
  console.log('➡️ Incoming Slack request')
  console.log('METHOD:', req.method)
  console.log('ORIGINAL URL:', req.originalUrl)
  console.log('ROUTER URL:', req.url)
  console.log('HEADERS:', {
    'content-type': req.headers['content-type'],
    'x-slack-signature': req.headers['x-slack-signature'] ? 'PRESENT' : 'MISSING'
  })
  console.log('BODY:', req.body)
  next()
})

// ─────────────────────────────────────────────
// Bolt App
// ─────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
})

// Slash command
app.command('/todo', async ({ command, ack, say }) => {
  console.log('📥 /todo command received:', command.text)
  await ack()

  if (command.text.startsWith('add')) {
    const title = command.text.replace(/^add/i, '').trim()

    await supabase.from('tasks').insert({
      title,
      created_by: command.user_id,
      assigned_to: command.user_id,
      channel_id: command.channel_id
    })

    await say(`✅ Task added: *${title}*`)
  }
})

// App Home
app.event('app_home_opened', handleHome)

// ─────────────────────────────────────────────
// Express Server (CORRECT ORDER)
// ─────────────────────────────────────────────
const server = express()

// ⚠️ DO NOT add body parsers before Bolt

// Slack URL verification (handled BEFORE Bolt)
server.post('/slack/events', express.json(), (req, res, next) => {
  if (req.body?.type === 'url_verification') {
    console.log('🧩 Slack URL verification challenge received')
    return res.json({ challenge: req.body.challenge })
  }
  next()
})

// ✅ Pass ALL Slack traffic to Bolt
server.use('/slack/events', receiver.router)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`⚡ Slack Todo running on port ${PORT}`)
})
