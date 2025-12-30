import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* =================================================
   ENV CHECK
================================================= */
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

/* =================================================
   SLACK APP INIT
================================================= */
console.log('⚙️ Initializing Slack app...');
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});
console.log('✅ Slack app initialized');

/* =================================================
   SUPABASE INIT
================================================= */
console.log('⚙️ Initializing Supabase...');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
console.log('✅ Supabase client ready');

/* =================================================
   HOME TAB RENDER
================================================= */
async function publishHome(userId, client, activeTab = 'home') {
  console.log(`🏠 Publishing Home tab | user=${userId} | tab=${activeTab}`);

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId},watchers.cs.{${userId}}`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Supabase fetch error:', error);
    return;
  }

  console.log(`📦 Total tasks fetched: ${tasks.length}`);

  /* -------- TAB FILTERING -------- */
  let filteredTasks = [];
  if (activeTab === 'home') {
    filteredTasks = tasks.filter(t => t.status === 'open');
  } else if (activeTab === 'completed') {
    filteredTasks = tasks.filter(t => t.status === 'done');
  } else if (activeTab === 'archived') {
    filteredTasks = tasks.filter(t => t.status === 'archived');
  } else if (activeTab === 'delegated') {
    filteredTasks = tasks.filter(
      t => t.created_by === userId && t.assigned_to !== userId
    );
  } else if (activeTab === 'watching') {
    filteredTasks = tasks.filter(
      t => Array.isArray(t.watchers) && t.watchers.includes(userId)
    );
  }

  console.log(`📝 Filtered tasks (${activeTab}): ${filteredTasks.length}`);

  /* -------- COUNTS -------- */
  const counts = {
    home: tasks.filter(t => t.status === 'open').length,
    completed: tasks.filter(t => t.status === 'done').length,
    archived: tasks.filter(t => t.status === 'archived').length,
    delegated: tasks.filter(
      t => t.created_by === userId && t.assigned_to !== userId
    ).length,
    watching: tasks.filter(
      t => Array.isArray(t.watchers) && t.watchers.includes(userId)
    ).length,
  };

  const blocks = [];

  /* -------- TOP FILTER TABS -------- */
  blocks.push({
    type: 'actions',
    elements: [
      tabButton(`Home (${counts.home})`, 'home', activeTab),
      tabButton(`Completed (${counts.completed})`, 'completed', activeTab),
      tabButton(`Archived (${counts.archived})`, 'archived', activeTab),
      tabButton(`Delegated (${counts.delegated})`, 'delegated', activeTab),
      tabButton(`Watching (${counts.watching})`, 'watching', activeTab),
    ],
  });

  blocks.push({ type: 'divider' });

  /* -------- HEADER -------- */
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📋 Tasks' },
  });

  /* -------- TASK LIST -------- */
  if (!filteredTasks.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No tasks found' },
    });
  }

  for (const task of filteredTasks) {
    console.log(`➡️ Rendering task ${task.id}: ${task.title}`);

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🚩 *${task.title}*` },
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

    const actionButtons = [];

    if (task.status === 'open') {
      actionButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Complete' },
        style: 'primary',
        action_id: 'task_complete',
        value: task.id,
      });
    }

    actionButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'View' },
      action_id: 'task_view',
      value: task.id,
    });

    blocks.push({
      type: 'actions',
      elements: actionButtons,
    });

    blocks.push({ type: 'divider' });
  }

  /* -------- BOTTOM BAR -------- */
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

/* =================================================
   HELPERS
================================================= */
function tabButton(text, value, current) {
  return {
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: `home_tab_${value}`,
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

/* =================================================
   EVENTS & ACTIONS
================================================= */
app.event('app_home_opened', async ({ event, client }) => {
  console.log(`🏠 app_home_opened by ${event.user}`);
  await publishHome(event.user, client);
});

app.action(/^home_tab_/, async ({ body, ack, client }) => {
  await ack();
  const tab = body.actions[0].action_id.replace('home_tab_', '');
  console.log(`🔁 Switched tab to ${tab}`);
  await publishHome(body.user.id, client, tab);
});

app.action('task_complete', async ({ body, ack, client }) => {
  await ack();
  const taskId = body.actions[0].value;
  console.log(`✅ Completing task ${taskId}`);

  await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId);
  await publishHome(body.user.id, client);
});

app.action('task_view', async ({ body, ack, client }) => {
  await ack();
  const taskId = body.actions[0].value;
  console.log(`👁 Viewing task ${taskId}`);

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

/* =================================================
   /todo COMMAND
================================================= */
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
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'title_block',
          label: { type: 'plain_text', text: 'Task' },
          element: { type: 'plain_text_input', action_id: 'title' },
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

/* =================================================
   START
================================================= */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
