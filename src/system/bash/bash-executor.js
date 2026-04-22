/**
 * Bash Command Executor
 * 
 * Features:
 * - Execute bash commands safely
 * - Command history
 * - Working directory management
 * - Timeout and resource limits
 * - Output capture
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { log } from '../../config.js';

const BASH_HISTORY_FILE = resolve(process.cwd(), 'data', 'bash-history.json');
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB

class BashExecutor {
  constructor() {
    this.history = [];
    this.workingDir = process.cwd();
    this.allowedCommands = (process.env.ALLOWED_BASH_COMMANDS || '')
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);
    this.blockedCommands = (process.env.BLOCKED_BASH_COMMANDS || 'rm,mv,dd,fdisk,mkfs,shutdown,reboot,halt')
      .split(',')
      .map(c => c.trim());
    this.loadHistory();
  }

  /**
   * Load command history from disk
   */
  loadHistory() {
    try {
      if (existsSync(BASH_HISTORY_FILE)) {
        const data = JSON.parse(readFileSync(BASH_HISTORY_FILE, 'utf-8'));
        this.history = data.history || [];
        log.info(`[BASH] Loaded ${this.history.length} history entries`);
      }
    } catch (err) {
      log.error('[BASH] Failed to load history:', err.message);
    }
  }

  /**
   * Save command history to disk
   */
  saveHistory() {
    try {
      const dir = resolve(process.cwd(), 'data');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = {
        history: this.history.slice(-1000), // Keep last 1000
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(BASH_HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error('[BASH] Failed to save history:', err.message);
    }
  }

  /**
   * Validate command for security
   */
  validateCommand(command) {
    const trimmed = command.trim();
    
    // Check for blocked commands
    const firstWord = trimmed.split(/\s+/)[0];
    if (this.blockedCommands.includes(firstWord)) {
      return { valid: false, error: `Command '${firstWord}' is blocked for security reasons` };
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      />\s*\/dev\/null.*&&\s*rm/,
      /curl.*\|.*sh/,
      /wget.*\|.*sh/,
      />\s*\//, // Writing to root
      /sudo/,
      /su\s+-/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        return { valid: false, error: 'Command contains potentially dangerous pattern' };
      }
    }

    // If allowedCommands is set, only allow those
    if (this.allowedCommands.length > 0) {
      if (!this.allowedCommands.includes(firstWord)) {
        return { valid: false, error: `Command '${firstWord}' is not in allowed list` };
      }
    }

    return { valid: true };
  }

  /**
   * Execute a bash command
   */
  async execute(command, options = {}) {
    const {
      timeout = DEFAULT_TIMEOUT,
      cwd = this.workingDir,
      env = process.env,
      captureOutput = true,
    } = options;

    // Validate
    const validation = this.validateCommand(command);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    log.info(`[BASH] Executing: ${command.slice(0, 100)}...`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn('bash', ['-c', command], {
        cwd,
        env: { ...env, PATH: process.env.PATH },
        stdio: captureOutput ? 'pipe' : 'inherit',
      });

      // Timeout handler
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 5 seconds if still running
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeout);

      if (captureOutput) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > MAX_OUTPUT_SIZE) {
            stdout = stdout.slice(0, MAX_OUTPUT_SIZE) + '\n... [output truncated]';
            child.kill('SIGTERM');
          }
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
          if (stderr.length > MAX_OUTPUT_SIZE) {
            stderr = stderr.slice(0, MAX_OUTPUT_SIZE) + '\n... [error output truncated]';
          }
        });
      }

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn process: ${err.message}`));
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        const result = {
          command,
          exitCode: code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
          killed,
          cwd,
          timestamp: new Date().toISOString(),
        };

        // Add to history
        this.history.push(result);
        this.saveHistory();

        if (killed && code === null) {
          resolve({ ...result, timeout: true, stdout: stdout + '\n[Command timed out]' });
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Execute multiple commands in sequence
   */
  async executePipeline(commands, options = {}) {
    const results = [];
    for (const cmd of commands) {
      const result = await this.execute(cmd, options);
      results.push(result);
      // Stop on error unless continueOnError is set
      if (result.exitCode !== 0 && !options.continueOnError) {
        break;
      }
    }
    return results;
  }

  /**
   * Set working directory
   */
  setWorkingDir(dir) {
    this.workingDir = resolve(dir);
    return this.workingDir;
  }

  /**
   * Get working directory
   */
  getWorkingDir() {
    return this.workingDir;
  }

  /**
   * Get command history
   */
  getHistory(limit = 100, filter = {}) {
    let history = [...this.history];
    
    if (filter.command) {
      history = history.filter(h => h.command.includes(filter.command));
    }
    if (filter.successOnly) {
      history = history.filter(h => h.exitCode === 0);
    }
    if (filter.since) {
      history = history.filter(h => new Date(h.timestamp) >= new Date(filter.since));
    }

    return history.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Get command stats
   */
  getStats() {
    const total = this.history.length;
    const successful = this.history.filter(h => h.exitCode === 0).length;
    const failed = total - successful;
    const avgDuration = total > 0 
      ? this.history.reduce((sum, h) => sum + h.duration, 0) / total 
      : 0;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0,
      avgDuration: Math.round(avgDuration),
      workingDir: this.workingDir,
    };
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
    this.saveHistory();
    log.info('[BASH] History cleared');
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      workingDir: this.workingDir,
      allowedCommands: this.allowedCommands,
      blockedCommands: this.blockedCommands,
      historySize: this.history.length,
    };
  }
}

// Singleton instance
export const bashExecutor = new BashExecutor();

// Export functions
export function executeCommand(command, options) {
  return bashExecutor.execute(command, options);
}

export function executePipeline(commands, options) {
  return bashExecutor.executePipeline(commands, options);
}

export function setWorkingDir(dir) {
  return bashExecutor.setWorkingDir(dir);
}

export function getWorkingDir() {
  return bashExecutor.getWorkingDir();
}

export function getHistory(limit, filter) {
  return bashExecutor.getHistory(limit, filter);
}

export function getStats() {
  return bashExecutor.getStats();
}

export function clearHistory() {
  return bashExecutor.clearHistory();
}

export function getBashStatus() {
  return bashExecutor.getStatus();
}
