import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* -----------------------------
   ENV CHECK
------------------------------ */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('❌ Missing Supabase environment variables');
}

/* -----------------------------
   Slack App
------------------------------ */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

/* -----------------------------
   Supabase
------------------------------ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -----------------------------
   DB Health Check
------------------------------ */
async function checkDBConnection() {
  console.log('🔍 Checking Supabase connection...');

  const { data, error } = await supabase
    .from('tasks')
    .select('id')
    .limit(1);

  if (error) {
    console.error('❌ Supabase connection FAILED');
    console.error(error);
    process.exit(1);
  }

  console.log('✅ Supabase connected');
}

/* -----------------------------
   /todo Command
------------------------------ */
app.command('/todo', async ({ command, ack, respond, logger }) => {
  await ack();

  const [sub, ...rest] = command.text.trim().split(' ');
  const text = rest.join(' ');

  try {
    switch (sub) {
      case 'add': {
        if (!text) {
          await respond('❌ `/todo add <task>`');
          return;
        }

        console.log('➕ Inserting task:', text);

        const { data, error } = await supabase
          .from('tasks')
          .insert({
            title: text,
            assigned_to: command.user_id,
            status: 'open',
          })
          .select();

        if (error) {
          console.error('❌ Insert failed');
          console.error(error);
          await respond(`❌ DB Error: ${error.message}`);
          return;
        }

        console.log('✅ Insert success:', data);
        await respond(`✅ Task added: *${text}*`);
        break;
      }

      case 'list': {
        const { data, error } = await supabase
          .from('tasks')
          .select('id,title')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (error) {
          console.error(error);
          await respond('❌ Failed to fetch tasks');
          return;
        }

        if (!data.length) {
          await respond('📭 No open tasks.');
          return;
        }

        await respond(
          '📝 Your tasks:\n' +
            data.map(t => `• (${t.id}) ${t.title}`).join('\n')
        );
        break;
      }

      default:
        await respond('❓ `/todo add | list | done`');
    }
  } catch (e) {
    logger.error(e);
    await respond('❌ Unexpected error occurred');
  }
});

/* -----------------------------
   Start Server
------------------------------ */
(async () => {
  await checkDBConnection();
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
