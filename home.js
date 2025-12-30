import { supabase } from './supabase.js';

export async function handleHome({ event, client, logger }) {
  const user = event.user;
  logger.info(`🏠 Rendering Home tab for User ID=${user}`);

  try {
    // Fetch tasks assigned to the user
    const { data: assignedTasks, error: assignedError } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', user)
      .eq('status', 'open');
    if (assignedError) {
      throw new Error(`❌ Failed fetching assigned tasks: ${assignedError.message}`);
    }

    // Fetch tasks the user is watching
    const { data: watchingTasks, error: watchingError } = await supabase
      .from('tasks')
      .select('*')
      .contains('watchers', [user]);
    if (watchingError) {
      throw new Error(`❌ Failed fetching watching tasks: ${watchingError.message}`);
    }

    logger.info(`✅ Successfully fetched assigned and watching tasks. Assigned=${assignedTasks?.length}, Watching=${watchingTasks?.length}`);

    // Build blocks for Home tab dashboard
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
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${task.title}` } });
      });
    }

    logger.info('✅ Completed building Home tab blocks:', blocks);
    await client.views.publish({
      user_id: user,
      view: { type: 'home', blocks },
    });

    logger.info('✅ Home tab successfully published.');
  } catch (error) {
    logger.error('🔥 Failed to update Home tab:', error);
  }
}
