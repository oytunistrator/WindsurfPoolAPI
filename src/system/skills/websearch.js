/**
 * Web Search Skill - AI Destekli Web Arama
 * 
 * Features:
 * - DuckDuckGo arama (rate limit olmadan)
 * - SerpAPI entegrasyonu (opsiyonel)
 * - Arama sonuçlarını AI ile özetleme
 */

import https from 'https';
import { log } from '../../config.js';
import { queryLocalLLM } from '../local-llm/ollama.js';

const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const SEARCH_TIMEOUT = 15000;

class WebSearchSkill {
  constructor() {
    this.name = 'websearch';
    this.description = 'Search the web and get AI-powered summary of results';
  }

  /**
   * Search using DuckDuckGo (HTML scraping alternative)
   * Using DuckDuckGo Lite for better performance
   */
  async searchDuckDuckGo(query, limit = 5) {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'identity',
        },
        timeout: SEARCH_TIMEOUT,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Parse results from HTML (basic regex extraction)
            const results = [];
            const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>.*?<a class="result__snippet"[^>]*>([^<]*)<\/a>/gs;
            let match;
            let count = 0;
            
            while ((match = regex.exec(data)) && count < limit) {
              results.push({
                title: this.cleanHtml(match[2]),
                url: match[1],
                snippet: this.cleanHtml(match[3]),
              });
              count++;
            }

            if (results.length === 0) {
              // Fallback: try alternative pattern
              const altRegex = /<h2 class="result__title"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>.*?<\/h2>.*?<div class="result__snippet"[^>]*>([^<]*)<\/div>/gs;
              while ((match = altRegex.exec(data)) && count < limit) {
                results.push({
                  title: this.cleanHtml(match[2]),
                  url: match[1],
                  snippet: this.cleanHtml(match[3]),
                });
                count++;
              }
            }

            resolve({
              provider: 'DuckDuckGo',
              query,
              results,
              total: results.length,
              timestamp: new Date().toISOString(),
            });
          } catch (err) {
            reject(new Error('Failed to parse search results'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Search timeout'));
      });
    });
  }

  /**
   * Search using SerpAPI (Google results)
   */
  async searchSerpAPI(query, limit = 5) {
    if (!SERPAPI_KEY) {
      throw new Error('SerpAPI key not configured');
    }

    const url = `https://serpapi.com/search?q=${encodeURIComponent(query)}&engine=google&num=${limit}&api_key=${SERPAPI_KEY}`;

    return new Promise((resolve, reject) => {
      https.get(url, { timeout: SEARCH_TIMEOUT }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const results = (parsed.organic_results || []).slice(0, limit).map(r => ({
              title: r.title,
              url: r.link,
              snippet: r.snippet,
            }));

            resolve({
              provider: 'Google (SerpAPI)',
              query,
              results,
              total: results.length,
              timestamp: new Date().toISOString(),
            });
          } catch (err) {
            reject(new Error('Failed to parse SerpAPI results'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Clean HTML entities
   */
  cleanHtml(text) {
    return text
      ?.replace(/&amp;/g, '&')
      ?.replace(/&lt;/g, '<')
      ?.replace(/&gt;/g, '>')
      ?.replace(/&quot;/g, '"')
      ?.replace(/&#39;/g, "'")
      ?.replace(/<[^>]+>/g, '')
      ?.trim() || '';
  }

  /**
   * Summarize search results using AI
   */
  async summarizeWithAI(searchData, options = {}) {
    const { model = 'llama3.2', language = 'tr' } = options;
    
    if (searchData.results.length === 0) {
      return language === 'tr' 
        ? 'Arama sonucu bulunamadı.'
        : 'No search results found.';
    }

    const resultsText = searchData.results.map((r, i) => 
      `${i + 1}. ${r.title}\n${r.snippet}\nKaynak: ${r.url}`
    ).join('\n\n');

    const prompt = language === 'tr' 
      ? `Aşağıdaki arama sonuçlarını analiz et ve özetle:\n\nSorgu: "${searchData.query}"\n\nSonuçlar:\n${resultsText}\n\nLütfen bu bilgileri kullanarak kapsamlı bir özet oluştur. Anahtar noktaları vurgula ve kaynakları belirt.`
      : `Analyze and summarize the following search results:\n\nQuery: "${searchData.query}"\n\nResults:\n${resultsText}\n\nPlease create a comprehensive summary highlighting key points and citing sources.`;

    try {
      log.info(`[WEBSEARCH] Summarizing ${searchData.results.length} results with AI`);
      const summary = await queryLocalLLM(prompt, model, { temperature: 0.7, maxTokens: 1024 });
      return summary;
    } catch (err) {
      log.warn(`[WEBSEARCH] AI summarization failed: ${err.message}`);
      // Fallback to simple text summary
      return this.formatSimpleSummary(searchData, language);
    }
  }

  /**
   * Simple text summary (fallback)
   */
  formatSimpleSummary(searchData, language = 'tr') {
    const header = language === 'tr' 
      ? `🔍 **"${searchData.query}"** için arama sonuçları:\n\n`
      : `🔍 Search results for **"${searchData.query}"**:\n\n`;

    const results = searchData.results.map((r, i) => 
      `${i + 1}. **${r.title}**\n${r.snippet}\n🔗 ${r.url}\n`
    ).join('\n');

    return header + results + `\n📡 Kaynak: ${searchData.provider}`;
  }

  /**
   * Execute web search with AI summary
   */
  async execute(args = {}) {
    const { 
      query, 
      provider = SERPAPI_KEY ? 'serpapi' : 'duckduckgo',
      limit = 5,
      summarize = true,
      model = 'llama3.2',
      language = 'tr',
    } = args;

    if (!query) {
      throw new Error('Search query is required');
    }

    // Perform search
    let searchData;
    try {
      if (provider === 'serpapi' && SERPAPI_KEY) {
        searchData = await this.searchSerpAPI(query, limit);
      } else {
        searchData = await this.searchDuckDuckGo(query, limit);
      }
    } catch (err) {
      log.error(`[WEBSEARCH] Search failed: ${err.message}`);
      throw new Error(`Search failed: ${err.message}`);
    }

    // Summarize if requested
    if (summarize) {
      const summary = await this.summarizeWithAI(searchData, { model, language });
      return {
        query,
        summary,
        results: searchData.results,
        provider: searchData.provider,
        timestamp: searchData.timestamp,
      };
    }

    return searchData;
  }

  /**
   * Quick search (text only output)
   */
  async quickSearch(query, language = 'tr') {
    const result = await this.execute({ query, summarize: true, language });
    return result.summary || this.formatSimpleSummary(result, language);
  }
}

// Singleton
export const webSearchSkill = new WebSearchSkill();

// Export functions
export function searchWeb(query, provider, limit) {
  return webSearchSkill.execute({ query, provider, limit });
}

export function quickSearch(query, language) {
  return webSearchSkill.quickSearch(query, language);
}
