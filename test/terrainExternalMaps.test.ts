import { describe, expect, it } from 'vitest';
import { coordText, googleMapsDirectionsUrl, googleMapsPinUrl } from '../src/terrain/externalMaps';

// 地形探索の地点を Google マップで開く（公式の Maps URLs）

describe('externalMaps', () => {
  it('1. 座標は小数 6 桁（約 10cm）', () => {
    expect(coordText(43.1154, 140.669)).toBe('43.115400,140.669000');
  });
  it('2. ピン・経路の URL', () => {
    expect(googleMapsPinUrl(43.1154, 140.669)).toBe('https://www.google.com/maps/search/?api=1&query=43.115400%2C140.669000');
    expect(googleMapsDirectionsUrl(43.1154, 140.669)).toBe('https://www.google.com/maps/dir/?api=1&destination=43.115400%2C140.669000&travelmode=driving');
    expect(googleMapsDirectionsUrl(43.1, 140.6, 'walking')).toContain('travelmode=walking');
  });
});
