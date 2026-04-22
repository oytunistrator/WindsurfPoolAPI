/**
 * Weather Skill - Hava Durumu Sorgulama
 * 
 * Providers:
 * - OpenWeatherMap API
 * - Yahoo Weather (via RSS)
 */

import https from 'https';
import http from 'http';
import { log } from '../../config.js';

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Istanbul';
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'TR';

class WeatherSkill {
  constructor() {
    this.name = 'weather';
    this.description = 'Get current weather and forecast for a city';
  }

  /**
   * Get weather from OpenWeatherMap
   */
  async getOpenWeather(city, country = DEFAULT_COUNTRY) {
    if (!OPENWEATHER_API_KEY) {
      throw new Error('OpenWeatherMap API key not configured');
    }

    const query = country ? `${city},${country}` : city;
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=tr`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.cod !== 200) {
              reject(new Error(parsed.message || 'Weather data not found'));
              return;
            }

            const result = {
              provider: 'OpenWeatherMap',
              city: parsed.name,
              country: parsed.sys?.country,
              temperature: Math.round(parsed.main?.temp),
              feels_like: Math.round(parsed.main?.feels_like),
              humidity: parsed.main?.humidity,
              pressure: parsed.main?.pressure,
              description: parsed.weather?.[0]?.description,
              icon: parsed.weather?.[0]?.icon,
              wind_speed: parsed.wind?.speed,
              wind_deg: parsed.wind?.deg,
              visibility: parsed.visibility,
              sunrise: parsed.sys?.sunrise ? new Date(parsed.sys.sunrise * 1000).toLocaleTimeString('tr-TR') : null,
              sunset: parsed.sys?.sunset ? new Date(parsed.sys.sunset * 1000).toLocaleTimeString('tr-TR') : null,
              timestamp: new Date().toISOString(),
            };
            resolve(result);
          } catch (err) {
            reject(new Error('Failed to parse weather data'));
          }
        });
      }).on('error', reject);
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
      ? ['openweather', 'yahoo']
      : [preferred];

    for (const provider of providers) {
      try {
        if (provider === 'openweather' && OPENWEATHER_API_KEY) {
          const data = await this.getOpenWeather(city, country);
          log.info(`[WEATHER] OpenWeather data for ${city}: ${data.temperature}°C`);
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
      let text = `🌤 **${data.city}, ${data.country}** Hava Durumu\n\n`;
      text += `🌡 Sıcaklık: **${data.temperature}°C** (Hissedilen: ${data.feels_like}°C)\n`;
      text += `☁️ Durum: ${data.description}\n`;
      text += `💧 Nem: %${data.humidity}\n`;
      text += `💨 Rüzgar: ${data.wind_speed} m/s\n`;
      if (data.sunrise && data.sunset) {
        text += `🌅 Gün Doğumu: ${data.sunrise}\n`;
        text += `🌇 Gün Batımı: ${data.sunset}\n`;
      }
      if (data.forecast) {
        text += `\n📅 3 Günlük Tahmin:\n`;
        data.forecast.forEach(f => {
          text += `• ${f.day}: ${f.low}°C - ${f.high}°C, ${f.text}\n`;
        });
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
