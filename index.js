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
   TABLE FORMATTER
------------------------------ */
function formatTable(tasks) {
  const header =
    '`TASK                 | ASSIGNEE | DUE        | REM | OWNER`\n' +
    '`---------------------+----------+------------+-----+--------`';

  const rows = tasks.map(t => {
    const task = t.title.padEnd(21).slice(0, 21);
    const assignee = `<@${t.assigned_to}>`.padEnd(10).slice(0, 10);
    const due = (t.due_date || '—').padEnd(10).slice(0, 10);
    const rem = t.reminder_at ? '⏰' : '—';
    const owner = `<@${t.created_by}>`;

    return `\`${task} | ${assignee} | ${due} | ${rem} | ${owner}\``;
  });

  return [header, ...rows].join('\n');
}

/* -----------------------------
   HOME TAB
------------------------------ */
async function publishHome(userId, client) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .eq('status', 'open')
    .order('created_at', { ascending: true }); // 👈 FIX

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 Tasks' },
    },
  ];

  if (!tasks || !tasks.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '📭 No open tasks' },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: formatTable(tasks) },
    });

    tasks.forEach(task => {
      blocks.push({
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
      });
    });
  }

  await client.views.publish({
    user_id: userId,
    view: { type: 'home', blocks },
  });
}

app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* -----------------------------
   /todo COMMAND
------------------------------ */
app.command('/todo', async ({ command, ack, respond, client }) => {
  await ack();
  const text = command.text.trim();

  if (text === 'list') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .or(`assigned_to.eq.${command.user_id},created_by.eq.${command.user_id}`)
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (!tasks || !tasks.length) {
      await respond('📭 No open tasks');
      return;
    }

    await respond(formatTable(tasks));
    return;
  }

  // default → create modal
  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'create_task',
      title: { type: 'plain_text', text: 'New Task' },
      submit: { type: 'plain_text', text: 'Create' },
      blocks: [
        {
          type: 'input',
          block_id: 'title',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
          },
        },
      ],
    },
  });
});

/* -----------------------------
   CREATE TASK
------------------------------ */
app.view('create_task', async ({ ack, body, view, client }) => {
  await ack();

  const title = view.state.values.title.value.value;

  await supabase.from('tasks').insert({
    title,
    created_by: body.user.id,
    assigned_to: body.user.id,
    status: 'open',
  });

  await publishHome(body.user.id, client);
});

/* -----------------------------
   EDIT TASK (OWNER ONLY)
------------------------------ */
app.action('task_edit', async ({ body, ack, client }) => {
  await ack();

  const taskId = body.actions[0].value;
  const userId = body.user.id;

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (task.created_by !== userId) {
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: userId,
      text: '❌ Only the task owner can edit this task.',
    });
    return;
  }

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'edit_task',
      private_metadata: taskId,
      title: { type: 'plain_text', text: 'Edit Task' },
      submit: { type: 'plain_text', text: 'Save' },
      blocks: [
        {
          type: 'input',
          block_id: 'title',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            initial_value: task.title,
          },
        },
      ],
    },
  });
});

app.view('edit_task', async ({ ack, body, view, client }) => {
  await ack();

  const taskId = view.private_metadata;
  const title = view.state.values.title.value.value;

  await supabase.from('tasks').update({ title }).eq('id', taskId);
  await publishHome(body.user.id, client);
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
