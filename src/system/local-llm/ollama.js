/**
 * Ollama Local LLM Integration
 * 
 * Features:
 * - Query local Ollama instance
 * - List available models
 * - Pull models
 * - Fallback for rate-limited cloud API
 */

import http from 'http';
import { log } from '../../config.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || 'llama3.2';

/**
 * Query Ollama for a completion
 */
export async function queryLocalLLM(prompt, model = DEFAULT_MODEL, options = {}) {
  const { 
    system = '',
    temperature = 0.7,
    maxTokens = 2048,
    timeout = 120000 
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL('/api/generate', OLLAMA_HOST);
    
    const requestBody = JSON.stringify({
      model,
      prompt,
      system: system || undefined,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    });

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout,
    };

    log.debug(`[OLLAMA] Querying model: ${model}`);

    const req = http.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Ollama returned ${res.statusCode}: ${data}`));
            return;
          }
          
          const response = JSON.parse(data);
          const content = response.response || '';
          
          log.debug(`[OLLAMA] Response received (${content.length} chars)`);
          resolve(content);
        } catch (err) {
          reject(new Error(`Failed to parse Ollama response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Ollama request failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timeout'));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Query Ollama with chat format (messages array)
 */
export async function queryLocalLLMChat(messages, model = DEFAULT_MODEL, options = {}) {
  // Convert messages to prompt format
  const prompt = messages.map(m => {
    if (m.role === 'system') return `System: ${m.content}\n`;
    if (m.role === 'user') return `User: ${m.content}\n`;
    if (m.role === 'assistant') return `Assistant: ${m.content}\n`;
    return `${m.content}\n`;
  }).join('') + 'Assistant: ';

  return await queryLocalLLM(prompt, model, options);
}

/**
 * List available models in Ollama
 */
export async function listOllamaModels() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/tags', OLLAMA_HOST);
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/tags',
      method: 'GET',
      timeout: 10000,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`Ollama returned ${res.statusCode}`));
            return;
          }
          
          const response = JSON.parse(data);
          const models = response.models?.map(m => ({
            name: m.name,
            size: m.size,
            modified: m.modified_at,
          })) || [];
          
          resolve(models);
        } catch (err) {
          reject(new Error(`Failed to parse Ollama models: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to list Ollama models: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Pull a model from Ollama registry
 */
export async function pullOllamaModel(modelName) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/pull', OLLAMA_HOST);
    
    const requestBody = JSON.stringify({
      name: modelName,
      stream: false,
    });

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/pull',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout: 300000, // 5 minutes for pull
    };

    log.info(`[OLLAMA] Pulling model: ${modelName}`);

    const req = http.request(reqOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 'success') {
            log.info(`[OLLAMA] Model ${modelName} pulled successfully`);
            resolve({ success: true, model: modelName });
          } else {
            resolve({ success: false, status: response.status });
          }
        } catch (err) {
          reject(new Error(`Failed to parse pull response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to pull model: ${err.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaHealth() {
  try {
    const models = await listOllamaModels();
    return { 
      available: true, 
      models: models.length,
      defaultModel: DEFAULT_MODEL,
    };
  } catch {
    return { 
      available: false, 
      models: 0,
      defaultModel: DEFAULT_MODEL,
    };
  }
}

/**
 * Get Ollama status for dashboard
 */
export function getOllamaStatus() {
  return {
    host: OLLAMA_HOST,
    defaultModel: DEFAULT_MODEL,
    env: process.env.OLLAMA_HOST ? 'custom' : 'default',
  };
}
