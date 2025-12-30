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
      const roleLabel =
        task.created_by === userId ? '🧑‍💼 Owner' : '👤 Assigned';

      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${task.title}*\n_${roleLabel}_`,
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
    view: {
      type: 'home',
      blocks,
    },
  });
}

/* -----------------------------
   HOME OPEN EVENT
------------------------------ */
app.event('app_home_opened', async ({ event, client }) => {
  await publishHome(event.user, client);
});

/* -----------------------------
   SLASH COMMAND (/todo)
------------------------------ */
app.command('/todo', async ({ command, ack, client, respond }) => {
  await ack();
  const text = command.text.trim();

  // /todo assign @user task
  if (text.startsWith('assign')) {
    const match = text.match(/assign\s+<@(\w+)>\s+(.+)/);
    if (!match) {
      await respond('❌ `/todo assign @user task`');
      return;
    }

    const [, assignee, task] = match;

    await supabase.from('tasks').insert({
      title: task,
      created_by: command.user_id, // 👈 OWNER
      assigned_to: assignee,       // 👈 ASSIGNEE
      status: 'open',
    });

    await respond(`✅ Task assigned to <@${assignee}>`);
    return;
  }

  // Default → open modal
  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'add_task_modal',
      title: { type: 'plain_text', text: 'Add Task' },
      submit: { type: 'plain_text', text: 'Add' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'task_input',
          label: { type: 'plain_text', text: 'Task description' },
          element: {
            type: 'plain_text_input',
            action_id: 'task_value',
            placeholder: {
              type: 'plain_text',
              text: 'What do you need to do?',
            },
          },
        },
      ],
    },
  });
});

/* -----------------------------
   ADD TASK MODAL SUBMIT
------------------------------ */
app.view('add_task_modal', async ({ ack, body, view, client }) => {
  await ack();

  const task =
    view.state.values.task_input.task_value.value;

  await supabase.from('tasks').insert({
    title: task,
    created_by: body.user.id,   // 👈 OWNER
    assigned_to: body.user.id,  // 👈 DEFAULT ASSIGNEE
    status: 'open',
  });

  await publishHome(body.user.id, client);
});

/* -----------------------------
   EDIT TASK
------------------------------ */
app.action('task_edit', async ({ body, ack, client }) => {
  await ack();

  const taskId = body.actions[0].value;

  const { data } = await supabase
    .from('tasks')
    .select('title')
    .eq('id', taskId)
    .single();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'edit_task_modal',
      private_metadata: taskId,
      title: { type: 'plain_text', text: 'Edit Task' },
      submit: { type: 'plain_text', text: 'Save' },
      blocks: [
        {
          type: 'input',
          block_id: 'edit_input',
          label: { type: 'plain_text', text: 'Task' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            initial_value: data.title,
          },
        },
      ],
    },
  });
});

app.view('edit_task_modal', async ({ ack, body, view, client }) => {
  await ack();

  const taskId = view.private_metadata;
  const newText =
    view.state.values.edit_input.value.value;

  await supabase
    .from('tasks')
    .update({ title: newText })
    .eq('id', taskId);

  await publishHome(body.user.id, client);
});

/* -----------------------------
   DONE / DELETE
------------------------------ */
app.action('task_done', async ({ body, ack, client }) => {
  await ack();

  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', body.actions[0].value);

  await publishHome(body.user.id, client);
});

app.action('task_delete', async ({ body, ack, client }) => {
  await ack();

  await supabase
    .from('tasks')
    .delete()
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
