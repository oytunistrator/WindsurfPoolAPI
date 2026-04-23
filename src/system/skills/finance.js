/**
 * Finance/Stock Skill - Borsa ve Finans Verileri
 *
 * Features:
 * - Canlı hisse senedi fiyatları (Yahoo Finance - API'siz)
 * - Kripto para verileri (CoinGecko - API key'siz)
 * - AI destekli piyasa yorumu
 * - Borsa endeksleri (Yahoo Finance - API'siz)
 * - Tablo formatında gösterim
 */

import https from 'https';
import { log } from '../../config.js';
import { queryLocalLLM } from '../local-llm/ollama.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
// Yahoo Finance - API key gerektirmez
const YAHOO_FINANCE_API = 'https://query1.finance.yahoo.com/v8/finance/chart';
// Fallback: Finnhub (demo key ile)
const FINNHUB_API = 'https://finnhub.io/api/v1';
const FINNHUB_KEY = process.env.FINNHUB_KEY || 'c09r7of48v6tvt4avm20';

class FinanceSkill {
  constructor() {
    this.name = 'finance';
    this.description = 'Get stock prices, crypto data, and AI-powered market analysis';
  }

  /**
   * Get stock data from Yahoo Finance (API key'siz)
   */
  async getStockData(symbol) {
    try {
      // Try Yahoo Finance first (API key gerektirmez)
      return await this.getYahooStockData(symbol);
    } catch (err) {
      log.warn(`[FINANCE] Yahoo Finance failed for ${symbol}, trying Finnhub: ${err.message}`);
      // Fallback to Finnhub
      return await this.getFinnhubStockData(symbol);
    }
  }

