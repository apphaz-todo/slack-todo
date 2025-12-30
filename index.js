import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* =====================================================
   ENV CHECK
===================================================== */
console.log('🔍 Checking environment variables...');
[
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
].forEach(v => {
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
   CONSTANTS
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

/* =====================================================
   HOME TAB
===================================================== */
async function publishHome(userId, client, tab = 'home') {
  console.log(`🏠 Publish Home | user=${userId} | tab=${tab}`);

  const { data: tasks = [] } = await supabase
    .from('tasks')
    .select('*')
    .or(
      `assigned_to.eq.${userId},created_by.eq.${userId},watchers.cs.{${userId}}`
    )
    .order('created_at', { ascending: true });

  let filtered = [];
  if (tab === 'completed') filtered = tasks.filter(t => t.status === 'done');
  else if (tab === 'archived') filtered = tasks.filter(t => t.status === 'archived');
  else if (tab === 'watching')
    filtered = tasks.filter(t => t.watchers?.includes(userId));
  else filtered = tasks.filter(t => t.status === 'open');

  const blocks = [];

  /* Tabs */
  blocks.push({
    type: 'actions',
    elements: [
      tabBtn('Home', 'home', tab),
      tabBtn('Completed', 'completed', tab),
      tabBtn('Archived', 'archived', tab),
      tabBtn('Watching', 'watching', tab),
    ],
  });

  blocks.push({ type: 'divider' });

  if (!filtered.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No tasks found' },
    });
  }

  for (const t of filtered) {
    blocks.push(
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🚩 *${t.title}*` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📅 ${t.due_date || 'No due date'}${
              t.note ? `\n📝 ${t.note}` : ''
            }`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          ...(t.status === 'open'
            ? [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Complete' },
                  style: 'primary',
                  action_id: 'task_complete',
                  value: t.id,
                },
              ]
            : []),
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View' },
            action_id: 'task_view',
            value: t.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Edit' },
            action_id: 'task_edit',
            value: t.id,
          },
        ],
      },
      { type: 'divider' }
    );
  }

  /* Footer */
  blocks.push({
    type: 'actions',
    elements: [
      utilBtn('🔍 Search', 'search'),
      utilBtn('🆕 New task', 'new'),
    ],
  });

  await client.views.publish({
    user_id: userId,
    view: { type: 'home', blocks },
  });

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
  console.log('🏠 app_home_opened');
  await publishHome(event.user, client);
});

app.action(/^home_tab_/, async ({ body, ack, client }) => {
  await ack();
  const tab = body.actions[0].action_id.replace('home_tab_', '');
  await publishHome(body.user.id, client, tab);
});

/* =====================================================
   TASK ACTIONS
===================================================== */
app.action('task_complete', async ({ body, ack, client }) => {
  await ack();
  console.log('✅ Complete task', body.actions[0].value);
  await supabase.from('tasks').update({ status: 'done' }).eq('id', body.actions[0].value);
  await publishHome(body.user.id, client);
});

app.action('task_view', async ({ body, ack, client }) => {
  await ack();
  const { data: t } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', body.actions[0].value)
    .single();

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
          elements: [
            {
              type: 'mrkdwn',
              text: `👤 <@${t.assigned_to}> | 📅 ${t.due_date || '—'} | #${t.project || '—'}`,
            },
          ],
        },
      ].filter(Boolean),
    },
  });
});

/* =====================================================
   EDIT TASK
===================================================== */
app.action('task_edit', async ({ body, ack, client }) => {
  await ack();
  const { data: t } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', body.actions[0].value)
    .single();

  if (t.created_by !== body.user.id) {
    console.log('⛔ Edit blocked: not owner');
    return;
  }

  await openTaskModal(client, body.trigger_id, 'edit_task', t);
});

/* =====================================================
   /todo COMMAND
===================================================== */
app.command('/todo', async ({ command, ack, client }) => {
  await ack();
  console.log('/todo:', command.text);

  if (command.text.trim() === 'list') {
    console.log('➡ Redirecting to Home tab');
    await publishHome(command.user_id, client);
    return;
  }

  await openTaskModal(client, command.trigger_id, 'create_task');
});

