/**
 * Weather Skill - Hava Durumu Sorgulama
 * 
 * Providers:
 * - Yandex Weather (web scraping)
 * - Yahoo Weather (via RSS)
 */

import https from 'https';
import http from 'http';
import { log } from '../../config.js';

const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Istanbul';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'TR';

// City coordinates for Yandex (lat, lon)
const CITY_COORDS = {
  'istanbul': { lat: 41.0082, lon: 28.9784, name: 'İstanbul' },
  'ankara': { lat: 39.9334, lon: 32.8597, name: 'Ankara' },
  'izmir': { lat: 38.4192, lon: 27.1287, name: 'İzmir' },
  'bursa': { lat: 40.1828, lon: 29.0669, name: 'Bursa' },
  'antalya': { lat: 36.8969, lon: 30.7133, name: 'Antalya' },
  'adana': { lat: 36.9869, lon: 35.3253, name: 'Adana' },
  'konya': { lat: 37.8746, lon: 32.4932, name: 'Konya' },
  'gaziantep': { lat: 37.0662, lon: 37.3833, name: 'Gaziantep' },
  'kayseri': { lat: 38.7205, lon: 35.4826, name: 'Kayseri' },
  'mersin': { lat: 36.8121, lon: 34.6415, name: 'Mersin' },
  'eskisehir': { lat: 39.7767, lon: 30.5206, name: 'Eskişehir' },
  'diyarbakir': { lat: 37.9143, lon: 40.2306, name: 'Diyarbakır' },
  'samsun': { lat: 41.2867, lon: 36.33, name: 'Samsun' },
  'denizli': { lat: 37.7765, lon: 29.0864, name: 'Denizli' },
  'malatya': { lat: 38.3554, lon: 38.3335, name: 'Malatya' },
  'kahramanmaras': { lat: 37.5873, lon: 36.9372, name: 'Kahramanmaraş' },
  'erzurum': { lat: 39.9055, lon: 41.2658, name: 'Erzurum' },
  'van': { lat: 38.4946, lon: 43.3832, name: 'Van' },
  'batman': { lat: 37.8812, lon: 41.1351, name: 'Batman' },
  'elazig': { lat: 38.6748, lon: 39.2225, name: 'Elazığ' },
  // International cities
  'london': { lat: 51.5074, lon: -0.1278, name: 'London' },
  'paris': { lat: 48.8566, lon: 2.3522, name: 'Paris' },
  'berlin': { lat: 52.5200, lon: 13.4050, name: 'Berlin' },
  'new york': { lat: 40.7128, lon: -74.0060, name: 'New York' },
  'tokyo': { lat: 35.6762, lon: 139.6503, name: 'Tokyo' },
  'moscow': { lat: 55.7558, lon: 37.6173, name: 'Moscow' },
  'dubai': { lat: 25.2048, lon: 55.2708, name: 'Dubai' },
  'singapore': { lat: 1.3521, lon: 103.8198, name: 'Singapore' },
};

class WeatherSkill {
  constructor() {
    this.name = 'weather';
    this.description = 'Get current weather and forecast for a city';
  }

  /**
   * Get Yandex Weather link for a city
   */
  getYandexWeatherLink(city) {
    const cityLower = city.toLowerCase().trim();
    const coords = CITY_COORDS[cityLower];
    
    if (coords) {
      return {
        url: `https://yandex.com/weather?lat=${coords.lat}&lon=${coords.lon}`,
        name: coords.name,
        hasExactCoords: true,
      };
    }
    
    // Fallback to search URL
    return {
      url: `https://yandex.com/weather/search?request=${encodeURIComponent(city)}`,
      name: city,
      hasExactCoords: false,
    };
  }

