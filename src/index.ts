import './instrumentation';
import { App } from '@slack/bolt';
import { config, validateConfig } from './config';
import { ClaudeHandler } from './claude-handler';
import { SlackHandler } from './slack-handler';
import { McpManager } from './mcp-manager';
import { Logger } from './logger';
import {
  ensureSingleInstance,
  EXIT_CODE_DUPLICATE_INSTANCE,
  DUPLICATE_INSTANCE_ERROR,
} from './single-instance';

const logger = new Logger('Main');

async function start() {
  try {
    // Refuse to start if another bot is already running. Two bots on the
    // same Slack token split-brain events between them and corrupt
    // thread-state.json. Set SLACK_BOT_FORCE_TAKEOVER=1 to override.
    ensureSingleInstance();

    // Validate configuration
    validateConfig();

    logger.info('Starting Claude Code Slack bot', {
      debug: config.debug,
      useBedrock: config.claude.useBedrock,
      useVertex: config.claude.useVertex,
    });

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });

    // Initialize MCP manager
    const mcpManager = new McpManager();
    const mcpConfig = mcpManager.loadConfiguration();
    
    // Initialize handlers
    const claudeHandler = new ClaudeHandler(mcpManager);
    const slackHandler = new SlackHandler(app, claudeHandler, mcpManager);

    // Setup event handlers
    slackHandler.setupEventHandlers();

    // Start the app
    await app.start();
    logger.info('⚡️ Claude Code Slack bot is running!');
    logger.info('Configuration:', {
      model: config.claude.model,
      usingBedrock: config.claude.useBedrock,
      usingVertex: config.claude.useVertex,
      usingAnthropicAPI: !config.claude.useBedrock && !config.claude.useVertex,
      debugMode: config.debug,
      baseDirectory: config.baseDirectory || 'not set',
      mcpServers: mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0,
      mcpServerNames: mcpConfig ? Object.keys(mcpConfig.mcpServers) : [],
    });
  } catch (error) {
    logger.error('Failed to start the bot', error);
    if (error instanceof Error && error.name === DUPLICATE_INSTANCE_ERROR) {
      // Distinct exit code so launchd / supervisors can suppress crash-loop
      // restarts when the cause is "another instance is already running"
      // (a config/operator error, not a crash).
      process.exit(EXIT_CODE_DUPLICATE_INSTANCE);
    }
    process.exit(1);
  }
}

start();