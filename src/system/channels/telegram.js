/**
 * Telegram Bot Integration for WindsurfPoolAPI
 * 
 * Features:
 * - Receive prompts from Telegram
 * - Forward to /v1 API
 * - Return results to Telegram
 * - Rate limit fallback to Local LLM
 * - Logging
 */

import { config, log } from '../../config.js';
import { handleChatCompletions } from '../../handlers/chat.js';
import { queryLocalLLM } from '../local-llm/ollama.js';
import { parseAndExecute, getSkillsHelp } from '../skills/index.js';
import { customCommands, executeCommand, listCommands, addCommand, removeCommand, customCommands as commandsManager } from '../commands/custom-commands.js';
import { executeCommand as executeBash } from '../bash/bash-executor.js';

// Dynamic import for node-telegram-bot-api (optional dependency)
let TelegramBot;
try {
  const module = await import('node-telegram-bot-api');
  TelegramBot = module.default;
} catch {
  log.warn('Telegram: node-telegram-bot-api not installed. Telegram features disabled.');
}

class TelegramChannel {
  constructor() {
    this.bot = null;
    this.enabled = false;
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.allowedChatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    this.activeChats = new Map(); // chatId -> { context: [], settings: {} }
  }

  async initialize() {
    if (!TelegramBot) {
      log.warn('Telegram: node-telegram-bot-api not available. Run: npm install node-telegram-bot-api');
      this.enabled = false;
      return false;
    }

    if (!this.botToken) {
      log.info('Telegram: Disabled (TELEGRAM_BOT_TOKEN not set)');
      this.enabled = false;
      return false;
    }

    try {
      log.info('Telegram: Initializing bot...');
      this.bot = new TelegramBot(this.botToken, { polling: true });
      this.setupHandlers();
      this.enabled = true;
      log.info('Telegram: Bot initialized and polling successfully');
      return true;
    } catch (err) {
      log.error('Telegram: Failed to initialize:', err.message);
      this.enabled = false;
      return false;
    }
  }

  setupHandlers() {
    // Initialize default commands if not exists
    this.initializeDefaultCommands();

    // Handle all custom commands dynamically
    this.bot.onText(/\/([a-zA-Z0-9_-]+)\s*(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;

      const commandName = match[1];
      const args = match[2] || '';

      // Skip if it's a skill command (handled separately)
      if (['weather', 'search', 'stock', 'crypto', 'market', 'youtube'].includes(commandName)) {
        return; // Let the skill handler process it
      }

      // Check if it's a registered custom command
      const command = customCommands.getCommand(commandName);
      if (command) {
        this.bot.sendChatAction(chatId, 'typing');
        try {
          const result = await this.executeCustomCommand(chatId, commandName, args);
          this.bot.sendMessage(chatId, result, { parse_mode: 'HTML' });
        } catch (err) {
          this.bot.sendMessage(chatId, `❌ Command error: ${err.message}`);
        }
        return;
      }

      // Handle built-in commands that aren't in custom commands
      await this.handleBuiltInCommand(chatId, commandName, args, msg);
    });

    // Handle skill commands
    this.setupSkillHandlers();
  }

