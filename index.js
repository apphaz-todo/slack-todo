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
   REMINDER OPTIONS
================================================= */
const REMINDER_OPTIONS = [
  { text: '🌅 Beginning of Day', value: 'bod' },
  { text: '🍱 After Lunch', value: 'after_lunch' },
  { text: '🌙 End of Day', value: 'eod' },
  ...Array.from({ length: 18 }, (_, i) => {
    const hour = i + 6;
    return {
      text: `🕒 ${hour}:00`,
      value: `${hour}:00`,
    };
  }),
].map(o => ({
  text: { type: 'plain_text', text: o.text },
  value: o.value,
}));

/* =================================================
   HOME TAB (UNCHANGED, WORKING)
================================================= */
async function publishHome(userId, client, activeTab = 'home') {
  console.log(`🏠 Publishing Home tab | user=${userId} | tab=${activeTab}`);

  const { data: tasks = [] } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId},watchers.cs.{${userId}}`)
    .order('created_at', { ascending: true });

  const blocks = [];

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

  const filtered =
    activeTab === 'completed'
      ? tasks.filter(t => t.status === 'done')
      : activeTab === 'archived'
      ? tasks.filter(t => t.status === 'archived')
      : activeTab === 'delegated'
      ? tasks.filter(t => t.created_by === userId && t.assigned_to !== userId)
      : activeTab === 'watching'
      ? tasks.filter(t => t.watchers?.includes(userId))
      : tasks.filter(t => t.status === 'open');

  if (!filtered.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No tasks found' },
    });
  }

  for (const task of filtered) {
    blocks.push(
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🚩 *${task.title}*` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              `Owner: <@${task.created_by}> | Assignee: <@${task.assigned_to}>` +
              (task.note ? `\n📝 ${task.note}` : ''),
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          ...(task.status === 'open'
            ? [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Complete' },
                  style: 'primary',
                  action_id: 'task_complete',
                  value: task.id,
                },
              ]
            : []),
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View' },
            action_id: 'task_view',
            value: task.id,
          },
        ],
      },
      { type: 'divider' }
    );
  }

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

/* =================================================
   EVENTS & ACTIONS
================================================= */
app.event('app_home_opened', async ({ event, client }) => {
  console.log(`🏠 Home opened by ${event.user}`);
  await publishHome(event.user, client);
});

app.action(/^home_tab_/, async ({ body, ack, client }) => {
  await ack();
  const tab = body.actions[0].action_id.replace('home_tab_', '');
  console.log(`🔁 Switched to tab ${tab}`);
  await publishHome(body.user.id, client, tab);
});

app.action('task_complete', async ({ body, ack, client }) => {
  await ack();
  const taskId = body.actions[0].value;
  console.log(`✅ Completing task ${taskId}`);

  await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId);
  await publishHome(body.user.id, client);
});

/* =================================================
   /todo → NEW TASK MODAL (FULL FEATURED)
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
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'title',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            placeholder: {
              type: 'plain_text',
              text: "What's next",
            },
          },
        },
        {
          type: 'input',
          block_id: 'due',
          label: { type: 'plain_text', text: 'Due date' },
          element: { type: 'datepicker', action_id: 'value' },
        },
        {
          type: 'input',
          block_id: 'assignee',
          label: { type: 'plain_text', text: 'Assignee' },
          element: {
            type: 'users_select',
            action_id: 'value',
            initial_user: command.user_id,
          },
        },
        {
          type: 'input',
          block_id: 'project',
          optional: true,
          label: { type: 'plain_text', text: 'Project (optional)' },
          element: {
            type: 'channels_select',
            action_id: 'value',
          },
        },
        {
          type: 'input',
          block_id: 'reminders',
          optional: true,
          label: { type: 'plain_text', text: 'Reminders' },
          element: {
            type: 'multi_static_select',
            action_id: 'value',
            options: REMINDER_OPTIONS,
          },
        },
        {
          type: 'input',
          block_id: 'watchers',
          optional: true,
          label: { type: 'plain_text', text: 'Watchers' },
          element: {
            type: 'multi_users_select',
            action_id: 'value',
          },
        },
        {
          type: 'input',
          block_id: 'note',
          optional: true,
          label: { type: 'plain_text', text: 'Notes' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            multiline: true,
          },
        },
      ],
    },
  });
});

/* =================================================
   CREATE TASK SUBMIT
================================================= */
app.view('create_task', async ({ ack, body, view, client }) => {
  await ack();
  console.log('➕ Creating task from modal');

  const v = view.state.values;

  const title = v.title.value.value;
  const due_date = v.due.value.selected_date;
  const assigned_to = v.assignee.value.selected_user;
  const project = v.project?.value?.selected_channel || null;
  const reminders =
    v.reminders?.value?.selected_options?.map(o => o.value) || [];
  const watchers = v.watchers?.value?.selected_users || [];
  const note = v.note?.value?.value || null;

  await supabase.from('tasks').insert({
    title,
    due_date,
    assigned_to,
    project,
    reminders,
    watchers,
    note,
    status: 'open',
    created_by: body.user.id,
  });

  console.log('✅ Task inserted into DB');
  await publishHome(body.user.id, client);
});

/* =================================================
   START
================================================= */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
