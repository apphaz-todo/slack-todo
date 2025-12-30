import { supabase } from './supabase.js';

export async function handleHome({ event, client }) {
  const user = event.user;

  // Fetch tasks assigned to the user
  const { data: assignedTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', user)
    .eq('status', 'open');

  // Fetch tasks the user is watching
  const { data: watchingTasks } = await supabase
    .from('tasks')
    .select('*')
    .contains('watchers', [user]);

  // Build Home Tab blocks
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📝 Your Tasks' } },
  ];

  if (assignedTasks?.length) {
    assignedTasks.forEach((task) => {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${task.title}*\nID: ${task.id}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Mark Done' },
          action_id: 'task_done',
          value: task.id,
        },
      });
    });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No tasks assigned!_' } });
  }

  if (watchingTasks?.length) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'header', text: { type: 'plain_text', text: '👀 Watching' } });
    watchingTasks.forEach((task) => {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${task.title}` },
      });
    });
  }

  // Render the Home Tab
  await client.views.publish({
    user_id: user,
    view: { type: 'home', blocks },
  });
}
