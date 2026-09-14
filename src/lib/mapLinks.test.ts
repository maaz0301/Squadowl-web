import { describe, expect, it } from 'vitest';

import {
  appleDirectionsUrl,
  appleMapsUrl,
  geoUri,
  googleDirectionsUrl,
  googleMapsUrl,
  hasMappableLocation,
  looksAddressable,
  parseCoords,
  wazeUrl,
} from './mapLinks';

/** The decoded value of one query parameter, so assertions read as text. */
function param(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

describe('parseCoords', () => {
  it('reads a bare coordinate pair', () => {
    expect(parseCoords('43.6532,-79.3832')).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('tolerates spaces around the comma', () => {
    expect(parseCoords('  43.6532 , -79.3832 ')).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('is not fooled by an address that merely contains numbers', () => {
    expect(parseCoords('55 Bloor St W, Toronto')).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(parseCoords('99.5,-79.3')).toBeNull();
    expect(parseCoords('43.6,-200.1')).toBeNull();
  });
});

describe('hasMappableLocation', () => {
  it('accepts a real place', () => {
    expect(hasMappableLocation('Main Rink, 12 Front St')).toBe(true);
  });

  it('rejects empty and whitespace', () => {
    expect(hasMappableLocation(undefined)).toBe(false);
    expect(hasMappableLocation('')).toBe(false);
    expect(hasMappableLocation('   ')).toBe(false);
  });

  it('rejects the placeholders coaches type instead of an address', () => {
    for (const v of ['TBD', 'tba', 'N/A', 'na', 'none', '--']) {
      expect(hasMappableLocation(v), v).toBe(false);
    }
  });
});

describe('looksAddressable', () => {
  it('accepts a street address', () => {
    expect(looksAddressable('55 Bloor St W')).toBe(true);
  });

  it('accepts anything carrying a locality after a comma', () => {
    expect(looksAddressable('Main Rink, Oakville')).toBe(true);
  });

  it('accepts postal and ZIP codes', () => {
    expect(looksAddressable('Main Rink M5S 1M2')).toBe(true);
    expect(looksAddressable('Community Center 55416')).toBe(true);
  });

  it('accepts coordinates', () => {
    expect(looksAddressable('43.6532,-79.3832')).toBe(true);
  });

  it('flags a room name only the club would know', () => {
    expect(looksAddressable('Rink A')).toBe(false);
    expect(looksAddressable('Main Gym')).toBe(false);
  });
});

describe('googleMapsUrl', () => {
  it('searches for the location', () => {
    const url = googleMapsUrl('55 Bloor St W, Toronto');
    expect(url.startsWith('https://www.google.com/maps/search/?')).toBe(true);
    expect(param(url, 'api')).toBe('1');
    expect(param(url, 'query')).toBe('55 Bloor St W, Toronto');
  });

  it('never folds a venue or event name into the query — only the address', () => {
    // Regression check: an earlier version prefixed a caller-supplied label
    // onto the query ("Main Rink, 55 Bloor St W"). The map provider gets the
    // address alone now.
    expect(param(googleMapsUrl('55 Bloor St W'), 'query')).toBe('55 Bloor St W');
  });

  it('sends coordinates through untouched', () => {
    expect(param(googleMapsUrl('43.6532,-79.3832'), 'query')).toBe('43.6532,-79.3832');
  });
});

describe('googleDirectionsUrl', () => {
  it('routes to the location as the destination', () => {
    const url = googleDirectionsUrl('55 Bloor St W');
    expect(url.startsWith('https://www.google.com/maps/dir/?')).toBe(true);
    expect(param(url, 'destination')).toBe('55 Bloor St W');
  });
});

describe('appleMapsUrl', () => {
  it('searches for the location', () => {
    expect(param(appleMapsUrl('55 Bloor St W'), 'q')).toBe('55 Bloor St W');
  });

  it('drops a pin at coordinates rather than searching for their text', () => {
    const url = appleMapsUrl('43.6532,-79.3832');
    expect(param(url, 'll')).toBe('43.6532,-79.3832');
    expect(param(url, 'q')).toBeNull();
  });
});

describe('appleDirectionsUrl', () => {
  it('sets the destination and drives', () => {
    const url = appleDirectionsUrl('55 Bloor St W');
    expect(param(url, 'daddr')).toBe('55 Bloor St W');
    expect(param(url, 'dirflg')).toBe('d');
  });
});

describe('wazeUrl', () => {
  it('searches for the location and starts navigation', () => {
    const url = wazeUrl('55 Bloor St W');
    expect(url.startsWith('https://waze.com/ul?')).toBe(true);
    expect(param(url, 'q')).toBe('55 Bloor St W');
    expect(param(url, 'navigate')).toBe('yes');
  });

  it('drops a pin at coordinates rather than searching for their text', () => {
    const url = wazeUrl('43.6532,-79.3832');
    expect(param(url, 'll')).toBe('43.6532,-79.3832');
    expect(param(url, 'q')).toBeNull();
  });
});

describe('geoUri', () => {
  it('uses coordinates directly when it has them', () => {
    expect(geoUri('43.6532,-79.3832')).toBe('geo:43.6532,-79.3832');
  });

  it('falls back to a search query otherwise', () => {
    expect(geoUri('55 Bloor St W')).toBe('geo:0,0?q=55%20Bloor%20St%20W');
  });
});
