/**
 * Weather Skill - Hava Durumu Sorgulama
 * 
 * Providers:
 * - Open-Meteo API (free, no API key, reliable)
 * - Geocoding API for city search
 */

import https from 'https';
import { log } from '../../config.js';

const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Istanbul';

class WeatherSkill {
  constructor() {
    this.name = 'weather';
    this.description = 'Get current weather and forecast for a city using Open-Meteo';
  }

  /**
   * Geocode city name to coordinates using Open-Meteo Geocoding API
   */
  async geocodeCity(city) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr&format=json`;
    
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.results || parsed.results.length === 0) {
              reject(new Error(`City not found: ${city}`));
              return;
            }
            const result = parsed.results[0];
            resolve({
              lat: result.latitude,
              lon: result.longitude,
              name: result.name,
              country: result.country,
              timezone: result.timezone,
            });
          } catch (err) {
            reject(new Error('Failed to parse geocoding data'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get weather from Open-Meteo API
   */
  async getOpenMeteoWeather(city) {
    // First geocode the city
    const location = await this.geocodeCity(city);
    log.info(`[WEATHER] Geocoded ${city} to ${location.lat}, ${location.lon} (${location.name}, ${location.country})`);
    
    // Then get weather data
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(location.timezone || 'auto')}&forecast_days=3`;
    
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.reason || 'Weather API error'));
              return;
            }

            const current = parsed.current;
            const daily = parsed.daily;

            // Weather code to description mapping (WMO codes)
            const weatherCodes = {
              0: 'Güneşli', 1: 'Az Bulutlu', 2: 'Parçalı Bulutlu', 3: 'Bulutlu',
              45: 'Sisli', 48: 'Kuru Sis',
              51: 'Hafif Çisenti', 53: 'Çisenti', 55: 'Yoğun Çisenti',
              61: 'Hafif Yağmurlu', 63: 'Yağmurlu', 65: 'Şiddetli Yağmurlu',
              71: 'Hafif Karlı', 73: 'Karlı', 75: 'Yoğun Karlı',
              77: 'Kar Tanesi', 80: 'Hafif Sağanak', 81: 'Sağanak', 82: 'Şiddetli Sağanak',
              85: 'Kar Sağanağı', 86: 'Yoğun Kar Sağanağı', 95: 'Gök Gürültülü Fırtına',
              96: 'Dolu', 99: 'Şiddetli Dolu',
            };

            const result = {
              provider: 'Open-Meteo',
              city: location.name,
              country: location.country,
              temperature: Math.round(current.temperature_2m),
              feels_like: Math.round(current.apparent_temperature),
              humidity: current.relative_humidity_2m,
              wind_speed: current.wind_speed_10m,
              wind_direction: current.wind_direction_10m,
              pressure: current.pressure_msl,
              description: weatherCodes[current.weather_code] || 'Bilinmiyor',
              weather_code: current.weather_code,
              timestamp: new Date().toISOString(),
              forecast: daily ? daily.time.slice(1, 4).map((t, i) => ({
                day: new Date(t).toLocaleDateString('tr-TR', { weekday: 'long' }),
                date: t,
                high: Math.round(daily.temperature_2m_max[i]),
                low: Math.round(daily.temperature_2m_min[i]),
                description: weatherCodes[daily.weather_code[i]] || 'Bilinmiyor',
              })) : [],
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
   * Get weather with fallback (only Open-Meteo now)
   */
  async getWeather(city = DEFAULT_CITY, country = null, preferred = 'auto') {
    try {
      const data = await this.getOpenMeteoWeather(city);
      log.info(`[WEATHER] Open-Meteo data for ${city}: ${data.temperature}°C`);
      return data;
    } catch (err) {
      log.error(`[WEATHER] Open-Meteo failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Format weather for display
   */
  formatWeather(data, format = 'text') {
    if (format === 'text') {
      let text = `🌤 <b>${data.city}</b> Hava Durumu\n\n`;

      if (data.temperature !== null && data.temperature !== undefined) {
        text += `🌡 Sıcaklık: <b>${data.temperature}°C</b>\n`;
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
          text += `• ${f.day}: ${f.low}°C - ${f.high}°C, ${f.description}\n`;
        });
      }

      if (data.country) {
        text += `\n🌍 ${data.city}, ${data.country}`;
      }

      text += `\n📡 Kaynak: ${data.provider} (Ücretsiz API)`;
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
