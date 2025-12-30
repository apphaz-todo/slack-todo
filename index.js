import pkg from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import { supabase } from './supabase.js';
import { handleHome } from './home.js';

dotenv.config();

const { App, ExpressReceiver } = pkg;

// Validate environment variables
const validateEnvVars = () => {
  if (!process.env.SLACK_BOT_TOKEN) throw new Error("Missing SLACK_BOT_TOKEN");
  if (!process.env.SLACK_SIGNING_SECRET) throw new Error("Missing SLACK_SIGNING_SECRET");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase configuration is missing or invalid");
  }
};
validateEnvVars();

console.log('🚀 Slack Todo starting');

// Initialize Slack App
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true,
});

// Middleware: Log requests
receiver.app.use((req, res, next) => {
  console.log('➡️ Slack request', {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'],
    hasSignature: !!req.headers['x-slack-signature'],
  });
  next();
});

// Slash command: /todo
app.command('/todo', async ({ command, ack, say, client }) => {
  await ack();
  const text = command.text.trim();
  const subcommand = text.split(' ')[0] || '';

  try {
    console.log(`📥 Received command: /todo ${subcommand}`);
    switch (subcommand) {
      case 'add': {
        const parts = text.replace(/^add\s*/, '').split(' ');
        const watchers = [];
        let due_at = null;
        let recurring = null;

        const words = parts.filter(part => {
          if (part.startsWith('<@')) {
            watchers.push(part.replace(/[<@>]/g, ''));
            return false;
          }
          if (part.startsWith('due:')) {
            due_at = part.replace('due:', '');
            return false;
          }
          if (part.startsWith('recurring:')) {
            recurring = part.replace('recurring:', '');
            return false;
          }
          return true;
        });

        const title = words.join(' ').trim();
        const assignedTo = watchers[0] || command.user_id;

        const { data, error } = await supabase.from('tasks').insert({
          title,
          created_by: command.user_id,
          assigned_to: assignedTo,
          watchers,
          due_at,
          recurring,
          channel_id: command.channel_id,
        }).select().single();

        if (error) throw new Error(`Failed to add task: ${error.message}`);

        await say(`✅ Task added: *${title}* (ID: ${data.id})`);
        break;
      }

      case 'list': {
        const { data, error } = await supabase.from('tasks')
          .select('*')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (error) throw new Error(`Failed to list tasks: ${error.message}`);

        if (!data || data.length === 0) {
          await say('🎉 No open tasks.');
        } else {
          await say(data.map(task => `• ${task.title} (ID: ${task.id})`).join('\n'));
        }
        break;
      }

      case 'done': {
        const taskId = text.replace(/^done\s*/, '').trim();
        const { error } = await supabase.from('tasks')
          .update({ status: 'done' })
          .eq('id', taskId);

        if (error) throw new Error(`Failed to complete task: ${error.message}`);
        await say('✅ Task marked as done.');
        break;
      }

      case 'search': {
        const query = text.replace(/^search\s*/, '').trim();
        const { data, error } = await supabase.from('tasks')
          .select('*')
          .ilike('title', `%${query}%`);

        if (error) throw new Error(`Search failed: ${error.message}`);

        if (!data || data.length === 0) {
          await say('🔍 No matching tasks found.');
        } else {
          await say(data.map(task => `• ${task.title}`).join('\n'));
        }
        break;
      }

      default: {
        await say('❓ Unknown subcommand. Usage: `/todo add|list|done|search`.\nExample: `/todo add Finish documentation`');
      }
    }
  } catch (err) {
    console.error('🔥 Error handling /todo:', err);
    await say('❌ An internal error occurred.');
  }
});

// App Home handler
app.event('app_home_opened', async ({ event, client }) => {
  try {
    await handleHome({ user: event.user, client });
  } catch (error) {
    console.error('Error in app_home_opened:', error);
  }
});

// Start Server
const server = express();
server.use('/slack/events', receiver.app);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`⚡ Slack Todo app is running on port ${PORT}`);
});
