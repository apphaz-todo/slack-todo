import 'dotenv/config';
import pkg from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';

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
   HOME TAB (OWNER + ASSIGNEE VISIBILITY)
------------------------------ */
async function publishHome(userId, client) {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id,title,status,assigned_to,created_by')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Home fetch error:', error);
    return;
  }

  const openTasks = tasks.filter(t => t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'done');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 Your Tasks' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📊 *Stats*\n• Open: ${openTasks.length}\n• Done: ${doneTasks.length}`,
      },
    },
    { type: 'divider' },
  ];

  if (openTasks.length) {
    openTasks.forEach(task => {
      const role =
        task.created_by === userId ? '🧑‍💼 Owner' : '👤 Assigned';

      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${task.title}*\n_${role}_`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Done' },
            action_id: 'task_done',
            value: task.id,
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
              text: { type: 'plain_text', text: '🗑️ Delete' },
              action_id: 'task_delete',
              value: task.id,
              style: 'danger',
            },
          ],
        }
      );
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No open tasks' },
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '✅ Completed' },
  });

  if (doneTasks.length) {
    doneTasks.forEach(task => {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `✔️ ${task.title}` },
      });
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '— None yet —' },
    });
  }

  await client.views.publish({
    user_id: userId,
    view: { type: 'home', blocks },
  });
}

/* -----------------------------
   HOME OPEN EVENT
------------------------------ */
app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* -----------------------------
   SLASH COMMAND → MODAL
------------------------------ */
app.command('/todo', async ({ command, ack, client }) => {
  await ack();

  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'new_task_modal',
      title: { type: 'plain_text', text: 'New task' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'task_block',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'task_value',
            placeholder: { type: 'plain_text', text: 'To be done' },
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
          block_id: 'reminder_preset_block',
          optional: true,
          label: { type: 'plain_text', text: 'Reminder' },
          element: {
            type: 'static_select',
            action_id: 'preset',
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
          element: { type: 'datepicker', action_id: 'date' },
        },
        {
          type: 'input',
          block_id: 'custom_time_block',
          optional: true,
          label: { type: 'plain_text', text: 'Custom reminder time' },
          element: { type: 'timepicker', action_id: 'time' },
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

/* -----------------------------
   MODAL SUBMIT
------------------------------ */
app.view('new_task_modal', async ({ ack, body, view, client }) => {
  await ack();

  const userId = body.user.id;

  const task = view.state.values.task_block.task_value.value;
  const dueDate = view.state.values.due_date_block?.due_date?.selected_date || null;
  const preset = view.state.values.reminder_preset_block?.preset?.selected_option?.value;
  const cDate = view.state.values.custom_date_block?.date?.selected_date;
  const cTime = view.state.values.custom_time_block?.time?.selected_time;
  const watchers = view.state.values.watchers_block?.watchers?.selected_users || [];
  const note = view.state.values.note_block?.note?.value || null;

  let reminderAt = null;

  if (preset && dueDate && preset !== 'custom') {
    const d = new Date(dueDate);
    if (preset === 'bod') d.setHours(9, 0, 0);
    if (preset === 'after_lunch') d.setHours(14, 0, 0);
    if (preset === 'eod') d.setHours(17, 0, 0);
    reminderAt = d.toISOString();
  }

  if (preset === 'custom' && cDate && cTime) {
    reminderAt = `${cDate}T${cTime}:00`;
  }

  await supabase.from('tasks').insert({
    title: task,
    created_by: userId,
    assigned_to: userId,
    status: 'open',
    due_date: dueDate,
    reminder_at: reminderAt,
    watchers,
    note,
  });

  await publishHome(userId, client);
});

/* -----------------------------
   DONE / DELETE
------------------------------ */
app.action('task_done', async ({ body, ack, client }) => {
  await ack();

  const taskId = body.actions[0].value;

  const { data: task } = await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', taskId)
    .select('title,watchers')
    .single();

  for (const w of task.watchers || []) {
    await client.chat.postMessage({
      channel: w,
      text: `✅ Task completed: *${task.title}*`,
    });
  }

  await publishHome(body.user.id, client);
});

app.action('task_delete', async ({ body, ack, client }) => {
  await ack();
  await supabase.from('tasks').delete().eq('id', body.actions[0].value);
  await publishHome(body.user.id, client);
});

/* -----------------------------
   REMINDER CRON (EVERY MINUTE)
------------------------------ */
cron.schedule('* * * * *', async () => {
  const now = new Date().toISOString();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id,title,assigned_to,watchers')
    .lte('reminder_at', now)
    .eq('status', 'open');

  for (const task of tasks || []) {
    const users = new Set([task.assigned_to, ...(task.watchers || [])]);

    for (const u of users) {
      await app.client.chat.postMessage({
        channel: u,
        text: `⏰ Reminder: *${task.title}*`,
      });
    }

    await supabase.from('tasks').update({ reminder_at: null }).eq('id', task.id);
  }
});

/* -----------------------------
   START
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