  /**
   * Initialize default commands in custom commands system
   * Clears old commands and registers fresh ones on each bot startup
   */
  initializeDefaultCommands() {
    // List of default command names that should be managed by the bot
    const defaultCommandNames = ['start', 'reset', 'model', 'local', 'cloud', 'status', 'commands', 'help', 'skills'];
    
    // Clear existing default commands first (to ensure fresh templates)
    log.info('[TELEGRAM] Clearing old default commands...');
    for (const cmdName of defaultCommandNames) {
      try {
        if (customCommands.getCommand(cmdName)) {
          removeCommand(cmdName);
          log.info(`[TELEGRAM] Removed old command: /${cmdName}`);
        }
      } catch (err) {
        log.warn(`[TELEGRAM] Could not remove /${cmdName}: ${err.message}`);
      }
    }

    const defaults = [
      {
        name: 'start',
        description: 'Start the bot and show welcome message',
        template: `Welcome to WindsurfPoolAPI Bot! 🤖

I can help you with:
• AI Chat (Cloud API or Local LLM)
• Weather Info 🌤
• Web Search 🔍
• Finance Data 📈
• YouTube Search 🎬
• AI Bash Commands 💻

Send me a message or use commands:
{{commands}}`,
        action: 'start',
      },
      {
        name: 'reset',
        description: 'Clear conversation context',
        template: '🗑 Conversation context cleared. Starting fresh!',
        action: 'reset',
      },
      {
        name: 'model',
        description: 'Switch AI model (e.g., gpt-4o-mini, claude-opus-4.6)',
        template: '🔄 Model set to: {{model}}',
        parameters: [{ name: 'model', required: true, type: 'string' }],
        action: 'setModel',
      },
      {
        name: 'local',
        description: 'Force use local LLM (Ollama)',
        template: '🏠 Local LLM mode enabled. All requests will use Ollama.',
        action: 'setLocal',
      },
      {
        name: 'cloud',
        description: 'Force use cloud API (Windsurf)',
        template: '☁️ Cloud API mode enabled. All requests will use Windsurf API.',
        action: 'setCloud',
      },
      {
        name: 'status',
        description: 'Check bot and system status',
        template: `📊 Bot Status

🤖 Model: {{model}}
⚡ Mode: {{mode}}
💬 Messages: {{contextLength}}
📡 Status: Online ✅

Use /skills to see all available skills.`,
        action: 'status',
      },
      {
        name: 'commands',
        description: 'List all available commands',
        template: `📋 Available Commands

{{commandList}}

💡 Tip: Use /help <command> for details.`,
        action: 'listCommands',
      },
      {
        name: 'help',
        description: 'Show help for a specific command',
        template: `Help: /{{command}}

{{description}}

📝 Usage: /{{command}} {{params}}`,
        parameters: [{ name: 'command', required: true, type: 'string' }],
        action: 'help',
      },
      {
        name: 'skills',
        description: 'List all AI skills (weather, search, finance, youtube)',
        template: `{{skillsHelp}}

💡 Use these skills anytime by typing:
/weather Istanbul
/search latest AI news
/stock AAPL
/youtube Node.js tutorial
/bash show disk usage`,
        action: 'skills',
      },
    ];

    // Register fresh commands
    log.info('[TELEGRAM] Registering fresh default commands...');
    for (const cmd of defaults) {
      try {
        addCommand(cmd.name, {
          description: cmd.description,
          template: cmd.template,
          parameters: cmd.parameters || [],
        });
        log.info(`[TELEGRAM] ✓ Registered: /${cmd.name}`);
      } catch (err) {
        log.warn(`[TELEGRAM] ✗ Failed to register /${cmd.name}: ${err.message}`);
      }
    }
    
    log.info(`[TELEGRAM] Command initialization complete. Total commands: ${listCommands().length}`);
  }

  /**
   * Execute a custom command
   */
  async executeCustomCommand(chatId, commandName, args) {
    const chat = this.getOrCreateChat(chatId);
    const command = customCommands.getCommand(commandName);
    
    // Parse arguments
    const params = this.parseCommandArgs(args, command.parameters);
    
    // Execute action based on command type
    switch (commandName) {
      case 'start':
        const commands = listCommands().map(c => `/${c.name} - ${c.description}`).join('\n');
        return command.template.replace('{{commands}}', commands);
      
      case 'reset':
        this.activeChats.delete(chatId);
        return command.template;
      
      case 'model':
        if (!params.model) throw new Error('Model name required');
        chat.settings.model = params.model;
        return command.template.replace('{{model}}', params.model);
      
      case 'local':
        chat.settings.forceLocal = true;
        return command.template;
      
      case 'cloud':
        chat.settings.forceLocal = false;
        return command.template;
      
      case 'status':
        return command.template
          .replace('{{model}}', chat.settings.model || config.defaultModel)
          .replace('{{mode}}', chat.settings.forceLocal ? 'Local LLM' : 'Cloud API')
          .replace('{{contextLength}}', chat.context.length);
      
      case 'commands':
        const cmdList = listCommands().map(c => `/${c.name} - ${c.description}`).join('\n');
        return command.template.replace('{{commandList}}', cmdList);
      
      case 'help':
        if (!params.command) throw new Error('Command name required');
        const targetCmd = customCommands.getCommand(params.command);
        if (!targetCmd) throw new Error(`Unknown command: ${params.command}`);
        const paramStr = targetCmd.parameters?.map(p => `<${p.name}>`).join(' ') || '';
        return `**/${params.command}**\n${targetCmd.description}\n\nUsage: /${params.command} ${paramStr}`;
      
      case 'skills':
        return getSkillsHelp();
      
      default:
        // For user-defined custom commands, execute the template
        return executeCommand(commandName, params);
    }
  }

