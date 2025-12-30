import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* =====================================================
   ENV CHECK
===================================================== */
console.log('🔍 Checking environment variables...');
['SLACK_BOT_TOKEN','SLACK_SIGNING_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']
.forEach(v => {
  if (!process.env[v]) {
    console.error(`❌ Missing ${v}`);
    throw new Error('Missing env vars');
  }
});
console.log('✅ Environment OK');

/* =====================================================
   INIT
===================================================== */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('⚡ App initialized');

/* =====================================================
   HELPERS
===================================================== */
function formatDate(dateStr) {
  if (!dateStr) return 'No due date';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function toSlackDate(dateStr) {
  if (!dateStr) return undefined;
  return new Date(dateStr).toISOString().split('T')[0];
}

function isValidChannel(id) {
  return typeof id === 'string' && id.startsWith('C');
}

/* =====================================================
   REMINDERS
===================================================== */
const REMINDER_OPTIONS = [
  ['🌅 Beginning of Day', 'bod'],
  ['🍱 After Lunch', 'after_lunch'],
  ['🌙 End of Day', 'eod'],
  ...Array.from({ length: 18 }, (_, i) => [`🕒 ${i + 6}:00`, `${i + 6}:00`]),
].map(([text, value]) => ({
  text: { type: 'plain_text', text },
  value,
}));

const REMINDER_VALUE_SET = new Set(REMINDER_OPTIONS.map(o => o.value));

/* =====================================================
   DM NOTIFICATIONS
===================================================== */
async function notifyUser({ client, userId, task, type, actor }) {
  if (!userId) return;

  console.log(`📩 Notifying ${userId} | type=${type}`);

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          (type === 'assignee'
            ? '🆕 *New task assigned to you*'
            : '👀 *You were added as a watcher*') +
          `\n*${task.title}*\n📅 Due: ${formatDate(task.due_date)}\n👤 By: <@${actor}>`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '👁 View' },
          action_id: 'task_view',
          value: task.id,
        },
        ...(type === 'assignee'
          ? [{
              type: 'button',
              text: { type: 'plain_text', text: '✅ Complete' },
              style: 'primary',
              action_id: 'task_complete',
              value: task.id,
            }]
          : []),
      ],
    },
  ];

  await client.chat.postMessage({
    channel: userId,
    blocks,
    text: `Task: ${task.title}`,
  });
}

/* =====================================================
   HOME TAB
===================================================== */
async function publishHome(userId, client, tab = 'home') {
  console.log(`🏠 Home | user=${userId} | tab=${tab}`);

  const { data: tasks = [] } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId},watchers.cs.{${userId}}`)
    .order('created_at', { ascending: true });

  const counts = {
    home: tasks.filter(t => t.status === 'open').length,
    assigned: tasks.filter(t => t.assigned_to === userId && t.status === 'open').length,
    completed: tasks.filter(t => t.status === 'done').length,
    archived: tasks.filter(t => t.status === 'archived').length,
    watching: tasks.filter(t => t.watchers?.includes(userId)).length,
  };

  let filtered;
  switch (tab) {
    case 'assigned': filtered = tasks.filter(t => t.assigned_to === userId && t.status === 'open'); break;
    case 'completed': filtered = tasks.filter(t => t.status === 'done'); break;
    case 'archived': filtered = tasks.filter(t => t.status === 'archived'); break;
    case 'watching': filtered = tasks.filter(t => t.watchers?.includes(userId)); break;
    default: filtered = tasks.filter(t => t.status === 'open');
  }

  const blocks = [];

  blocks.push({
    type: 'actions',
    elements: [
      tabBtn(`Home (${counts.home})`, 'home', tab),
      tabBtn(`Assigned (${counts.assigned})`, 'assigned', tab),
      tabBtn(`Completed (${counts.completed})`, 'completed', tab),
      tabBtn(`Archived (${counts.archived})`, 'archived', tab),
      tabBtn(`Watching (${counts.watching})`, 'watching', tab),
    ],
  });

  blocks.push({ type: 'divider' });

  if (!filtered.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '📭 No tasks found' } });
  }

  for (const t of filtered) {
    blocks.push(
      { type: 'section', text: { type: 'mrkdwn', text: `🚩 *${t.title}*` } },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text:
            `📅 ${formatDate(t.due_date)}` +
            `\n👤 Assignee: <@${t.assigned_to}>` +
            (t.watchers?.length
              ? `\n👀 Watchers: ${t.watchers.map(u => `<@${u}>`).join(', ')}`
              : '') +
            (t.note ? `\n📝 ${t.note}` : '')
        }],
      },
      {
        type: 'actions',
        elements: [
          ...(t.status === 'open'
            ? [{
                type: 'button',
                text: { type: 'plain_text', text: 'Complete' },
                style: 'primary',
                action_id: 'task_complete',
                value: t.id,
              }]
            : []),
          { type: 'button', text: { type: 'plain_text', text: 'View' }, action_id: 'task_view', value: t.id },
          { type: 'button', text: { type: 'plain_text', text: 'Edit' }, action_id: 'task_edit', value: t.id },
        ],
      },
      { type: 'divider' }
    );
  }

  blocks.push({
    type: 'actions',
    elements: [ utilBtn('🆕 New task', 'new') ],
  });

  await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });
  console.log('✅ Home published');
}

const tabBtn = (text, value, active) => ({
  type: 'button',
  text: { type: 'plain_text', text },
  action_id: `home_tab_${value}`,
  style: value === active ? 'primary' : undefined,
});

const utilBtn = (text, value) => ({
  type: 'button',
  text: { type: 'plain_text', text },
  action_id: `util_${value}`,
});

/* =====================================================
   EVENTS
===================================================== */
app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* =====================================================
   ACTIONS (ACK SAFE)
===================================================== */
app.action(/^home_tab_/, async ({ body, ack, client }) => {
  await ack();
  setImmediate(() => publishHome(body.user.id, client, body.actions[0].action_id.replace('home_tab_', '')));
});

app.action('util_new', async ({ body, ack, client }) => {
  await ack();
  setImmediate(() => openTaskModal(client, body.trigger_id, 'create_task'));
});

app.action('task_complete', async ({ body, ack, client }) => {
  await ack();
  setImmediate(async () => {
    await supabase.from('tasks').update({ status: 'done' }).eq('id', body.actions[0].value);
    await publishHome(body.user.id, client);
  });
});

app.action('task_view', async ({ body, ack, client }) => {
  await ack();
  setImmediate(async () => {
    const { data: t } = await supabase.from('tasks').select('*').eq('id', body.actions[0].value).single();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Todo' },
        close: { type: 'plain_text', text: 'Close' },
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*${t.title}*` } },
          t.note && { type: 'section', text: { type: 'mrkdwn', text: t.note } },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `👤 <@${t.assigned_to}> | 📅 ${formatDate(t.due_date)}` }],
          },
        ].filter(Boolean),
      },
    });
  });
});

/* =====================================================
   /todo COMMAND
===================================================== */
app.command('/todo', async ({ command, ack, client }) => {
  await ack();
  setImmediate(() => {
    if (command.text.trim() === 'list') {
      publishHome(command.user_id, client);
    } else {
      openTaskModal(client, command.trigger_id, 'create_task');
    }
  });
});

/* =====================================================
   START
===================================================== */
(async () => {
  await app.start();
  console.log('🚀 Slack Todo app running (ACK SAFE)');
})();
