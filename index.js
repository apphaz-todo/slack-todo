import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

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
   /todo Command
------------------------------ */
app.command('/todo', async ({ command, ack, say, logger }) => {
  await ack();

  const [sub, ...rest] = command.text.trim().split(' ');
  const text = rest.join(' ');

  try {
    switch (sub) {
      case 'add':
        if (!text) return say('❌ `/todo add <task>`');

        await supabase.from('tasks').insert({
          title: text,
          assigned_to: command.user_id,
          status: 'open',
        });

        await say(`✅ Added: *${text}*`);
        break;

      case 'list': {
        const { data } = await supabase
          .from('tasks')
          .select('id,title')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (!data?.length) return say('📭 No open tasks.');

        await say(
          '📝 Tasks:\n' +
            data.map(t => `• (${t.id}) ${t.title}`).join('\n')
        );
        break;
      }

      case 'done':
        if (!text) return say('❌ `/todo done <id>`');

        await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', text)
          .eq('assigned_to', command.user_id);

        await say(`✅ Task ${text} completed`);
        break;

      default:
        await say('❓ `/todo add | list | done`');
    }
  } catch (e) {
    logger.error(e);
    await say('❌ Error occurred');
  }
});

/* -----------------------------
   Start Server
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
