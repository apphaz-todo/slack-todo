import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';

const { App } = pkg;

/* -----------------------------
   ENV CHECK
------------------------------ */
if (
  !process.env.SLACK_BOT_TOKEN ||
  !process.env.SLACK_SIGNING_SECRET ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error('❌ Missing environment variables');
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
   UTIL
------------------------------ */
function formatTaskRow(task) {
  return (
    `*${task.title}*\n` +
    `• Owner: <@${task.created_by}>\n` +
    `• Assignee: <@${task.assigned_to}>\n` +
    `• Due: ${task.due_date || '—'}\n` +
    `• Reminder: ${task.reminder_at ? '⏰ Set' : '—'}\n` +
    `• Watchers: ${
      task.watchers?.length
        ? task.watchers.map(u => `<@${u}>`).join(', ')
        : '—'
    }`
  );
}

/* -----------------------------
   HOME TAB
------------------------------ */
async function publishHome(userId, client) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('created_at', { ascending: false });

  const openTasks = (tasks || []).filter(t => t.status === 'open');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 Your Tasks' },
    },
  ];

  if (!openTasks.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No open tasks' },
    });
  }

  openTasks.forEach(task => {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formatTaskRow(task),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit' },
            action_id: 'task_edit',
            value: task.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Complete' },
            action_id: 'task_done',
            value: task.id,
            style: 'primary',
          },
        ],
      },
      { type: 'divider' }
    );
  });

  await client.views.publish({
    user_id: userId,
    view: { type: 'home', blocks },
  });
}

app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* -----------------------------
   SLASH COMMAND
------------------------------ */
app.command('/todo', async ({ command, ack, respond, client }) => {
  await ack();
  const text = command.text.trim();

  if (text === 'list') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .or(`assigned_to.eq.${command.user_id},created_by.eq.${command.user_id}`)
      .eq('status', 'open');

    if (!tasks?.length) {
      await respond('📭 No open tasks');
      return;
    }

    await respond(
      '*📝 Your Tasks*\n\n' +
        tasks.map(t => formatTaskRow(t)).join('\n\n')
    );
    return;
  }

  // default → open modal
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildTaskModal(),
  });
});

/* -----------------------------
   MODAL (CUSTOM FIELDS ALWAYS VISIBLE)
------------------------------ */
function buildTaskModal() {
  return {
    type: 'modal',
    callback_id: 'new_task_modal',
    title: { type: 'plain_text', text: 'New Task' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'task_block',
        label: { type: 'plain_text', text: 'Task' },
        element: {
          type: 'plain_text_input',
          action_id: 'task_value',
        },
      },
      {
        type: 'input',
        block_id: 'due_date_block',
        optional: true,
        label: { type: 'plain_text', text: 'Due date' },
        element: { type: 'datepicker', action_id: 'due_date' },
      },
      {
        type: 'input',
        block_id: 'reminder_block',
        optional: true,
        label: { type: 'plain_text', text: 'Reminder' },
        element: {
          type: 'static_select',
          action_id: 'reminder_preset',
          options: [
            { text: { type: 'plain_text', text: 'Beginning of Day (9 AM)' }, value: 'bod' },
            { text: { type: 'plain_text', text: 'After Lunch (2 PM)' }, value: 'after_lunch' },
            { text: { type: 'plain_text', text: 'End of Day (5 PM)' }, value: 'eod' },
            { text: { type: 'plain_text', text: 'Custom date & time' }, value: 'custom' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'custom_date_block',
        optional: true,
        label: { type: 'plain_text', text: 'Custom reminder date' },
        element: { type: 'datepicker', action_id: 'custom_date' },
      },
      {
        type: 'input',
        block_id: 'custom_time_block',
        optional: true,
        label: { type: 'plain_text', text: 'Custom reminder time' },
        element: { type: 'timepicker', action_id: 'custom_time' },
      },
      {
        type: 'input',
        block_id: 'watchers_block',
        optional: true,
        label: { type: 'plain_text', text: 'Watchers' },
        element: {
          type: 'multi_users_select',
          action_id: 'watchers',
        },
      },
    ],
  };
}

/* -----------------------------
   MODAL SUBMIT (VALIDATION)
------------------------------ */
app.view('new_task_modal', async ({ ack, body, view, client }) => {
  const preset =
    view.state.values.reminder_block?.reminder_preset?.selected_option?.value;

  const customDate =
    view.state.values.custom_date_block?.custom_date?.selected_date;

  const customTime =
    view.state.values.custom_time_block?.custom_time?.selected_time;

  if (preset === 'custom' && (!customDate || !customTime)) {
    await ack({
      response_action: 'errors',
      errors: {
        custom_date_block: 'Custom date & time required',
      },
    });
    return;
  }

  await ack();

  const userId = body.user.id;
  const task = view.state.values.task_block.task_value.value;

  let reminderAt = null;
  if (preset === 'custom') {
    reminderAt = `${customDate}T${customTime}:00`;
  }

  await supabase.from('tasks').insert({
    title: task,
    created_by: userId,
    assigned_to: userId,
    status: 'open',
    reminder_at: reminderAt,
    watchers:
      view.state.values.watchers_block?.watchers?.selected_users || [],
  });

  await publishHome(userId, client);
});

/* -----------------------------
   COMPLETE TASK
------------------------------ */
app.action('task_done', async ({ body, ack, client }) => {
  await ack();
  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', body.actions[0].value);

  await publishHome(body.user.id, client);
});

/* -----------------------------
   START
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
