import pkg from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import bodyParser from 'body-parser';
import { supabase } from './supabase.js';

dotenv.config();

const { App, ExpressReceiver } = pkg;

// Step 1: Validate environment variables
const validateEnvVars = () => {
  if (!process.env.SLACK_SIGNING_SECRET) throw new Error('Missing SLACK_SIGNING_SECRET');
  if (!process.env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
  if (!process.env.SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
};
validateEnvVars();

// Logging environment check
console.log('Environment variables loaded successfully.');

// Step 2: Configure ExpressReceiver and Parsing
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Parse both JSON and URL-encoded payloads
receiver.app.use(bodyParser.urlencoded({ extended: true }));
receiver.app.use(bodyParser.json());

// Log all incoming HTTP requests
receiver.app.use((req, res, next) => {
  console.log('➡️ Incoming Request:', {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'],
    body: req.body,
  });
  next();
});

// Step 3: Bootstrap Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true,
});

// Slash Command Handler
app.command('/todo', async ({ command, ack, say }) => {
  console.log('📥 Handling /todo command:', command);

  try {
    await ack(); // Acknowledge the request immediately
    const text = command.text ? command.text.trim() : '';

    if (!text) {
      await say('❓ Please provide a valid subcommand: `add`, `list`, `done`, or `search`.');
      return;
    }

    console.log('✅ Parsed text:', text);
    // Handle subcommands like "add", "list", etc.
  } catch (error) {
    console.error('🔥 Error occurred processing /todo:', error);
    await say('❌ An error occurred. Please try again later.');
  }
});

// Shortcut Event Example: unified_todo
app.shortcut('unified_todo', async ({ shortcut, ack, client }) => {
  console.log('Shortcut received:', shortcut);
  try {
    await ack();
    await client.chat.postEphemeral({
      channel: shortcut.channel.id,
      user: shortcut.user.id,
      text: '✅ Shortcut successfully handled!',
    });
  } catch (error) {
    console.error('Error processing shortcut:', error);
  }
});

// Step 4: Start Server
const server = express();
const PORT = process.env.PORT || 3000;
server.use('/slack/events', receiver.app);

server.listen(PORT, () => {
  console.log(`⚡️ Slack Todo app is running on port ${PORT}`);
});
