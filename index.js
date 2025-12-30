import pkg from '@slack/bolt'
import dotenv from 'dotenv'
import express from 'express'
import { handleHome } from './home.js'
import { supabase } from './supabase.js'

dotenv.config()

const { App, ExpressReceiver } = pkg

console.log('🚀 Starting Slack Todo App')

// ─────────────────────────────────────────────
// ExpressReceiver (Slack handles body + signature)
// ─────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true
})

// ✅ SAFE logging (DO NOT touch body)
receiver.router.use((req, res, next) => {
  console.log('➡️ Slack request received', {
    method: req.method,
    originalUrl: req.originalUrl,
    contentType: req.headers['content-type'],
    hasSignature: !!req.headers['x-slack-signature']
  })
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
  console.log('📥 /todo command fired:', command.text)

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
  } else {
    await say('❓ Try `/todo add <task>`')
  }
})

// App Home
app.event('app_home_opened', handleHome)

// ─────────────────────────────────────────────
// Express Server (NO body parsers here)
// ─────────────────────────────────────────────
const server = express()

// ✅ Let Bolt handle EVERYTHING under this path
server.use('/slack/events', receiver.router)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`⚡ Slack Todo running on port ${PORT}`)
})
