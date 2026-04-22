/**
 * YouTube Search Skill - AI Destekli YouTube Arama
 * 
 * Features:
 * - YouTube Data API ile arama
 * - Video başlık ve açıklama çekme
 * - AI destekli video özetleme
 * - Otomatik transcript çekme (opsiyonel)
 */

import https from 'https';
import { log } from '../../config.js';
import { queryLocalLLM } from '../local-llm/ollama.js';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeSkill {
  constructor() {
    this.name = 'youtube';
    this.description = 'Search YouTube videos with AI-powered analysis';
  }

  /**
   * Search YouTube using Data API
   */
  async searchYouTube(query, maxResults = 5) {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key not configured. Set YOUTUBE_API_KEY in .env');
    }

    const url = `${YOUTUBE_API_BASE}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message || 'YouTube API error'));
              return;
            }

            const videos = (parsed.items || []).map(item => ({
              videoId: item.id?.videoId,
              title: item.snippet?.title,
              description: item.snippet?.description,
              channel: item.snippet?.channelTitle,
              publishedAt: item.snippet?.publishedAt,
              thumbnail: item.snippet?.thumbnails?.medium?.url,
              url: `https://youtube.com/watch?v=${item.id?.videoId}`,
            })).filter(v => v.videoId);

            resolve({
              provider: 'YouTube Data API',
              query,
              videos,
              total: videos.length,
              timestamp: new Date().toISOString(),
            });
          } catch (err) {
            reject(new Error('Failed to parse YouTube response'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get video details with statistics
   */
  async getVideoDetails(videoId) {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key not configured');
    }

    const url = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;

    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const video = parsed.items?.[0];
            if (!video) {
              reject(new Error('Video not found'));
              return;
            }

            resolve({
              videoId,
              title: video.snippet?.title,
              description: video.snippet?.description,
              channel: video.snippet?.channelTitle,
              publishedAt: video.snippet?.publishedAt,
              duration: video.contentDetails?.duration,
              viewCount: parseInt(video.statistics?.viewCount || 0),
              likeCount: parseInt(video.statistics?.likeCount || 0),
              commentCount: parseInt(video.statistics?.commentCount || 0),
            });
          } catch (err) {
            reject(new Error('Failed to parse video details'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Analyze videos with AI
   */
  async analyzeWithAI(searchData, options = {}) {
    const { model = 'llama3.2', language = 'tr', detailed = false } = options;

    if (searchData.videos.length === 0) {
      return language === 'tr' 
        ? 'YouTube\'da sonuç bulunamadı.'
        : 'No YouTube results found.';
    }

    // Prepare video info for AI
    const videosText = searchData.videos.map((v, i) => 
      `${i + 1}. **${v.title}**\n` +
      `   Kanal: ${v.channel}\n` +
      `   Açıklama: ${v.description?.slice(0, 200)}...\n` +
      `   Link: ${v.url}`
    ).join('\n\n');

    const prompt = language === 'tr'
      ? `Aşağıdaki YouTube arama sonuçlarını analiz et:\n\n` +
        `Arama: "${searchData.query}"\n\n` +
        `Videolar:\n${videosText}\n\n` +
        `Lütfen şunları yap:\n` +
        `1. Her videonun konusunu kısaca özetle\n` +
        `2. En ilgili ve faydalı görünen videoyu belirt\n` +
        `3. Hangi videonun hangi izleyici kitlesi için uygun olduğunu açıkla\n` +
        `4. Kısa bir genel değerlendirme yap`
      : `Analyze the following YouTube search results:\n\n` +
        `Query: "${searchData.query}"\n\n` +
        `Videos:\n${videosText}\n\n` +
        `Please:\n` +
        `1. Summarize the topic of each video briefly\n` +
        `2. Identify the most relevant and useful video\n` +
        `3. Explain which audience each video is suitable for\n` +
        `4. Provide a short overall assessment`;

    try {
      log.info(`[YOUTUBE] Analyzing ${searchData.videos.length} videos with AI`);
      const analysis = await queryLocalLLM(prompt, model, { 
        temperature: 0.7, 
        maxTokens: detailed ? 2048 : 1024 
      });
      return analysis;
    } catch (err) {
      log.warn(`[YOUTUBE] AI analysis failed: ${err.message}`);
      return this.formatSimpleResults(searchData, language);
    }
  }

  /**
   * Simple text results (fallback)
   */
  formatSimpleResults(searchData, language = 'tr') {
    const header = language === 'tr'
      ? `🎬 **"${searchData.query}"** için YouTube sonuçları:\n\n`
      : `🎬 YouTube results for **"${searchData.query}"**:\n\n`;

    const videos = searchData.videos.map((v, i) => {
      const published = new Date(v.publishedAt).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US');
      return `${i + 1}. **${v.title}**\n` +
        `   👤 ${v.channel} | 📅 ${published}\n` +
        `   📝 ${v.description?.slice(0, 100)}...\n` +
        `   🔗 ${v.url}\n`;
    }).join('\n');

    return header + videos + `\n📡 Kaynak: ${searchData.provider}`;
  }

  /**
   * Format single video details
   */
  formatVideoDetails(video, language = 'tr') {
    const published = new Date(video.publishedAt).toLocaleDateString(language === 'tr' ? 'tr-TR' : 'en-US');
    const views = video.viewCount?.toLocaleString() || '?';
    const likes = video.likeCount?.toLocaleString() || '?';
    
    return `🎬 **${video.title}**\n\n` +
      `👤 Kanal: ${video.channel}\n` +
      `📅 Yayın: ${published}\n` +
      `👁 İzlenme: ${views}\n` +
      `👍 Beğeni: ${likes}\n` +
      `📝 Açıklama:\n${video.description?.slice(0, 300)}...\n\n` +
      `🔗 ${`https://youtube.com/watch?v=${video.videoId}`}`;
  }

  /**
   * Execute skill
   */
  async execute(args = {}) {
    const { 
      query, 
      videoId,
      maxResults = 5,
      analyze = true,
      model = 'llama3.2',
      language = 'tr',
      detailed = false,
    } = args;

    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API key not configured. Get one at https://console.cloud.google.com/apis/credentials');
    }

    // Get single video details
    if (videoId) {
      const video = await this.getVideoDetails(videoId);
      const formatted = this.formatVideoDetails(video, language);
      
      let aiCommentary = '';
      if (analyze) {
        const analysisPrompt = language === 'tr'
          ? `Bu YouTube videosini analiz et:\n\nBaşlık: ${video.title}\n\nAçıklama: ${video.description}\n\nKanal: ${video.channel}\n\nİzlenme: ${video.viewCount}\n\nBu video hakkında kısa bir yorum yap ve hangi izleyici kitlesi için uygun olduğunu belirt.`
          : `Analyze this YouTube video:\n\nTitle: ${video.title}\n\nDescription: ${video.description}\n\nChannel: ${video.channel}\n\nViews: ${video.viewCount}\n\nProvide a brief commentary and suggest the target audience.`;
        
        try {
          aiCommentary = await queryLocalLLM(analysisPrompt, model, { temperature: 0.7, maxTokens: 512 });
        } catch (err) {
          log.warn(`[YOUTUBE] AI commentary failed: ${err.message}`);
        }
      }

      return {
        type: 'video',
        data: video,
        formatted,
        commentary: aiCommentary,
        timestamp: new Date().toISOString(),
      };
    }

    // Search videos
    if (!query) {
      throw new Error('Query or videoId is required');
    }

    const searchData = await this.searchYouTube(query, maxResults);
    
    let analysis = '';
    if (analyze) {
      analysis = await this.analyzeWithAI(searchData, { model, language, detailed });
    }

    return {
      type: 'search',
      data: searchData,
      formatted: this.formatSimpleResults(searchData, language),
      analysis,
      timestamp: searchData.timestamp,
    };
  }

  /**
   * Quick search (text only)
   */
  async quickSearch(query, language = 'tr') {
    const result = await this.execute({ query, analyze: true, language });
    let text = result.formatted;
    if (result.analysis) {
      text += `\n\n🤖 **AI Analizi:**\n${result.analysis}`;
    }
    return text;
  }
}

// Singleton
export const youTubeSkill = new YouTubeSkill();

// Export functions
export function searchYouTube(query, maxResults) {
  return youTubeSkill.searchYouTube(query, maxResults);
}

export function getVideoDetails(videoId) {
  return youTubeSkill.getVideoDetails(videoId);
}

export function quickYouTubeSearch(query, language) {
  return youTubeSkill.quickSearch(query, language);
}
