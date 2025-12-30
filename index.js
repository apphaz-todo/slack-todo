import pkg from '@slack/bolt';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';

dotenv.config();
const { App, ExpressReceiver } = pkg;

// Validate Slack environment variables
const validateEnvVars = () => {
  if (!process.env.SLACK_SIGNING_SECRET || !process.env.SLACK_BOT_TOKEN) {
    throw new Error('Missing Slack credentials in environment variables');
  }
};
validateEnvVars();

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });

// Middleware to parse Slack requests
receiver.app.use(bodyParser.urlencoded({ extended: true }));
receiver.app.use(bodyParser.json());
receiver.app.use((req, res, next) => {
  console.log('🔃 Incoming Request Details:', {
    method: req.method,
    url: req.originalUrl,
    contentType: req.headers['content-type'],
    body: req.body,
  });
  next();
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  processBeforeResponse: true,
});

// Command Handler for "/todo"
app.command('/todo', async ({ command, ack, say, logger }) => {
  try {
    await ack(); // Acknowledge the slash command immediately
    logger.info('✅ Slash command acknowledged');

    const { text, user_id, channel_id } = command;
    logger.info(`Command received from user ${user_id} in channel ${channel_id}`);

    if (!text) {
      await say('❓ Please include a subcommand. Usage: `/todo add|list|done|search`.');
      return;
    }

    // Split text into subcommands
    const [subcommand, ...args] = text.split(' ');
    logger.info(`Subcommand: ${subcommand}, Args: ${args.join(' ')}`);

    // Handle each sub-command
    if (subcommand === 'add') {
      const taskTitle = args.join(' ');
      logger.info(`Adding task: ${taskTitle}`);
      await say(`✅ Task added: ${taskTitle}`);
    } else if (subcommand === 'list') {
      logger.info('Listing tasks...');
      await say('📋 No tasks found. Use `/todo add <task>` to add new tasks.');
    } else if (subcommand === 'done') {
      const taskId = args[0];
      logger.info(`Marking task ${taskId} as complete`);
      await say(`✅ Task ${taskId} marked as complete.`);
    } else {
      logger.warn('Unknown subcommand received');
      await say('❓ Unknown subcommand. Use: `/todo add|list|done|search`.');
    }
  } catch (error) {
    logger.error('🔥 Error processing `/todo` command:', error);
    await say('❌ Something went wrong while processing your command. Please try again.');
  }
});

// Start Express Server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`⚡️ Slack app running on port ${port}`);
});