  /**
   * Get weather from Yandex Weather (web scraping + direct link)
   */
  async getYandexWeather(city) {
    const linkInfo = this.getYandexWeatherLink(city);
    
    // Try to fetch Yandex Weather page
    return new Promise((resolve, reject) => {
      const url = linkInfo.url;
      
      https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Try to extract temperature and conditions from HTML
            const tempMatch = data.match(/temp__value[^>]*>(-?\d+)/);
            const conditionMatch = data.match(/link__condition[^>]*>([^<]+)/);
            const humidityMatch = data.match(/Влажность|Humidity[^>]*>(\d+)%/);
            const windMatch = data.match(/Ветер|Wind[^>]*>(\d+\.?\d*)/);
            
            const result = {
              provider: 'Yandex Weather',
              city: linkInfo.name,
              yandexUrl: url,
              temperature: tempMatch ? parseInt(tempMatch[1]) : null,
              description: conditionMatch ? conditionMatch[1].trim() : 'Bilgi alınamadı',
              humidity: humidityMatch ? parseInt(humidityMatch[1]) : null,
              wind_speed: windMatch ? parseFloat(windMatch[1]) : null,
              hasExactCoords: linkInfo.hasExactCoords,
              timestamp: new Date().toISOString(),
            };
            
            // If we couldn't get data, still return with link
            if (!result.temperature) {
              log.warn(`[WEATHER] Could not parse Yandex data for ${city}, returning link only`);
            }
            
            resolve(result);
          } catch (err) {
            // Return link even if parsing fails
            resolve({
              provider: 'Yandex Weather',
              city: linkInfo.name,
              yandexUrl: url,
              temperature: null,
              description: 'Detaylı bilgi için linke tıklayın',
              hasExactCoords: linkInfo.hasExactCoords,
              timestamp: new Date().toISOString(),
              parseError: true,
            });
          }
        });
      }).on('error', (err) => {
        // Return link on error
        resolve({
          provider: 'Yandex Weather',
          city: linkInfo.name,
          yandexUrl: url,
          temperature: null,
          description: 'Detaylı bilgi için linke tıklayın',
          hasExactCoords: linkInfo.hasExactCoords,
          timestamp: new Date().toISOString(),
          fetchError: err.message,
        });
      });
    });
  }

  /**
   * Get weather from Yahoo Weather (RSS feed)
   */
  async getYahooWeather(city) {
    // Yahoo Weather uses WOEID, we'll use a simple search approach
    const url = `https://query.yahooapis.com/v1/public/yql?q=${encodeURIComponent(
      `select * from weather.forecast where woeid in (select woeid from geo.places(1) where text="${city}") and u="c"`
    )}&format=json`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const channel = parsed.query?.results?.channel;
            if (!channel) {
              reject(new Error('Yahoo Weather data not found'));
              return;
            }

            const condition = channel.item?.condition;
            const result = {
              provider: 'Yahoo Weather',
              city: channel.location?.city,
              country: channel.location?.country,
              temperature: parseInt(condition?.temp),
              description: condition?.text,
              humidity: channel.atmosphere?.humidity,
              pressure: channel.atmosphere?.pressure,
              wind_speed: channel.wind?.speed,
              sunrise: channel.astronomy?.sunrise,
              sunset: channel.astronomy?.sunset,
              forecast: channel.item?.forecast?.slice(0, 3).map(f => ({
                day: f.day,
                date: f.date,
                high: f.high,
                low: f.low,
                text: f.text,
              })),
              timestamp: new Date().toISOString(),
            };
            resolve(result);
          } catch (err) {
            reject(new Error('Failed to parse Yahoo weather data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get weather with fallback providers
   */
  async getWeather(city = DEFAULT_CITY, country = DEFAULT_COUNTRY, preferred = 'auto') {
    const providers = preferred === 'auto' 
      ? ['yandex', 'yahoo']
      : [preferred];

    for (const provider of providers) {
      try {
        if (provider === 'yandex') {
          const data = await this.getYandexWeather(city);
          log.info(`[WEATHER] Yandex data for ${city}: ${data.temperature || '?'}°C`);
          return data;
        }
        if (provider === 'yahoo') {
          const data = await this.getYahooWeather(city);
          log.info(`[WEATHER] Yahoo Weather data for ${city}: ${data.temperature}°C`);
          return data;
        }
      } catch (err) {
        log.warn(`[WEATHER] ${provider} failed: ${err.message}`);
        continue;
      }
    }

    throw new Error('All weather providers failed');
  }

  /**
   * Format weather for display
   */
  formatWeather(data, format = 'text') {
    if (format === 'text') {
      let text = `🌤 **${data.city}** Hava Durumu\n\n`;
      
      if (data.temperature !== null && data.temperature !== undefined) {
        text += `🌡 Sıcaklık: **${data.temperature}°C**\n`;
      }
      
      if (data.description) {
        text += `☁️ Durum: ${data.description}\n`;
      }
      
      if (data.humidity) {
        text += `💧 Nem: %${data.humidity}\n`;
      }
      
      if (data.wind_speed) {
        text += `💨 Rüzgar: ${data.wind_speed} m/s\n`;
      }
      
      if (data.feels_like) {
        text += `🤔 Hissedilen: ${data.feels_like}°C\n`;
      }
      
      if (data.sunrise && data.sunset) {
        text += `🌅 Gün Doğumu: ${data.sunrise}\n`;
        text += `🌇 Gün Batımı: ${data.sunset}\n`;
      }
      
      if (data.forecast && data.forecast.length > 0) {
        text += `\n📅 3 Günlük Tahmin:\n`;
        data.forecast.forEach(f => {
          text += `• ${f.day}: ${f.low}°C - ${f.high}°C, ${f.text}\n`;
        });
      }
      
      // Always include Yandex link
      if (data.yandexUrl) {
        text += `\n🔗 [Yandex Weather'da Görüntüle](${data.yandexUrl})\n`;
      }
      
      text += `\n📡 Kaynak: ${data.provider}`;
      return text;
    }

    return data;
  }

  /**
   * Execute skill
   */
  async execute(args = {}) {
    const { city, country, provider = 'auto', format = 'text' } = args;
    const data = await this.getWeather(city, country, provider);
    return this.formatWeather(data, format);
  }
}

// Singleton
export const weatherSkill = new WeatherSkill();

// Export functions
export function getWeather(city, country, provider) {
  return weatherSkill.getWeather(city, country, provider);
}

export function formatWeather(data, format) {
  return weatherSkill.formatWeather(data, format);
}
