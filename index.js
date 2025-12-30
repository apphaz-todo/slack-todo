import pkg from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import { supabase } from './supabase.js';
import { handleHome } from './home.js';
import { sendReminders } from './reminder.js';

dotenv.config();
const { App, ExpressReceiver } = pkg;

// Initialize ExpressReceiver and Slack App
const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver });

// Command: Add, List, Complete, or Search Tasks
app.command('/todo', async ({ command, ack, say }) => {
  await ack();

  const [subcommand, ...params] = command.text.trim().split(' ');
  const description = params.join(' ');

  try {
    switch (subcommand) {
      case 'add': {
        const { error } = await supabase.from('tasks').insert({
          title: description,
          assigned_to: command.user_id,
          watchers: [],
          status: 'open',
        });

        if (error) throw error;
        await say(`✅ Task added: ${description}`);
        break;
      }

      case 'list': {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (tasks?.length) {
          await say(`📋 Your open tasks:\n${tasks.map((t) => `• ${t.title}`).join('\n')}`);
        } else {
          await say('🎉 No tasks assigned to you.');
        }
        break;
      }

      case 'done': {
        const taskId = description; // Assuming taskId is provided
        const { error } = await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', taskId);

        if (error) throw error;
        await say(`✅ Task ${taskId} marked as complete.`);
        break;
      }

      case 'search': {
        const query = description;
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .ilike('title', `%${query}%`);

        if (tasks?.length) {
          await say(`🔎 Search results:\n${tasks.map((t) => `• ${t.title}`).join('\n')}`);
        } else {
          await say('🔍 No matching tasks found.');
        }
        break;
      }

      default:
        await say('❓ Unknown command. Use `/todo add|list|done|search`.');
    }
  } catch (error) {
    console.error('Error handling /todo command:', error);
    await say('❌ Something went wrong. Please try again.');
  }
});

// Event: App Home Opened
app.event('app_home_opened', async (event) => {
  await handleHome({ event, client: app.client });
});

// Start Server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => console.log(`⚡ Slack app is running on port ${port}`));