  /**
   * Parse command arguments
   */
  parseCommandArgs(args, parameters = []) {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const result = {};
    
    if (parameters.length === 0) return result;
    
    // First parameter gets all remaining args if it's the only one
    if (parameters.length === 1 && parts.length > 0) {
      result[parameters[0].name] = args.trim();
    } else {
      // Multiple parameters - assign one by one
      parameters.forEach((param, index) => {
        if (parts[index]) {
          result[param.name] = parts[index];
        }
      });
    }
    
    return result;
  }

  /**
   * Handle built-in commands not in custom commands
   */
  async handleBuiltInCommand(chatId, commandName, args, msg) {
    switch (commandName) {
      case 'skills':
        this.bot.sendMessage(chatId, `🛠 <b>Available Skills:</b>\n\n${getSkillsHelp()}`, { parse_mode: 'HTML' });
        break;
      
      default:
        // Unknown command
        this.bot.sendMessage(chatId, `❓ Unknown command: /${commandName}\nUse /commands to see available commands.`);
    }
  }

  /**
   * Generate bash command using AI
   */
  async generateBashCommand(description) {
    const prompt = `You are a helpful assistant that converts natural language descriptions into safe bash commands.
    
User wants: "${description}"

Generate a single bash command that accomplishes this task. 
IMPORTANT SAFETY RULES:
- NEVER generate commands that delete files (rm, rmdir)
- NEVER generate commands that modify system files
- NEVER generate commands that could harm the system
- Prefer safe commands like: ls, cat, grep, ps, df, du, ping, curl, date, whoami
- For file operations, use echo, cat, head, tail only for reading

Respond with ONLY the bash command, no explanation, no markdown formatting.
If the request is unsafe or could be destructive, respond with: UNSAFE: <reason>`;

    try {
      const response = await queryLocalLLM(prompt, 'llama3.2', { temperature: 0.3, maxTokens: 200 });
      return response.trim();
    } catch (err) {
      log.error(`[TELEGRAM] Failed to generate bash command: ${err.message}`);
      throw new Error('AI command generation failed');
    }
  }

  /**
   * Handle bash command confirmation
   */
  async handleBashConfirmation(chatId, userMessage) {
    const chat = this.getOrCreateChat(chatId);
    const pendingBash = chat.pendingBashCommand;
    
    if (!pendingBash) {
      return false; // No pending command
    }

    const response = userMessage.toLowerCase().trim();
    
    if (response === 'evet' || response === 'yes' || response === 'y' || response === 'e') {
      // User confirmed - execute the command
      this.bot.sendChatAction(chatId, 'typing');
      
      try {
        const result = await executeBash(pendingBash.command, { timeout: 30000 });
        
        let output = `✅ **Komut Çalıştırıldı:**\n\`\`\`bash\n${pendingBash.command}\n\`\`\`\n\n`;
        
        if (result.stdout) {
          output += `**Çıktı:**\n\`\`\`\n${result.stdout.substring(0, 3000)}\n\`\`\`\n\n`;
        }
        
        if (result.stderr) {
          output += `**Hata:**\n\`\`\`\n${result.stderr.substring(0, 1000)}\n\`\`\`\n\n`;
        }
        
        output += `⏱️ Süre: ${result.duration}ms | Çıkış Kodu: ${result.exitCode}`;
        
        this.bot.sendMessage(chatId, output, { parse_mode: 'HTML' });
        
      } catch (err) {
        this.bot.sendMessage(chatId, `❌ <b>Hata:</b> ${err.message}`, { parse_mode: 'HTML' });
      }
      
      // Clear pending command
      delete chat.pendingBashCommand;
      return true;
      
    } else if (response === 'hayır' || response === 'no' || response === 'n' || response === 'h') {
      // User rejected
      this.bot.sendMessage(chatId, `❌ Komut iptal edildi: <code>${this.escapeHtml(pendingBash.command)}</code>`, { parse_mode: 'HTML' });
      delete chat.pendingBashCommand;
      return true;
    }
    
    return false; // Not a confirmation response
  }