/* =====================================================
   MODALS
===================================================== */
async function openTaskModal(client, triggerId, callback, task = {}) {
  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: callback,
      title: { type: 'plain_text', text: task.id ? 'Edit task' : 'New task' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: task.id || '',
      blocks: [
        input('Task', 'title', task.title),
        date('Due date', 'due_date', task.due_date),
        user('Assignee', 'assigned_to', task.assigned_to),
        channel('Project (optional)', 'project', task.project),
        multi('Reminders', 'reminders', task.reminders),
        multiUsers('Watchers', 'watchers', task.watchers),
        textarea('Notes', 'note', task.note),
      ],
    },
  });
}

/* =====================================================
   SUBMITS
===================================================== */
app.view('create_task', async ({ ack, body, view, client }) => {
  await ack();
  console.log('➕ Create task');

  const v = view.state.values;
  await supabase.from('tasks').insert({
    title: v.title.value.value,
    due_date: v.due_date.value.selected_date,
    assigned_to: v.assigned_to.value.selected_user,
    project: v.project?.value?.selected_channel || null,
    reminders: v.reminders?.value?.selected_options?.map(o => o.value) || [],
    watchers: v.watchers?.value?.selected_users || [],
    note: v.note?.value?.value || null,
    created_by: body.user.id,
    status: 'open',
  });

  await publishHome(body.user.id, client);

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Success' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '✅ Task created successfully' } }],
    },
  });
});

app.view('edit_task', async ({ ack, body, view, client }) => {
  await ack();
  console.log('✏️ Update task');

  const id = view.private_metadata;
  const v = view.state.values;

  await supabase.from('tasks').update({
    title: v.title.value.value,
    due_date: v.due_date.value.selected_date,
    assigned_to: v.assigned_to.value.selected_user,
    project: v.project?.value?.selected_channel || null,
    reminders: v.reminders?.value?.selected_options?.map(o => o.value) || [],
    watchers: v.watchers?.value?.selected_users || [],
    note: v.note?.value?.value || null,
  }).eq('id', id);

  await publishHome(body.user.id, client);
});

/* =====================================================
   BLOCK HELPERS
===================================================== */
const input = (label, id, val) => ({
  type: 'input',
  block_id: id,
  label: { type: 'plain_text', text: label },
  element: { type: 'plain_text_input', action_id: 'value', initial_value: val || '' },
});

const textarea = (label, id, val) => ({
  type: 'input',
  block_id: id,
  optional: true,
  label: { type: 'plain_text', text: label },
  element: {
    type: 'plain_text_input',
    action_id: 'value',
    multiline: true,
    initial_value: val || '',
  },
});

const date = (label, id, val) => ({
  type: 'input',
  block_id: id,
  label: { type: 'plain_text', text: label },
  element: { type: 'datepicker', action_id: 'value', initial_date: val || undefined },
});

const user = (label, id, val) => ({
  type: 'input',
  block_id: id,
  label: { type: 'plain_text', text: label },
  element: { type: 'users_select', action_id: 'value', initial_user: val },
});

const channel = (label, id, val) => ({
  type: 'input',
  block_id: id,
  optional: true,
  label: { type: 'plain_text', text: label },
  element: { type: 'channels_select', action_id: 'value', initial_channel: val },
});

const multi = (label, id, vals) => ({
  type: 'input',
  block_id: id,
  optional: true,
  label: { type: 'plain_text', text: label },
  element: {
    type: 'multi_static_select',
    action_id: 'value',
    options: REMINDER_OPTIONS,
    initial_options: (vals || []).map(v =>
      REMINDER_OPTIONS.find(o => o.value === v)
    ),
  },
});

const multiUsers = (label, id, vals) => ({
  type: 'input',
  block_id: id,
  optional: true,
  label: { type: 'plain_text', text: label },
  element: {
    type: 'multi_users_select',
    action_id: 'value',
    initial_users: vals || [],
  },
});

/* =====================================================
   START
===================================================== */
(async () => {
  await app.start();
  console.log('🚀 Slack Todo app running');
})();
