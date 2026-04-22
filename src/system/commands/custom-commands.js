/**
 * Custom Commands System
 * 
 * Features:
 * - Define custom /commands
 * - Command aliases
 * - Parameter parsing
 * - Command history
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log } from '../../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_FILE = resolve(process.cwd(), 'data', 'custom-commands.json');

class CustomCommandsManager {
  constructor() {
    this.commands = new Map(); // name -> { description, template, parameters }
    this.history = []; // command execution history
    this.loadCommands();
  }

  /**
   * Load commands from disk
   */
  loadCommands() {
    try {
      if (existsSync(COMMANDS_FILE)) {
        const data = JSON.parse(readFileSync(COMMANDS_FILE, 'utf-8'));
        for (const [name, cmd] of Object.entries(data.commands || {})) {
          this.commands.set(name, cmd);
        }
        log.info(`[CUSTOM-CMD] Loaded ${this.commands.size} commands`);
      }
    } catch (err) {
      log.error('[CUSTOM-CMD] Failed to load commands:', err.message);
    }
  }

  /**
   * Save commands to disk
   */
  saveCommands() {
    try {
      const data = {
        commands: Object.fromEntries(this.commands),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(COMMANDS_FILE, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      log.error('[CUSTOM-CMD] Failed to save commands:', err.message);
      return false;
    }
  }

  /**
   * Add or update a custom command
   */
  addCommand(name, { description, template, parameters = [] }) {
    // Validate command name (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Command name must be alphanumeric with hyphens/underscores');
    }

    // Validate template has required parameters
    const requiredParams = template.match(/\{\{(\w+)\}\}/g) || [];
    
    this.commands.set(name, {
      description: description || `Custom command /${name}`,
      template,
      parameters: parameters.length ? parameters : requiredParams.map(p => ({
        name: p.replace(/\{\{(\w+)\}\}/, '$1'),
        required: true,
        type: 'string',
      })),
      createdAt: this.commands.get(name)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    this.saveCommands();
    log.info(`[CUSTOM-CMD] Added command: /${name}`);
    return true;
  }

  /**
   * Remove a custom command
   */
  removeCommand(name) {
    const existed = this.commands.delete(name);
    if (existed) {
      this.saveCommands();
      log.info(`[CUSTOM-CMD] Removed command: /${name}`);
    }
    return existed;
  }

  /**
   * Get a command definition
   */
  getCommand(name) {
    return this.commands.get(name) || null;
  }

  /**
   * List all commands
   */
  listCommands() {
    return Array.from(this.commands.entries()).map(([name, cmd]) => ({
      name,
      description: cmd.description,
      parameters: cmd.parameters,
      createdAt: cmd.createdAt,
    }));
  }

  /**
   * Parse and execute a command
   */
  executeCommand(name, args = {}) {
    const cmd = this.commands.get(name);
    if (!cmd) {
      throw new Error(`Unknown command: /${name}`);
    }

    // Validate required parameters
    for (const param of cmd.parameters) {
      if (param.required && !args[param.name]) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
    }

    // Replace placeholders in template
    let result = cmd.template;
    for (const [key, value] of Object.entries(args)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // Log execution
    const execution = {
      command: name,
      args,
      result,
      timestamp: new Date().toISOString(),
    };
    this.history.push(execution);
    
    // Keep only last 1000 executions
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }

    log.info(`[CUSTOM-CMD] Executed /${name}`);
    return result;
  }

  /**
   * Parse command string (e.g., "/weather London --days 5")
   */
  parseCommandString(input) {
    if (!input.startsWith('/')) {
      return null;
    }

    const parts = input.slice(1).trim().split(/\s+/);
    const name = parts[0];
    const args = {};

    // Parse positional and named arguments
    let positionalIndex = 0;
    const cmd = this.commands.get(name);
    
    if (cmd) {
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        
        // Named argument: --key value or --key=value
        if (part.startsWith('--')) {
          const argName = part.slice(2).split('=')[0];
          const argValue = part.includes('=') 
            ? part.split('=').slice(1).join('=')
            : (i + 1 < parts.length && !parts[i + 1].startsWith('--') ? parts[++i] : 'true');
          args[argName] = argValue;
        } else {
          // Positional argument
          const param = cmd.parameters[positionalIndex];
          if (param) {
            args[param.name] = part;
            positionalIndex++;
          }
        }
      }
    }

    return { name, args };
  }

  /**
   * Get command execution history
   */
  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  /**
   * Get available commands for help display
   */
  getHelpText() {
    if (this.commands.size === 0) {
      return 'No custom commands defined. Use POST /system/commands to add commands.';
    }

    let help = 'Custom Commands:\n\n';
    for (const [name, cmd] of this.commands) {
      help += `/${name}\n`;
      help += `  ${cmd.description}\n`;
      if (cmd.parameters.length) {
        help += `  Parameters: ${cmd.parameters.map(p => 
          `${p.required ? '<' : '['}${p.name}${p.required ? '>' : ']'}`
        ).join(', ')}\n`;
      }
      help += '\n';
    }
    return help.trim();
  }
}

// Singleton instance
export const customCommands = new CustomCommandsManager();

// Export functions
export function addCommand(name, definition) {
  return customCommands.addCommand(name, definition);
}

export function removeCommand(name) {
  return customCommands.removeCommand(name);
}

export function getCommand(name) {
  return customCommands.getCommand(name);
}

export function listCommands() {
  return customCommands.listCommands();
}

export function executeCommand(name, args) {
  return customCommands.executeCommand(name, args);
}

export function parseCommandString(input) {
  return customCommands.parseCommandString(input);
}

export function getCommandHistory(limit) {
  return customCommands.getHistory(limit);
}

export function getCommandHelp() {
  return customCommands.getHelpText();
}