  /**
   * Setup skill command handlers
   */
  setupSkillHandlers() {
    // Handle bash command with AI generation
    this.bot.onText(/\/bash\s*(.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;

      const description = match[1].trim();
      if (!description) {
        this.bot.sendMessage(chatId, '❌ Kullanım: /bash <yapılacak işlem açıklaması>\n\nÖrnek: /bash disk kullanımını göster');
        return;
      }

      this.bot.sendChatAction(chatId, 'typing');
      log.info(`[TELEGRAM] User ${chatId} requested bash command: ${description}`);

      try {
        // Generate command using AI
        const generatedCommand = await this.generateBashCommand(description);
        
        // Check if AI marked it as unsafe
        if (generatedCommand.startsWith('UNSAFE:')) {
          this.bot.sendMessage(chatId, `⚠️ <b>Güvenlik Uyarısı:</b>\n${this.escapeHtml(generatedCommand.substring(7).trim())}`, { parse_mode: 'HTML' });
          return;
        }

        // Store pending command
        const chat = this.getOrCreateChat(chatId);
        chat.pendingBashCommand = {
          command: generatedCommand,
          description: description,
          timestamp: Date.now(),
        };

        // Ask for confirmation
        const confirmMsg = `🤖 <b>AI Oluşturduğu Komut:</b>\n<pre><code>${this.escapeHtml(generatedCommand)}</code></pre>\n\n⚠️ <b>Bu komutu çalıştırmak istiyor musunuz?</b>\n\nYanıt: <b>evet</b> (çalıştır) veya <b>hayır</b> (iptal)`;
        
        this.bot.sendMessage(chatId, confirmMsg, { parse_mode: 'HTML' });
        
      } catch (err) {
        log.error(`[TELEGRAM] Bash command generation failed: ${err.message}`);
        this.bot.sendMessage(chatId, `❌ Komut oluşturulamadı: ${err.message}`);
      }
    });

    // Handle skill commands: /weather, /search, /stock, /crypto, /market, /youtube
    this.bot.onText(/\/(weather|search|stock|crypto|market|youtube)\s*(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;

      const skillName = match[1];
      const args = match[2] || '';

      this.bot.sendChatAction(chatId, 'typing');

      try {
        const result = await parseAndExecute(`/${skillName} ${args}`);
        if (result && result.success) {
          let response = '';
          if (result.result?.formatted) {
            response = result.result.formatted;
            if (result.result.commentary) {
              response += `\n\n🤖 <b>AI Yorumu:</b>\n${this.escapeHtml(result.result.commentary)}`;
            }
          } else if (result.result?.summary) {
            response = result.result.summary;
          } else {
            response = JSON.stringify(result.result, null, 2);
          }
          this.bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
        } else {
          this.bot.sendMessage(chatId, '❌ Skill execution failed. Please try again.');
        }
      } catch (err) {
        log.error(`[TELEGRAM] Skill ${skillName} failed:`, err.message);
        this.bot.sendMessage(chatId, `❌ Error: ${err.message}`);
      }
    });

    // Handle regular messages
    this.bot.on('message', async (msg) => {
      // Skip commands
      if (msg.text?.startsWith('/')) return;
      
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) {
        this.bot.sendMessage(chatId, 'Unauthorized. Chat ID: ' + chatId);
        return;
      }

      // Check for bash confirmation first
      const isBashConfirmation = await this.handleBashConfirmation(chatId, msg.text);
      if (isBashConfirmation) {
        return; // Message was handled as bash confirmation
      }

      // Process as regular message
      await this.handleMessage(chatId, msg);
    });
  }

  isAuthorized(chatId) {
    if (this.allowedChatIds.length === 0) return true; // Allow all if not configured
    return this.allowedChatIds.includes(String(chatId));
  }

  getOrCreateChat(chatId) {
    if (!this.activeChats.has(chatId)) {
      this.activeChats.set(chatId, {
        context: [],
        settings: {
          model: config.defaultModel,
          forceLocal: false,
        },
        createdAt: Date.now(),
      });
    }
    return this.activeChats.get(chatId);
  }

  async handleMessage(chatId, msg) {
    const chat = this.getOrCreateChat(chatId);
    const userMessage = msg.text || '';

    if (!userMessage.trim()) {
      this.bot.sendMessage(chatId, 'Please send a text message.');
      return;
    }

    // Show typing indicator
    this.bot.sendChatAction(chatId, 'typing');

    // Add user message to context with timestamp
    chat.context.push({ role: 'user', content: userMessage, timestamp: new Date().toISOString() });
    
    // Keep only last 20 messages for context
    if (chat.context.length > 20) {
      chat.context = chat.context.slice(-20);
    }
    
    log.info(`[TELEGRAM] Chat ${chatId} context now has ${chat.context.length} messages`);

    log.info(`[TELEGRAM] Chat ${chatId}: ${userMessage.slice(0, 50)}...`);

    try {
      let response;

      if (chat.settings.forceLocal) {
        // Force local LLM
        response = await this.queryLocalLLM(chat);
      } else {
        // Try cloud API first, fallback to local on rate limit
        response = await this.queryCloudAPI(chat);
        
        if (response.isRateLimit) {
          log.info(`[TELEGRAM] Rate limit hit, falling back to local LLM for chat ${chatId}`);
          this.bot.sendMessage(chatId, '⚠️ Cloud API rate limit reached. Switching to Local LLM...');
          this.bot.sendChatAction(chatId, 'typing');
          response = await this.queryLocalLLM(chat);
        }
      }

      // Add assistant response to context with timestamp
      if (response.content) {
        chat.context.push({ role: 'assistant', content: response.content, timestamp: new Date().toISOString() });
        log.info(`[TELEGRAM] Chat ${chatId} - added assistant response, context now has ${chat.context.length} messages`);
      }

      // Send response to Telegram
      const replyText = response.content || 'No response generated.';
      
      // Split long messages (Telegram limit is 4096 chars)
      const MAX_LENGTH = 4000;
      if (replyText.length > MAX_LENGTH) {
        const chunks = this.splitMessage(replyText, MAX_LENGTH);
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, this.escapeHtml(chunk));
        }
      } else {
        await this.bot.sendMessage(chatId, this.escapeHtml(replyText));
      }

      log.info(`[TELEGRAM] Response sent to ${chatId}: ${replyText.slice(0, 50)}...`);

    } catch (err) {
      log.error('[TELEGRAM] Error processing message:', err.message);
      this.bot.sendMessage(chatId, `Error: ${err.message}`);
    }
  }

  async queryCloudAPI(chat) {
    const body = {
      model: chat.settings.model,
      messages: chat.context,
      stream: false,
      max_tokens: config.maxTokens,
    };

    const result = await handleChatCompletions(body);
    
    if (result.status === 429 || result.body?.error?.type === 'rate_limit_exceeded') {
      return { isRateLimit: true, content: null };
    }

    if (result.status !== 200) {
      throw new Error(result.body?.error?.message || `API error: ${result.status}`);
    }

    const content = result.body?.choices?.[0]?.message?.content || '';
    return { isRateLimit: false, content };
  }

  async queryLocalLLM(chat) {
    const prompt = chat.context.map(m => 
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    const response = await queryLocalLLM(prompt, chat.settings.model);
    return { isRateLimit: false, content: response };
  }

  /**
   * Escape HTML special characters for Telegram HTML parse mode
   */
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  splitMessage(text, maxLength) {
    const chunks = [];
    let current = '';
    
    for (const line of text.split('\n')) {
      if ((current + line).length > maxLength) {
        if (current) chunks.push(current.trim());
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }
    
    if (current) chunks.push(current.trim());
    return chunks;
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      log.info('Telegram: Bot stopped');
    }
  }
}

