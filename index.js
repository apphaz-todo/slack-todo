import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* -------------------------------------------------
   ENV CHECK
-------------------------------------------------- */
if (
  !process.env.SLACK_BOT_TOKEN ||
  !process.env.SLACK_SIGNING_SECRET ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error('❌ Missing environment variables');
}

/* -------------------------------------------------
   SLACK APP
-------------------------------------------------- */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

/* -------------------------------------------------
   SUPABASE
-------------------------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------------------------------------
   HOME TAB RENDER
-------------------------------------------------- */
async function publishHome(userId, client, activeTab = 'home') {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('created_at', { ascending: true });

  const openTasks = (tasks || []).filter(t => t.status === 'open');

  const blocks = [];

  /* -------- TOP FILTER TABS -------- */
  blocks.push({
    type: 'actions',
    elements: [
      tabButton('Home', 'home', activeTab),
      tabButton('Completed (0)', 'completed', activeTab),
      tabButton('Archived (0)', 'archived', activeTab),
      tabButton('Delegated (0)', 'delegated', activeTab),
      tabButton('Watching (0)', 'watching', activeTab),
    ],
  });

  blocks.push({ type: 'divider' });

  /* -------- TODAY HEADER -------- */
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📅 Today' },
  });

  /* -------- TASK LIST -------- */
  if (!openTasks.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No tasks for today' },
    });
  }

  openTasks.forEach(task => {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚩 *${task.title}*`,
      },
    });

    if (task.note) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📝 ${task.note}`,
          },
        ],
      });
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Complete' },
          style: 'primary',
          action_id: 'task_complete',
          value: task.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View' },
          action_id: 'task_view',
          value: task.id,
        },
      ],
    });

    blocks.push({ type: 'divider' });
  });

  /* -------- BOTTOM UTILITY BAR -------- */
  blocks.push({
    type: 'actions',
    elements: [
      utilityButton('🔍 Search', 'search'),
      utilityButton('🆕 New task', 'new_task'),
      utilityButton('⚙️ Personal settings', 'settings'),
      utilityButton('💬 Support', 'support'),
      utilityButton('❓ Help', 'help'),
    ],
  });

  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks,
    },
  });
}

/* -------------------------------------------------
   HELPERS
-------------------------------------------------- */
function tabButton(text, value, current) {
  return {
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: 'home_tab',
    value,
    style: value === current ? 'primary' : undefined,
  };
}

function utilityButton(text, value) {
  return {
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: `util_${value}`,
    value,
  };
}

/* -------------------------------------------------
   HOME OPEN EVENT
-------------------------------------------------- */
app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* -------------------------------------------------
   TAB SWITCH
-------------------------------------------------- */
app.action('home_tab', async ({ body, ack, client }) => {
  await ack();
  await publishHome(body.user.id, client, body.actions[0].value);
});

/* -------------------------------------------------
   COMPLETE TASK
-------------------------------------------------- */
app.action('task_complete', async ({ body, ack, client }) => {
  await ack();

  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', body.actions[0].value);

  await publishHome(body.user.id, client);
});

/* -------------------------------------------------
   VIEW TASK (MODAL)
-------------------------------------------------- */
app.action('task_view', async ({ body, ack, client }) => {
  await ack();

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', body.actions[0].value)
    .single();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Task details' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${task.title}*` },
        },
        ...(task.note
          ? [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: task.note },
              },
            ]
          : []),
      ],
    },
  });
});

/* -------------------------------------------------
   /todo COMMAND (CREATE TASK)
-------------------------------------------------- */
app.command('/todo', async ({ command, ack, client }) => {
  await ack();

  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'create_task',
      title: { type: 'plain_text', text: 'New task' },
      submit: { type: 'plain_text', text: 'Create' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'title',
            placeholder: {
              type: 'plain_text',
              text: 'What needs to be done?',
            },
          },
        },
        {
          type: 'input',
          block_id: 'note_block',
          optional: true,
          label: { type: 'plain_text', text: 'Note' },
          element: {
            type: 'plain_text_input',
            action_id: 'note',
            multiline: true,
          },
        },
      ],
    },
  });
});

/* -------------------------------------------------
   CREATE TASK SUBMIT
-------------------------------------------------- */
app.view('create_task', async ({ ack, body, view, client }) => {
  await ack();

  const title = view.state.values.title_block.title.value;
  const note = view.state.values.note_block?.note?.value || null;

  await supabase.from('tasks').insert({
    title,
    note,
    status: 'open',
    created_by: body.user.id,
    assigned_to: body.user.id,
  });

  await publishHome(body.user.id, client);
});

/* -------------------------------------------------
   START
-------------------------------------------------- */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
