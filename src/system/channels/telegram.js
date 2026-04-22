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
    // Handle /start command
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) {
        this.bot.sendMessage(chatId, 'Unauthorized. Add your chat ID to TELEGRAM_ALLOWED_CHAT_IDS.');
        return;
      }
      this.bot.sendMessage(chatId, 
        'Welcome to WindsurfPoolAPI Bot!\n\n' +
        'Send me a message and I\'ll process it through the AI API.\n' +
        'Commands:\n' +
        '/reset - Clear conversation context\n' +
        '/model <name> - Switch model\n' +
        '/local - Force use local LLM\n' +
        '/cloud - Force use cloud API\n' +
        '/status - Check system status'
      );
    });

    // Handle /reset command
    this.bot.onText(/\/reset/, (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      this.activeChats.delete(chatId);
      this.bot.sendMessage(chatId, 'Conversation context cleared.');
    });

    // Handle /model command
    this.bot.onText(/\/model (.+)/, (msg, match) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      const model = match[1].trim();
      const chat = this.getOrCreateChat(chatId);
      chat.settings.model = model;
      this.bot.sendMessage(chatId, `Model set to: ${model}`);
    });

    // Handle /local command
    this.bot.onText(/\/local/, (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      const chat = this.getOrCreateChat(chatId);
      chat.settings.forceLocal = true;
      this.bot.sendMessage(chatId, 'Local LLM mode enabled.');
    });

    // Handle /cloud command
    this.bot.onText(/\/cloud/, (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      const chat = this.getOrCreateChat(chatId);
      chat.settings.forceLocal = false;
      this.bot.sendMessage(chatId, 'Cloud API mode enabled.');
    });

    // Handle /status command
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      
      const chat = this.getOrCreateChat(chatId);
      const status = 
        `🤖 Current Model: ${chat.settings.model || config.defaultModel}\n` +
        `⚡ Mode: ${chat.settings.forceLocal ? 'Local LLM' : 'Cloud API'}\n` +
        `💬 Context Length: ${chat.context.length} messages\n` +
        `📡 Bot Status: Online ✅`;
      this.bot.sendMessage(chatId, status);
    });

    // Handle /skills command
    this.bot.onText(/\/skills/, async (msg) => {
      const chatId = msg.chat.id;
      if (!this.isAuthorized(chatId)) return;
      
      const help = `🛠 **Available Skills:**\n\n${getSkillsHelp()}`;
      this.bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    });

    // Handle skill commands: /weather, /search, /stock, /crypto, /market
    this.bot.onText(/\/(weather|search|stock|crypto|market)\s*(.*)/, async (msg, match) => {
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
              response += `\n\n🤖 **AI Yorumu:**\n${result.result.commentary}`;
            }
          } else if (result.result?.summary) {
            response = result.result.summary;
          } else {
            response = JSON.stringify(result.result, null, 2);
          }
          this.bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
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

    // Add user message to context
    chat.context.push({ role: 'user', content: userMessage });
    
    // Keep only last 20 messages for context
    if (chat.context.length > 20) {
      chat.context = chat.context.slice(-20);
    }

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

      // Add assistant response to context
      if (response.content) {
        chat.context.push({ role: 'assistant', content: response.content });
      }

      // Send response to Telegram
      const replyText = response.content || 'No response generated.';
      
      // Split long messages (Telegram limit is 4096 chars)
      const MAX_LENGTH = 4000;
      if (replyText.length > MAX_LENGTH) {
        const chunks = this.splitMessage(replyText, MAX_LENGTH);
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await this.bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
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
  return {
    enabled: telegramChannel.enabled,
    activeChats: telegramChannel.activeChats.size,
    allowedChatIds: telegramChannel.allowedChatIds,
  };
}