// Singleton instance
export const telegramChannel = new TelegramChannel();

// Initialize function
export async function initTelegramChannel() {
  return await telegramChannel.initialize();
}

// Get channel status
export function getTelegramStatus() {
  const chats = [];
  log.info(`[TELEGRAM] getTelegramStatus called, activeChats: ${telegramChannel.activeChats.size}`);
  
  for (const [chatId, chat] of telegramChannel.activeChats.entries()) {
    const contextLength = chat.context?.length || 0;
    log.info(`[TELEGRAM] Chat ${chatId} has ${contextLength} messages in context`);
    
    // Get last 10 messages for preview
    const messages = (chat.context || []).slice(-10).map((msg, idx) => ({
      index: idx + 1,
      role: msg.role,
      content: msg.content?.substring(0, 200) + (msg.content?.length > 200 ? '...' : ''), // Truncate long messages
      timestamp: msg.timestamp || new Date().toISOString(),
    }));
    
    log.info(`[TELEGRAM] Returning ${messages.length} messages for chat ${chatId}`);
    
    chats.push({
      chatId,
      model: chat.settings?.model || config.defaultModel,
      mode: chat.settings?.forceLocal ? 'Local LLM' : 'Cloud API',
      messageCount: contextLength,
      createdAt: chat.createdAt || Date.now(),
      messages, // Last 10 messages for preview
    });
  }
  
  return {
    enabled: telegramChannel.enabled,
    activeChats: telegramChannel.activeChats.size,
    allowedChatIds: telegramChannel.allowedChatIds,
    chats, // Detailed chat info for dashboard
    botToken: telegramChannel.botToken ? '✓ Configured' : '✗ Not set',
  };
}
