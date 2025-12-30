import 'dotenv/config';
import { App } from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

/* -----------------------------
   Slack Bolt App Initialization
------------------------------ */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false, // IMPORTANT for Render / HTTP mode
  port: process.env.PORT || 3000,
});

/* -----------------------------
   Supabase Initialization
------------------------------ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -----------------------------
   /todo Slash Command
------------------------------ */
app.command('/todo', async ({ command, ack, say, logger }) => {
  await ack();

  const [subcommand, ...params] = command.text.trim().split(' ');
  const description = params.join(' ');

  try {
    switch (subcommand) {
      case 'add': {
        if (!description) {
          await say('❌ Usage: `/todo add <task description>`');
          return;
        }

        const { error } = await supabase
          .from('tasks')
          .insert({
            title: description,
            assigned_to: command.user_id,
            status: 'open',
          });

        if (error) {
          logger.error(error);
          await say('❌ Failed to add task.');
          return;
        }

        await say(`✅ Task added: *${description}*`);
        break;
      }

      case 'list': {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (error) {
          logger.error(error);
          await say('❌ Failed to fetch tasks.');
          return;
        }

        if (!data.length) {
          await say('📭 No open tasks.');
          return;
        }

        const list = data.map(t => `• (${t.id}) ${t.title}`).join('\n');
        await say(`📝 Your tasks:\n${list}`);
        break;
      }

      case 'done': {
        if (!description) {
          await say('❌ Usage: `/todo done <task_id>`');
          return;
        }

        const { error } = await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', description)
          .eq('assigned_to', command.user_id);

        if (error) {
          logger.error(error);
          await say('❌ Failed to complete task.');
          return;
        }

        await say(`✅ Task ${description} marked as complete.`);
        break;
      }

      case 'search': {
        if (!description) {
          await say('❌ Usage: `/todo search <keyword>`');
          return;
        }

        const { data, error } = await supabase
          .from('tasks')
          .select('id, title')
          .ilike('title', `%${description}%`)
          .eq('assigned_to', command.user_id);

        if (error) {
          logger.error(error);
          await say('❌ Search failed.');
          return;
        }

        if (!data.length) {
          await say('🔍 No matching tasks found.');
          return;
        }

        const list = data.map(t => `• (${t.id}) ${t.title}`).join('\n');
        await say(`🔍 Results:\n${list}`);
        break;
      }

      default:
        await say('❓ Usage: `/todo add | list | done | search`');
    }
  } catch (err) {
    logger.error(err);
    await say('❌ Unexpected error occurred.');
  }
});

/* -----------------------------
   Start App
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app is running');
})();
