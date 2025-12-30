// Command: Add, List, Complete, or Search Tasks
app.command('/todo', async ({ command, ack, say, logger }) => {
  // Acknowledge the request immediately
  logger.info('✅ Received /todo command. Raw command details:', command);
  await ack();

  // Extract subcommand and parameters
  const [subcommand, ...params] = command.text.trim().split(' ');
  const description = params.join(' ');
  logger.info(`📥 Parsed command: Subcommand=${subcommand}, Params=${description}`);

  try {
    switch (subcommand) {
      case 'add': {
        logger.info('➕ Adding a new task...');
        const { error, data } = await supabase.from('tasks').insert({
          title: description,
          assigned_to: command.user_id,
          watchers: [],
          status: 'open',
        });

        if (error) {
          logger.error('❌ Failed to add task:', error);
          await say('❌ Failed to add task. Please check the logs and try again.');
          return;
        }

        logger.info('✅ Task added successfully. Supabase response:', data);
        await say(`✅ Task added: *${description}*`);
        break;
      }

      case 'list': {
        logger.info('📋 Fetching assigned tasks...');
        const { data: tasks, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('assigned_to', command.user_id)
          .eq('status', 'open');

        if (error) {
          logger.error('❌ Failed to fetch tasks:', error);
          await say('❌ Failed to retrieve tasks. Please try again later.');
          return;
        }

        if (!tasks?.length) {
          await say('🎉 No tasks assigned to you.');
        } else {
          const tasksList = tasks.map((t) => `• ${t.title}`).join('\n');
          await say(`📋 Your open tasks:\n${tasksList}`);
        }
        logger.info(`✅ Fetched tasks successfully: ${tasks?.length} tasks found.`);
        break;
      }

      case 'done': {
        const taskId = description;
        logger.info(`✅ Marking Task ID=${taskId} as completed...`);

        const { error } = await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', taskId);

        if (error) {
          logger.error(`❌ Failed to mark Task ID=${taskId} as completed:`, error);
          await say(`❌ Failed to complete task ${taskId}. Please try again.`);
          return;
        }

        logger.info(`✅ Task ID=${taskId} marked as completed.`);
        await say(`✅ Task ${taskId} marked as complete.`);
        break;
      }

      case 'search': {
        logger.info('🔍 Searching for tasks...');
        const query = description;
        const { data: tasks, error } = await supabase
          .from('tasks')
          .select('*')
          .ilike('title', `%${query}%`);

        if (error) {
          logger.error('❌ Search failed:', error);
          await say('❌ Search failed. Please try again later.');
          return;
        }

        if (!tasks?.length) {
          await say('🔍 No matching tasks found.');
        } else {
          const foundTasks = tasks.map((t) => `• ${t.title}`).join('\n');
          await say(`🔎 Search results:\n${foundTasks}`);
        }

        logger.info(`✅ Search completed successfully (${tasks?.length} results found).`);
        break;
      }

      default:
        logger.warn('❓ Received unknown subcommand:', subcommand);
        await say('❓ Unknown subcommand. Use: `/todo add|list|done|search`.');
    }
  } catch (error) {
    // Catch unexpected global errors for better logging
    logger.error('🔥 Unexpected error in /todo handler:', error);
    await say('❌ An unexpected error occurred. Please try again later.');
  }
});
