import pkg from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import bodyParser from 'body-parser';
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
console.log('Environment Check:', {
  SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET: !!process.env.SLACK_SIGNING_SECRET,
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_KEY: !!process.env.SUPABASE_ANON_KEY,
});

// Initialize Slack App
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true,
});

// Ensure correct parsing middleware
receiver.app.use(bodyParser.urlencoded({ extended: true }));
receiver.app.use(bodyParser.json());

// Middleware: Log requests
receiver.app.use((req, res, next) => {
  console.log('➡️ Slack request', {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'],
    hasSignature: !!req.headers['x-slack-signature'],
    headers: req.headers,
    body: req.body,
  });
  next();
});

// Slash command: /todo
app.command('/todo', async ({ command, ack, say, client }) => {
  console.log('📥 Handling /todo command with data:', JSON.stringify(command, null, 2));
  try {
    await ack(); // Acknowledge the request
    console.log('✅ Acknowledged /todo command');

    const text = command.text.trim();
    const subcommand = text.split(' ')[0] || '';
    console.log(`📥 Subcommand: ${subcommand}`);

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
        console.log('Add command parsed:', { watchers, due_at, recurring, words });

        const title = words.join(' ').trim();
        const assignedTo = watchers[0] || command.user_id;
        console.log('Title and assigned user:', { title, assignedTo });

        const { data, error } = await supabase.from('tasks').insert({
          title,
          created_by: command.user_id,
          assigned_to: assignedTo,
          watchers,
          due_at,
          recurring,
          channel_id: command.channel_id,
        }).select().single();

        if (error) {
          console.error('❌ Error inserting task:', error);
          throw new Error(`Failed to add task: ${error.message}`);
        }

        console.log('✅ Task added:', data);
        await say(`✅ Task added: *${title}* (ID: ${data.id})`);
        break;
      }

      case 'list': {
        console.log('Fetching tasks for list command...');
        const { data, error } = await supabase.from('tasks')
          .select('*')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (error) {
          console.error('❌ Error fetching tasks:', error);
          throw new Error(`Failed to list tasks: ${error.message}`);
        }

        console.log('Tasks fetched:', data);
        if (!data || data.length === 0) {
          await say('🎉 No open tasks.');
        } else {
          await say(data.map(task => `• ${task.title} (ID: ${task.id})`).join('\n'));
        }
        break;
      }

      case 'done': {
        const taskId = text.replace(/^done\s*/, '').trim();
        console.log('Marking task as done:', taskId);

        const { error } = await supabase.from('tasks')
          .update({ status: 'done' })
          .eq('id', taskId);

        if (error) {
          console.error('❌ Error updating task:', error);
          throw new Error(`Failed to complete task: ${error.message}`);
        }

        console.log('✅ Task marked as done.');
        await say('✅ Task marked as done.');
        break;
      }

      case 'search': {
        const query = text.replace(/^search\s*/, '').trim();
        console.log('Searching tasks with query:', query);

        const { data, error } = await supabase.from('tasks')
          .select('*')
          .ilike('title', `%${query}%`);

        if (error) {
          console.error('❌ Search error:', error);
          throw new Error(`Search failed: ${error.message}`);
        }

        console.log('Search results:', data);
        if (!data || data.length === 0) {
          await say('🔍 No matching tasks found.');
        } else {
          await say(data.map(task => `• ${task.title}`).join('\n'));
        }
        break;
      }

      default: {
        await say('❓ Unknown subcommand. Usage: `/todo add|list|done|search`.\nExample: `/todo add Finish documentation`');
        console.log('Unknown subcommand received:', subcommand);
      }
    }
  } catch (err) {
    console.error('🔥 Error handling /todo command:', err);
    await say('❌ An internal error occurred.');
  }
});

// App Home handler
app.event('app_home_opened', async ({ event, client }) => {
  console.log('🏠 App Home opened event:', event);
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

server.listen(PORT, (err) => {
  if (err) {
    console.error('Failed to start server:', err);
  } else {
    console.log(`⚡ Slack Todo app is running on port ${PORT}`);
  }
});
