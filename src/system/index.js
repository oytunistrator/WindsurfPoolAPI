/**
 * System Module - Main Integration
 * 
 * Provides:
 * - Telegram Channel Integration
 * - Local LLM (Ollama) Integration
 * - Custom Commands
 * - Bash Command Execution
 */

import { log } from '../config.js';

// Sub-modules
import { 
  initTelegramChannel, 
  getTelegramStatus,
  telegramChannel 
} from './channels/telegram.js';

import {
  queryLocalLLM,
  queryLocalLLMChat,
  listOllamaModels,
  pullOllamaModel,
  checkOllamaHealth,
  getOllamaStatus,
} from './local-llm/ollama.js';

import {
  addCommand,
  removeCommand,
  getCommand,
  listCommands,
  executeCommand,
  parseCommandString,
  getCommandHistory,
  getCommandHelp,
  customCommands,
} from './commands/custom-commands.js';

import {
  executeCommand as executeBash,
  executePipeline,
  setWorkingDir,
  getWorkingDir,
  getHistory as getBashHistory,
  getStats as getBashStats,
  clearHistory as clearBashHistory,
  getBashStatus,
} from './bash/bash-executor.js';

import {
  executeSkill,
  getSkillsInfo,
  getSkillsStatus,
  parseAndExecute,
  getSkillsHelp,
  weatherSkill,
  webSearchSkill,
  financeSkill,
} from './skills/index.js';

// Initialize all system components
export async function initializeSystem() {
  log.info('[SYSTEM] Initializing system components...');

  const results = {
    telegram: false,
    ollama: { available: false },
  };

  // Initialize Telegram
  try {
    results.telegram = await initTelegramChannel();
  } catch (err) {
    log.error('[SYSTEM] Failed to initialize Telegram:', err.message);
  }

  // Check Ollama health
  try {
    results.ollama = await checkOllamaHealth();
    if (results.ollama.available) {
      log.info(`[SYSTEM] Ollama available with ${results.ollama.models} models`);
    } else {
      log.warn('[SYSTEM] Ollama not available');
    }
  } catch (err) {
    log.warn('[SYSTEM] Ollama health check failed:', err.message);
  }

  log.info('[SYSTEM] Initialization complete');
  return results;
}

// Export all functions
export {
  // Telegram
  telegramChannel,
  getTelegramStatus,
  
  // Ollama / Local LLM
  queryLocalLLM,
  queryLocalLLMChat,
  listOllamaModels,
  pullOllamaModel,
  checkOllamaHealth,
  getOllamaStatus,
  
  // Custom Commands
  addCommand,
  removeCommand,
  getCommand,
  listCommands,
  executeCommand,
  parseCommandString,
  getCommandHistory,
  getCommandHelp,
  customCommands,
  
  // Bash
  executeBash,
  executePipeline,
  setWorkingDir,
  getWorkingDir,
  getBashHistory,
  getBashStats,
  clearBashHistory,
  getBashStatus,
  
  // Skills
  executeSkill,
  getSkillsInfo,
  getSkillsStatus,
  parseAndExecute,
  getSkillsHelp,
  weatherSkill,
  webSearchSkill,
  financeSkill,
};

// Get complete system status
export function getSystemStatus() {
  return {
    telegram: getTelegramStatus(),
    ollama: getOllamaStatus(),
    bash: getBashStatus(),
    commands: {
      count: listCommands().length,
    },
    skills: getSkillsStatus(),
  };
}