  /**
   * Get stock data from Yahoo Finance (API-free)
   */
  async getYahooStockData(symbol) {
    const url = `${YAHOO_FINANCE_API}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

    return new Promise((resolve, reject) => {
      https.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const result = parsed.chart?.result?.[0];

            if (!result || !result.meta) {
              reject(new Error('No data available'));
              return;
            }

            const meta = result.meta;
            const quote = result.indicators?.quote?.[0];

            const currentPrice = meta.regularMarketPrice || meta.previousClose;
            const previousClose = meta.previousClose || meta.chartPreviousClose;
            const change = currentPrice - previousClose;
            const changePercent = previousClose ? (change / previousClose) * 100 : 0;

            resolve({
              symbol: symbol.toUpperCase(),
              name: meta.shortName || meta.longName || symbol.toUpperCase(),
              currency: meta.currency || 'USD',
              price: currentPrice,
              previousClose,
              change,
              changePercent,
              dayHigh: meta.regularMarketDayHigh || quote?.high?.[quote.high.length - 1],
              dayLow: meta.regularMarketDayLow || quote?.low?.[quote.low.length - 1],
              volume: meta.regularMarketVolume || quote?.volume?.[quote.volume.length - 1],
              timestamp: new Date().toISOString(),
              provider: 'Yahoo Finance',
            });
          } catch (err) {
            reject(new Error('Failed to parse Yahoo Finance data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Fallback: Get stock data from Finnhub API
   */
  async getFinnhubStockData(symbol) {
    const quoteUrl = `${FINNHUB_API}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;

    return new Promise((resolve, reject) => {
      https.get(quoteUrl, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const quote = JSON.parse(data);
            if (quote.error) {
              reject(new Error(quote.error));
              return;
            }

            const profileUrl = `${FINNHUB_API}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
            let companyName = symbol;
            try {
              const profileData = await this.fetchJSON(profileUrl);
              companyName = profileData.name || symbol;
            } catch (e) {
              log.warn(`[FINANCE] Could not fetch company profile for ${symbol}`);
            }

            const currentPrice = quote.c;
            const previousClose = quote.pc;
            const change = currentPrice - previousClose;
            const changePercent = previousClose ? (change / previousClose) * 100 : 0;

            resolve({
              symbol: symbol.toUpperCase(),
              name: companyName,
              currency: 'USD',
              price: currentPrice,
              previousClose,
              change,
              changePercent,
              dayHigh: quote.h,
              dayLow: quote.l,
              volume: quote.v,
              timestamp: new Date().toISOString(),
              provider: 'Finnhub',
            });
          } catch (err) {
            reject(new Error('Failed to parse stock data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Helper to fetch JSON from URL
   */
  fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get crypto data from CoinGecko
   */
  async getCryptoData(coinId, currency = 'usd') {
    const url = `${COINGECKO_API}/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;

    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error));
              return;
            }

            const marketData = parsed.market_data;
            const currentPrice = marketData?.current_price?.[currency];
            const previousPrice = marketData?.price_change_24h_in_currency?.[currency] 
              ? currentPrice - marketData.price_change_24h_in_currency[currency]
              : currentPrice;

            resolve({
              symbol: parsed.symbol?.toUpperCase(),
              name: parsed.name,
              coinId: parsed.id,
              currency,
              price: currentPrice,
              previousPrice,
              change: marketData?.price_change_24h_in_currency?.[currency],
              changePercent: marketData?.price_change_percentage_24h_in_currency?.[currency],
              marketCap: marketData?.market_cap?.[currency],
              volume24h: marketData?.total_volume?.[currency],
              high24h: marketData?.high_24h?.[currency],
              low24h: marketData?.low_24h?.[currency],
              ath: marketData?.ath?.[currency],
              athChangePercent: marketData?.ath_change_percentage?.[currency],
              timestamp: new Date().toISOString(),
              provider: 'CoinGecko',
            });
          } catch (err) {
            reject(new Error('Failed to parse crypto data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get major indices data
   */
  async getIndices() {
    const indices = [
      { symbol: '^GSPC', name: 'S&P 500' },
      { symbol: '^DJI', name: 'Dow Jones' },
      { symbol: '^IXIC', name: 'NASDAQ' },
      { symbol: '^FTSE', name: 'FTSE 100' },
      { symbol: '^N225', name: 'Nikkei 225' },
      { symbol: '^XU100', name: 'BIST 100' },
    ];

    const results = [];
    for (const idx of indices) {
      try {
        const data = await this.getStockData(idx.symbol);
        results.push(data);
      } catch (err) {
        log.warn(`[FINANCE] Failed to get ${idx.name}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Get popular crypto list
   */
  async getPopularCrypto() {
    const coins = ['bitcoin', 'ethereum', 'binancecoin', 'cardano', 'solana', 'ripple', 'polkadot', 'dogecoin'];
    const results = [];

    for (const coin of coins) {
      try {
        const data = await this.getCryptoData(coin);
        results.push(data);
      } catch (err) {
        log.warn(`[FINANCE] Failed to get ${coin}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Generate AI market commentary
   */
  async generateCommentary(data, options = {}) {
    const { type = 'stock', language = 'tr', model = 'llama3.2' } = options;

    let prompt;
    if (type === 'stock') {
      prompt = language === 'tr'
        ? `Aşağıdaki hisse senedi verilerini analiz ederek kısa bir yorum yap:\n\n` +
          `Hisse: ${data.name} (${data.symbol})\n` +
          `Fiyat: ${data.price} ${data.currency}\n` +
          `Değişim: %${data.changePercent?.toFixed(2)} (${data.change > 0 ? '+' : ''}${data.change?.toFixed(2)})\n` +
          `Gün Aralığı: ${data.dayLow} - ${data.dayHigh}\n\n` +
          `Teknik analiz perspektifinden kısa ve öz bir yorum yap. Yatım tavsiyesi değildir.`
        : `Provide a brief commentary on the following stock data:\n\n` +
          `Stock: ${data.name} (${data.symbol})\n` +
          `Price: ${data.price} ${data.currency}\n` +
          `Change: ${data.changePercent?.toFixed(2)}% (${data.change > 0 ? '+' : ''}${data.change?.toFixed(2)})\n` +
          `Day Range: ${data.dayLow} - ${data.dayHigh}\n\n` +
          `Provide a brief technical analysis perspective. Not financial advice.`;
    } else if (type === 'crypto') {
      prompt = language === 'tr'
        ? `Aşağıdaki kripto para verilerini analiz ederek kısa bir yorum yap:\n\n` +
          `Kripto: ${data.name} (${data.symbol})\n` +
          `Fiyat: $${data.price}\n` +
          `Değişim (24s): %${data.changePercent?.toFixed(2)}\n` +
          `24s Yüksek/Düşük: $${data.low24h} - $${data.high24h}\n` +
          `Piyasa Değeri: $${(data.marketCap / 1e9).toFixed(2)}B\n\n` +
          `Kısa ve öz bir yorum yap. Yatım tavsiyesi değildir.`
        : `Provide a brief commentary on the following crypto data:\n\n` +
          `Crypto: ${data.name} (${data.symbol})\n` +
          `Price: $${data.price}\n` +
          `Change (24h): ${data.changePercent?.toFixed(2)}%\n` +
          `24h High/Low: $${data.low24h} - $${data.high24h}\n` +
          `Market Cap: $${(data.marketCap / 1e9).toFixed(2)}B\n\n` +
          `Provide a brief analysis. Not financial advice.`;
    } else if (type === 'market') {
      const indicesText = data.map(i => 
        `- ${i.name}: ${i.price} (${i.changePercent > 0 ? '+' : ''}${i.changePercent?.toFixed(2)}%)`
      ).join('\n');
      
      prompt = language === 'tr'
        ? `Aşağıdaki global piyasa endekslerini analiz ederek kısa bir yorum yap:\n\n${indicesText}\n\n` +
          `Genel piyasa trendi hakkında kısa bir yorum yap.`
        : `Analyze the following global market indices:\n\n${indicesText}\n\n` +
          `Provide a brief market trend commentary.`;
    }

    try {
      log.info(`[FINANCE] Generating AI commentary for ${type}`);
      const commentary = await queryLocalLLM(prompt, model, { temperature: 0.7, maxTokens: 512 });
      return commentary;
    } catch (err) {
      log.warn(`[FINANCE] AI commentary failed: ${err.message}`);
      return language === 'tr' ? 'AI yorumu şu anda kullanılamıyor.' : 'AI commentary not available.';
    }
  }

  /**
   * Format finance data as text table
   */
  formatTable(headers, rows, widths = null) {
    if (!widths) {
      widths = headers.map((h, i) => {
        const maxData = Math.max(...rows.map(r => String(r[i] || '').length));
        return Math.max(h.length, maxData) + 2;
      });
    }

    const separator = '+' + widths.map(w => '-'.repeat(w)).join('+') + '+';

    const formatRow = (cells) => {
      return '|' + cells.map((c, i) => ' ' + String(c || '').padEnd(widths[i] - 1)).join('|') + '|';
    };

    let table = separator + '\n';
    table += formatRow(headers) + '\n';
    table += separator + '\n';
    rows.forEach(row => {
      table += formatRow(row) + '\n';
    });
    table += separator;

    return '<pre>' + table + '</pre>';
  }

  /**
   * Format finance data for display
   */
  formatFinanceData(data, type = 'stock', language = 'tr') {
    const isTR = language === 'tr';

    if (type === 'stock') {
      const changeEmoji = data.change >= 0 ? '📈' : '📉';
      const changeStr = `${data.changePercent > 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%`;

      // Table format
      const headers = ['Metrik', 'Değer'];
      const rows = [
        ['Hisse', data.name],
        ['Sembol', data.symbol],
        ['Fiyat', `${data.price} ${data.currency}`],
        ['Değişim', `${changeStr} (${data.change > 0 ? '+' : ''}${data.change?.toFixed(2)})`],
        ['Gün Aralığı', `${data.dayLow} - ${data.dayHigh}`],
        ['Hacim', data.volume?.toLocaleString() || '-'],
        ['Kaynak', data.provider],
      ];

      return `${changeEmoji} <b>${data.name}</b> (${data.symbol})\n\n` + this.formatTable(headers, rows);
    }

    if (type === 'crypto') {
      const changeEmoji = data.changePercent >= 0 ? '🚀' : '📉';
      const changeStr = `${data.changePercent > 0 ? '+' : ''}${data.changePercent?.toFixed(2)}%`;

      const headers = ['Metrik', 'Değer'];
      const rows = [
        ['Kripto', data.name],
        ['Sembol', data.symbol],
        ['Fiyat', `$${data.price?.toLocaleString()}`],
        ['Değişim (24s)', changeStr],
        ['24s Aralık', `$${data.low24h} - $${data.high24h}`],
        ['Piyasa Değeri', `$${(data.marketCap / 1e9).toFixed(2)}B`],
        ['24s Hacim', `$${(data.volume24h / 1e6).toFixed(2)}M`],
        ['ATH', `$${data.ath} (${data.athChangePercent?.toFixed(1)}%)`],
        ['Kaynak', data.provider],
      ];

      return `${changeEmoji} <b>${data.name}</b> (${data.symbol})\n\n` + this.formatTable(headers, rows);
    }

    if (type === 'market') {
      // Market indices table
      const headers = ['Endeks', 'Fiyat', 'Değişim'];
      const rows = data.map(item => [
        item.name,
        item.price?.toFixed(2) || '-',
        `${item.changePercent > 0 ? '+' : ''}${item.changePercent?.toFixed(2)}%`,
      ]);

      return `📊 <b>Global Piyasa Endeksleri</b>\n\n` + this.formatTable(headers, rows);
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Execute skill
   */
  async execute(args = {}) {
    const { 
      type = 'stock', 
      symbol,
      coin,
      currency = 'usd',
      language = 'tr',
      commentary = true,
      model = 'llama3.2',
    } = args;

    let data;
    if (type === 'stock') {
      if (!symbol) throw new Error('Stock symbol is required');
      data = await this.getStockData(symbol);
    } else if (type === 'crypto') {
      if (!coin) throw new Error('Coin ID is required');
      data = await this.getCryptoData(coin, currency);
    } else if (type === 'indices') {
      data = await this.getIndices();
    } else if (type === 'market') {
      data = await this.getIndices(); // Market shows indices
    }

    const formatted = this.formatFinanceData(data, type, language);

    let aiCommentary = '';
    if (commentary) {
      aiCommentary = await this.generateCommentary(data, { type, language, model });
    }

    return {
      data,
      formatted,
      commentary: aiCommentary,
      type,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Quick quote (text only)
   */
  async quickQuote(symbol, type = 'stock', language = 'tr') {
    const result = await this.execute({ type, symbol, coin: symbol, language });
    let text = result.formatted;
    if (result.commentary) {
      text += `\n\n🤖 **AI Yorumu:**\n${result.commentary}`;
    }
    return text;
  }
}

// Singleton
export const financeSkill = new FinanceSkill();

// Export functions
export function getStock(symbol) {
  return financeSkill.getStockData(symbol);
}

export function getCrypto(coin, currency) {
  return financeSkill.getCryptoData(coin, currency);
}

export function quickQuote(symbol, type, language) {
  return financeSkill.quickQuote(symbol, type, language);
}
