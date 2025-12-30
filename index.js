import pkg from '@slack/bolt'
import dotenv from 'dotenv'
import express from 'express'
import { supabase } from './supabase.js'
import { handleHome } from './home.js'

dotenv.config()

const { App, ExpressReceiver } = pkg

console.log('🚀 Slack Todo starting')
console.log('ENV CHECK:', {
  hasBotToken: !!process.env.SLACK_BOT_TOKEN,
  hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
  hasSupabase: !!process.env.SUPABASE_URL
})

/* ---------------- RECEIVER ---------------- */

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

// SAFE request logging (no body access)
receiver.app.use((req, res, next) => {
  console.log('➡️ Slack request', {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'],
    hasSignature: !!req.headers['x-slack-signature']
  })
  next()
})

/* ---------------- APP ---------------- */

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true, // 🔥 CRITICAL FIX
  logLevel: 'INFO'
})

/* ---------------- SLASH COMMAND ---------------- */

app.command('/todo', async ({ command, ack, say, client }) => {
  // 🔥 MUST BE FIRST
  await ack()

  try {
    const text = command.text.trim()
    console.log('📥 /todo', {
      user: command.user_id,
      channel: command.channel_id,
      text
    })

    /* ADD */
    if (text.startsWith('add')) {
      const parts = text.replace(/^add/i, '').trim().split(' ')
      const watchers = []
      let due_at = null
      let recurring = null

      const words = parts.filter(p => {
        if (p.startsWith('<@')) {
          watchers.push(p.replace(/[<@>]/g, ''))
          return false
        }
        if (p.startsWith('due:')) {
          due_at = p.replace('due:', '')
          return false
        }
        if (p.startsWith('recurring:')) {
          recurring = p.replace('recurring:', '')
          return false
        }
        return true
      })

      const title = words.join(' ')
      const assigned = watchers[0] || command.user_id

      const { data, error } = await supabase
        .from('tasks')
        .insert({
          title,
          created_by: command.user_id,
          assigned_to: assigned,
          watchers,
          due_at,
          recurring,
          channel_id: command.channel_id
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Supabase insert failed', error)
        await say('❌ Failed to create task')
        return
      }

      await say(`✅ Task added: *${title}* (ID: ${data.id})`)

      for (const w of watchers) {
        await client.chat.postMessage({
          channel: w,
          text: `👀 You are watching task: *${title}*`
        })
      }
      return
    }

    /* LIST */
    if (text === 'list') {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', command.user_id)
        .eq('status', 'open')

      if (error) {
        console.error('❌ Supabase list failed', error)
        await say('❌ Failed to fetch tasks')
        return
      }

      if (!data?.length) {
        await say('🎉 No open tasks')
        return
      }

      await say(
        data.map(t => `• ${t.title} (ID: ${t.id})`).join('\n')
      )
      return
    }

    /* DONE */
    if (text.startsWith('done')) {
      const id = text.replace('done', '').trim()

      const { data: task } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', id)
        .single()

      if (!task) {
        await say('❌ Task not found')
        return
      }

      await supabase
        .from('tasks')
        .update({ status: 'done' })
        .eq('id', id)

      if (task.recurring) {
        const next = new Date()
        if (task.recurring === 'daily') next.setDate(next.getDate() + 1)
        if (task.recurring === 'weekly') next.setDate(next.getDate() + 7)
        if (task.recurring === 'monthly') next.setMonth(next.getMonth() + 1)

        await supabase.from('tasks').insert({
          title: task.title,
          created_by: task.created_by,
          assigned_to: task.assigned_to,
          recurring: task.recurring,
          due_at: next
        })
      }

      await say('✅ Task completed')
      return
    }

    /* SEARCH */
    if (text.startsWith('search')) {
      const q = text.replace('search', '').trim()

      const { data } = await supabase
        .from('tasks')
        .select('*')
        .ilike('title', `%${q}%`)

      if (!data?.length) {
        await say('🔍 No results')
        return
      }

      await say(data.map(t => `• ${t.title}`).join('\n'))
      return
    }

    await say('Usage: `/todo add|list|done|search`')

  } catch (err) {
    console.error('🔥 /todo handler error', err)
    await say('❌ Internal error')
  }
})

/* ---------------- APP HOME ---------------- */

app.event('app_home_opened', async (payload) => {
  console.log('🏠 App Home opened by', payload.event.user)
  await handleHome(payload)
})

/* ---------------- BUTTON ---------------- */

app.action('task_done', async ({ body, ack, client }) => {
  await ack()

  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', body.actions[0].value)

  await handleHome({ event: { user: body.user.id }, client })
})

/* ---------------- MESSAGE → TASK ---------------- */

app.shortcut('add_to_todo', async ({ shortcut, ack, client }) => {
  await ack()

  await supabase.from('tasks').insert({
    title: shortcut.message.text,
    created_by: shortcut.user.id,
    assigned_to: shortcut.user.id,
    channel_id: shortcut.channel.id
  })

  await client.chat.postEphemeral({
    channel: shortcut.channel.id,
    user: shortcut.user.id,
    text: '✅ Message added as task'
  })
})

/* ---------------- SERVER ---------------- */

const server = express()
server.use('/slack/events', receiver.app)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`⚡ Slack Todo running on port ${PORT}`)
})
