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
   Helpers
------------------------------ */
async function publishHome(userId, client) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id,title,status')
    .eq('assigned_to', userId)
    .order('created_at', { ascending: false });

  const openTasks = tasks?.filter(t => t.status === 'open') || [];
  const doneTasks = tasks?.filter(t => t.status === 'done') || [];

  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '📝 Your Tasks' },
        },

        ...(openTasks.length
          ? openTasks.flatMap(task => [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `• *${task.title}*`,
                },
                accessory: {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ Done' },
                  action_id: 'task_done',
                  value: task.id,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '🗑️ Delete' },
                    action_id: 'task_delete',
                    value: task.id,
                  },
                ],
              },
            ])
          : [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: '📭 No open tasks' },
              },
            ]),

        { type: 'divider' },

        {
          type: 'header',
          text: { type: 'plain_text', text: '✅ Completed' },
        },

        ...(doneTasks.length
          ? doneTasks.map(task => ({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✔️ ${task.title}`,
              },
            }))
          : [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: '— None yet —' },
              },
            ]),
      ],
    },
  });
}

/* -----------------------------
   App Home Opened
------------------------------ */
app.event('app_home_opened', async ({ event, client }) => {
  console.log('🏠 Home opened:', event.user);
  await publishHome(event.user, client);
});

/* -----------------------------
   Button Actions
------------------------------ */
app.action('task_done', async ({ body, ack, client }) => {
  await ack();

  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', body.actions[0].value);

  await publishHome(body.user.id, client);
});

app.action('task_delete', async ({ body, ack, client }) => {
  await ack();

  await supabase
    .from('tasks')
    .delete()
    .eq('id', body.actions[0].value);

  await publishHome(body.user.id, client);
});

/* -----------------------------
   Slash Command
------------------------------ */
app.command('/todo', async ({ command, ack, respond, client }) => {
  await ack();

  const [sub, ...rest] = command.text.trim().split(' ');
  const text = rest.join(' ');

  switch (sub) {
    case 'add': {
      if (!text) {
        await respond('❌ `/todo add <task>`');
        return;
      }

      await supabase.from('tasks').insert({
        title: text,
        assigned_to: command.user_id,
        status: 'open',
      });

      await respond(`✅ Task added: *${text}*`);
      await publishHome(command.user_id, client);
      break;
    }

    case 'list': {
      const { data } = await supabase
        .from('tasks')
        .select('id,title')
        .eq('assigned_to', command.user_id)
        .eq('status', 'open');

      if (!data?.length) {
        await respond('📭 No open tasks');
        return;
      }

      await respond(
        '📝 Your tasks:\n' +
          data.map(t => `• (${t.id}) ${t.title}`).join('\n')
      );
      break;
    }

    case 'refresh':
      await publishHome(command.user_id, client);
      await respond('🔄 Home refreshed');
      break;

    default:
      await respond('❓ `/todo add | list | refresh`');
  }
});

/* -----------------------------
   Start
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
