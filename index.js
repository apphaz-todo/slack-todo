import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* -------------------------------------------------
   ENV CHECK
-------------------------------------------------- */
console.log('🔍 Checking environment variables...');
if (
  !process.env.SLACK_BOT_TOKEN ||
  !process.env.SLACK_SIGNING_SECRET ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error('❌ Missing environment variables');
  throw new Error('Missing environment variables');
}
console.log('✅ Environment variables OK');

/* -------------------------------------------------
   SLACK APP
-------------------------------------------------- */
console.log('⚙️ Initializing Slack app...');
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});
console.log('✅ Slack app initialized');

/* -------------------------------------------------
   SUPABASE
-------------------------------------------------- */
console.log('⚙️ Initializing Supabase...');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
console.log('✅ Supabase client ready');

/* -------------------------------------------------
   HOME TAB RENDER
-------------------------------------------------- */
async function publishHome(userId, client, activeTab = 'home') {
  console.log(`🏠 Rendering Home tab for user: ${userId}, tab: ${activeTab}`);

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Supabase fetch error:', error);
    return;
  }

  console.log(`📦 Tasks fetched: ${tasks.length}`);

  const openTasks = tasks.filter(t => t.status === 'open');
  console.log(`📝 Open tasks: ${openTasks.length}`);

  const blocks = [];

  /* ---------- TOP FILTER TABS ---------- */
  blocks.push({
    type: 'actions',
    elements: [
      tabButton('Home', 'home', activeTab),
      tabButton('Completed', 'completed', activeTab),
      tabButton('Archived', 'archived', activeTab),
      tabButton('Delegated', 'delegated', activeTab),
      tabButton('Watching', 'watching', activeTab),
    ],
  });

  blocks.push({ type: 'divider' });

  /* ---------- TODAY HEADER ---------- */
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📅 Today' },
  });

  /* ---------- TASK LIST ---------- */
  if (!openTasks.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No tasks for today' },
    });
  }

  for (const task of openTasks) {
    console.log(`➡️ Rendering task: ${task.id} - ${task.title}`);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚩 *${task.title}*`,
      },
    });

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `Owner: <@${task.created_by}> | Assignee: <@${task.assigned_to}>` +
            (task.note ? `\n📝 ${task.note}` : ''),
        },
      ],
    });

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
  }

  /* ---------- BOTTOM UTILITY BAR ---------- */
  blocks.push({
    type: 'actions',
    elements: [
      utilityButton('🔍 Search', 'search'),
      utilityButton('🆕 New task', 'new_task'),
      utilityButton('⚙️ Settings', 'settings'),
      utilityButton('💬 Support', 'support'),
      utilityButton('❓ Help', 'help'),
    ],
  });

  console.log('📤 Publishing Home tab...');
  await client.views.publish({
    user_id: userId,
    view: { type: 'home', blocks },
  });
  console.log('✅ Home tab published');
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
   EVENTS & ACTIONS
-------------------------------------------------- */
app.event('app_home_opened', async ({ event, client }) => {
  console.log(`🏠 Home opened by ${event.user}`);
  await publishHome(event.user, client);
});

app.action('home_tab', async ({ body, ack, client }) => {
  await ack();
  console.log(`🔁 Tab switched to: ${body.actions[0].value}`);
  await publishHome(body.user.id, client, body.actions[0].value);
});

app.action('task_complete', async ({ body, ack, client }) => {
  await ack();
  const taskId = body.actions[0].value;
  console.log(`✅ Completing task: ${taskId}`);

  await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId);
  await publishHome(body.user.id, client);
});

app.action('task_view', async ({ body, ack, client }) => {
  await ack();
  const taskId = body.actions[0].value;
  console.log(`👁 Viewing task: ${taskId}`);

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Task details' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${task.title}*` } },
        ...(task.note
          ? [{ type: 'section', text: { type: 'mrkdwn', text: task.note } }]
          : []),
      ],
    },
  });
});

/* -------------------------------------------------
   SLASH COMMAND
-------------------------------------------------- */
app.command('/todo', async ({ command, ack, client }) => {
  await ack();
  console.log(`/todo invoked by ${command.user_id}`);

  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'create_task',
      title: { type: 'plain_text', text: 'New task' },
      submit: { type: 'plain_text', text: 'Create' },
      blocks: [
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'title',
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

app.view('create_task', async ({ ack, body, view, client }) => {
  await ack();
  console.log('➕ Creating new task');

  const title = view.state.values.title_block.title.value;
  const note = view.state.values.note_block?.note?.value || null;

  await supabase.from('tasks').insert({
    title,
    note,
    status: 'open',
    created_by: body.user.id,
    assigned_to: body.user.id,
  });

  console.log('✅ Task created');
  await publishHome(body.user.id, client);
});

/* -------------------------------------------------
   START
-------------------------------------------------- */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
