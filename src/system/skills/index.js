/**
 * Skills System - AI Destekli Yetenekler
 * 
 * Available Skills:
 * - Weather: Hava durumu sorgulama
 * - WebSearch: AI destekli web arama
 * - Finance: Borsa ve kripto verileri + AI yorumu
 */

import { log } from '../../config.js';
import { weatherSkill, getWeather, formatWeather } from './weather.js';
import { webSearchSkill, searchWeb, quickSearch } from './websearch.js';
import { financeSkill, getStock, getCrypto, quickQuote } from './finance.js';
import { youTubeSkill, searchYouTube, getVideoDetails, quickYouTubeSearch } from './youtube.js';

// Export all skills
export { weatherSkill, webSearchSkill, financeSkill, youTubeSkill };

// Export individual functions
export {
  // Weather
  getWeather,
  formatWeather,
  // WebSearch
  searchWeb,
  quickSearch,
  // Finance
  getStock,
  getCrypto,
  quickQuote,
  // YouTube
  searchYouTube,
  getVideoDetails,
  quickYouTubeSearch,
};

// Skills registry
export const skillsRegistry = {
  weather: {
    name: 'weather',
    description: 'Get current weather and forecast for a city',
    skill: weatherSkill,
    examples: [
      '/weather Istanbul',
      '/weather London,UK',
      '/weather New York openweather',
    ],
  },
  websearch: {
    name: 'websearch',
    description: 'Search the web with AI-powered summary',
    skill: webSearchSkill,
    examples: [
      '/search latest AI developments',
      '/search weather in Paris',
      '/search Bitcoin price analysis',
    ],
  },
  stock: {
    name: 'stock',
    description: 'Get stock prices with AI commentary',
    skill: financeSkill,
    examples: [
      '/stock AAPL',
      '/stock TSLA',
      '/stock BTC crypto',
    ],
  },
  crypto: {
    name: 'crypto',
    description: 'Get cryptocurrency data with AI analysis',
    skill: financeSkill,
    examples: [
      '/crypto bitcoin',
      '/crypto ethereum',
      '/crypto solana',
    ],
  },
  market: {
    name: 'market',
    description: 'Get market indices overview',
    skill: financeSkill,
    examples: [
      '/market',
      '/market indices',
    ],
  },
  youtube: {
    name: 'youtube',
    description: 'Search YouTube videos with AI analysis',
    skill: youTubeSkill,
    examples: [
      '/youtube Node.js tutorial',
      '/youtube Python beginner course',
      '/youtube dQw4w9WgXcQ',
    ],
  },
};

/**
 * Execute a skill by name
 */
export async function executeSkill(skillName, args = {}) {
  const skillInfo = skillsRegistry[skillName];
  if (!skillInfo) {
    throw new Error(`Unknown skill: ${skillName}. Available: ${Object.keys(skillsRegistry).join(', ')}`);
  }

  log.info(`[SKILLS] Executing skill: ${skillName}`);
  
  try {
    const result = await skillInfo.skill.execute(args);
    return {
      success: true,
      skill: skillName,
      result,
    };
  } catch (err) {
    log.error(`[SKILLS] Skill ${skillName} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get all available skills info
 */
export function getSkillsInfo() {
  return Object.entries(skillsRegistry).map(([key, info]) => ({
    key,
    name: info.name,
    description: info.description,
    examples: info.examples,
  }));
}

/**
 * Get skills status (check API keys and availability)
 */
export function getSkillsStatus() {
  return {
    weather: {
      available: true,
      providers: {
        yandex: true, // Web scraping + direct links
        yahoo: true, // Always available (no API key needed)
      },
    },
    websearch: {
      available: true,
      providers: {
        duckduckgo: true,
        serpapi: !!process.env.SERPAPI_KEY,
      },
    },
    youtube: {
      available: !!process.env.YOUTUBE_API_KEY,
      provider: 'YouTube Data API v3',
    },
    finance: {
      available: true,
      stockProvider: 'Yahoo Finance',
      cryptoProvider: 'CoinGecko',
      aiCommentary: true,
    },
  };
}

/**
 * Parse and execute skill command from text
 * Format: /skillName args...
 */
export async function parseAndExecute(input) {
  if (!input.startsWith('/')) {
    return null; // Not a skill command
  }

  const parts = input.slice(1).trim().split(/\s+/);
  const skillName = parts[0].toLowerCase();
  const argsText = parts.slice(1).join(' ');

  if (!skillsRegistry[skillName]) {
    return null; // Not a recognized skill
  }

  // Parse arguments based on skill type
  let args = {};
  
  switch (skillName) {
    case 'weather':
      // /weather [city] [,country] [provider]
      const weatherParts = argsText.split(/,\s*/);
      args.city = weatherParts[0] || 'Istanbul';
      if (weatherParts[1]) {
        // Check if second part is provider or country
        if (['openweather', 'yahoo'].includes(weatherParts[1].toLowerCase())) {
          args.provider = weatherParts[1].toLowerCase();
        } else {
          args.country = weatherParts[1].toUpperCase();
        }
      }
      break;

    case 'websearch':
    case 'search':
      args.query = argsText;
      args.summarize = true;
      break;

    case 'stock':
      // /stock [symbol]
      args.type = 'stock';
      args.symbol = argsText.toUpperCase() || 'AAPL';
      args.commentary = true;
      break;

    case 'crypto':
      // /crypto [coin]
      args.type = 'crypto';
      args.coin = argsText.toLowerCase() || 'bitcoin';
      args.commentary = true;
      break;

    case 'market':
      args.type = 'market';
      break;

    default:
      args = { text: argsText };
  }

  return await executeSkill(skillName, args);
}

/**
 * Get skills help text
 */
export function getSkillsHelp() {
  return Object.entries(skillsRegistry).map(([key, info]) => {
    return `**/${key}** - ${info.description}\n` +
      `Örnekler: ${info.examples.join(', ')}`;
  }).join('\n\n');
}
