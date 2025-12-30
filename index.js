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
   HOME TAB (unchanged)
------------------------------ */
async function publishHome(userId, client) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id,title,status,assigned_to,created_by')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('created_at', { ascending: false });

  const openTasks = (tasks || []).filter(t => t.status === 'open');

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
          ? openTasks.map(t => ({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `• *${t.title}*`,
              },
            }))
          : [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: '📭 No open tasks' },
              },
            ]),
      ],
    },
  });
}

/* -----------------------------
   SLASH COMMAND HANDLER
------------------------------ */
app.command('/todo', async ({ command, ack, client, respond }) => {
  await ack();

  const text = command.text.trim();

  /* ---- /todo list ---- */
  if (text === 'list') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id,title')
      .or(`assigned_to.eq.${command.user_id},created_by.eq.${command.user_id}`)
      .eq('status', 'open');

    if (!tasks || !tasks.length) {
      await respond('📭 No open tasks.');
      return;
    }

    await respond(
      '📝 Your tasks:\n' +
        tasks.map(t => `• (${t.id}) ${t.title}`).join('\n')
    );
    return;
  }

  /* ---- /todo help ---- */
  if (text === 'help') {
    await respond(
      '*Todo commands*\n' +
        '`/todo` → New task\n' +
        '`/todo list` → List tasks\n' +
        '`/todo help` → Help'
    );
    return;
  }

  /* ---- default: open modal ---- */
  await openTaskModal(client, command.trigger_id);
});

/* -----------------------------
   MODAL OPEN (DEFAULT STATE)
------------------------------ */
async function openTaskModal(client, trigger_id, showCustom = false) {
  await client.views.open({
    trigger_id,
    view: buildTaskModal(showCustom),
  });
}

/* -----------------------------
   MODAL BUILDER (CONDITIONAL)
------------------------------ */
function buildTaskModal(showCustom) {
  const blocks = [
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
        action_id: 'reminder_preset',
        placeholder: { type: 'plain_text', text: 'Choose reminder' },
        options: [
          { text: { type: 'plain_text', text: 'Beginning of Day (9 AM)' }, value: 'bod' },
          { text: { type: 'plain_text', text: 'After Lunch (2 PM)' }, value: 'after_lunch' },
          { text: { type: 'plain_text', text: 'End of Day (5 PM)' }, value: 'eod' },
          { text: { type: 'plain_text', text: 'Custom date & time' }, value: 'custom' },
        ],
      },
    },
  ];

  if (showCustom) {
    blocks.push(
      {
        type: 'input',
        block_id: 'custom_date_block',
        label: { type: 'plain_text', text: 'Custom reminder date' },
        element: { type: 'datepicker', action_id: 'custom_date' },
      },
      {
        type: 'input',
        block_id: 'custom_time_block',
        label: { type: 'plain_text', text: 'Custom reminder time' },
        element: { type: 'timepicker', action_id: 'custom_time' },
      }
    );
  }

  blocks.push({
    type: 'input',
    block_id: 'note_block',
    optional: true,
    label: { type: 'plain_text', text: 'Note' },
    element: {
      type: 'plain_text_input',
      action_id: 'note',
      multiline: true,
    },
  });

  return {
    type: 'modal',
    callback_id: 'new_task_modal',
    title: { type: 'plain_text', text: 'New task' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

/* -----------------------------
   REMINDER PRESET CHANGE (SHOW / HIDE)
------------------------------ */
app.action('reminder_preset', async ({ ack, body, action, client }) => {
  await ack();

  const showCustom = action.selected_option.value === 'custom';

  await client.views.update({
    view_id: body.view.id,
    hash: body.view.hash,
    view: buildTaskModal(showCustom),
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
  const preset =
    view.state.values.reminder_preset_block?.reminder_preset?.selected_option?.value || null;

  const customDate =
    view.state.values.custom_date_block?.custom_date?.selected_date || null;
  const customTime =
    view.state.values.custom_time_block?.custom_time?.selected_time || null;

  let reminderAt = null;

  if (preset && preset !== 'custom' && dueDate) {
    const d = new Date(dueDate);
    if (preset === 'bod') d.setHours(9, 0, 0);
    if (preset === 'after_lunch') d.setHours(14, 0, 0);
    if (preset === 'eod') d.setHours(17, 0, 0);
    reminderAt = d.toISOString();
  }

  if (preset === 'custom' && customDate && customTime) {
    reminderAt = `${customDate}T${customTime}:00`;
  }

  await supabase.from('tasks').insert({
    title: task,
    created_by: userId,
    assigned_to: userId,
    status: 'open',
    due_date: dueDate,
    reminder_at: reminderAt,
  });

  await publishHome(userId, client);
});

/* -----------------------------
   START
------------------------------ */
(async () => {
  await app.start();
  console.log('⚡ Slack Todo app running');
})();
