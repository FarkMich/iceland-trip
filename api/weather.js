// /api/weather.js - Vercel Edge Function
// Proxies vedur.is (Icelandic Met Office) wind & weather station data
// Cached at edge for 30 minutes

export const config = { runtime: 'edge' };

// Key vedur.is weather station IDs across Iceland
// Covering the Ring Road route and major regions
const STATIONS = [
  { id: '1',     name: 'Reykjavík',         lat: 64.13,  lon: -21.90, region: 'Capital' },
  { id: '422',   name: 'Keflavík Airport',  lat: 63.98,  lon: -22.60, region: 'Reykjanes' },
  { id: '1473',  name: 'Selfoss',           lat: 63.93,  lon: -21.00, region: 'South' },
  { id: '6210',  name: 'Vík',               lat: 63.42,  lon: -19.00, region: 'South Coast' },
  { id: '799',   name: 'Höfn',              lat: 64.25,  lon: -15.20, region: 'East' },
  { id: '3477',  name: 'Egilsstaðir',       lat: 65.28,  lon: -14.40, region: 'East Fjords' },
  { id: '571',   name: 'Akureyri',          lat: 65.68,  lon: -18.10, region: 'North' },
  { id: '2642',  name: 'Siglufjörður',      lat: 66.15,  lon: -18.92, region: 'North' },
  { id: '31572', name: 'Ísafjörður',        lat: 66.07,  lon: -23.13, region: 'Westfjords' },
  { id: '3299',  name: 'Stykkishólmur',     lat: 65.08,  lon: -22.73, region: 'Snæfellsnes' },
  { id: '2600',  name: 'Borgarnes',         lat: 64.54,  lon: -21.92, region: 'West' },
  { id: '4820',  name: 'Mývatn',            lat: 65.60,  lon: -17.00, region: 'Northeast' },
];

// Beaufort scale labels for wind speed (m/s)
function windLabel(ms) {
  if (ms === null || ms === undefined) return { label: 'N/A', level: 0 };
  if (ms < 0.5) return { label: 'Calm', level: 0 };
  if (ms < 3.3) return { label: 'Light breeze', level: 1 };
  if (ms < 5.5) return { label: 'Gentle breeze', level: 2 };
  if (ms < 7.9) return { label: 'Moderate breeze', level: 3 };
  if (ms < 10.7) return { label: 'Fresh breeze', level: 4 };
  if (ms < 13.8) return { label: 'Strong breeze', level: 5 };
  if (ms < 17.1) return { label: 'Near gale', level: 6 };
  if (ms < 20.7) return { label: 'Gale', level: 7 };
  if (ms < 24.4) return { label: 'Strong gale', level: 8 };
  return { label: 'Storm', level: 9 };
}

// Wind severity for UI coloring
function windSeverity(ms) {
  if (ms === null) return 'unknown';
  if (ms < 8) return 'ok';       // green - safe for campervans
  if (ms < 14) return 'caution'; // yellow - drive carefully
  if (ms < 20) return 'warning'; // orange - campervan risk
  return 'danger';               // red - dangerous
}

// Cardinal direction from degrees
function windDir(deg) {
  if (deg === null) return '–';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    // vedur.is XML weather API - public, no auth required
    // obs = current observations, d = daily, lang = en
    const stationIds = STATIONS.map(s => s.id).join(';');
    const vedurUrl = `https://xmlweather.vedur.is/?op_w=xml&type=obs&lang=en&view=xml&ids=${stationIds}&params=T;W;D;P;F;FX;TD`;
    // Parameters: T=temp, W=wind speed(m/s), D=wind direction, P=pressure, F=wind gust, FX=max gust, TD=dew point

    const res = await fetch(vedurUrl, {
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'User-Agent': 'IcelandTravelApp/1.0',
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error(`vedur.is returned ${res.status}`);

    const xml = await res.text();

    // Parse XML manually (no DOMParser in edge runtime)
    // Extract <station> blocks and their observation values
    const stationMatches = [...xml.matchAll(/<station\b[^>]*>([\s\S]*?)<\/station>/g)];

    const observations = stationMatches.map(match => {
      const block = match[1];

      // vedur.is XML uses BOTH formats: <W value="10.5"/> AND <W>10.5</W>
      // Must handle both patterns
      const getId = (tag) => {
        // Try value attribute first: <TAG value="X"/>
        const attrMatch = block.match(new RegExp(`<${tag}[^>]*\\bvalue="([^"]*)"[^>]*>`));
        if (attrMatch) return attrMatch[1].trim();
        // Fall back to element content: <TAG>X</TAG>
        const elemMatch = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
        return elemMatch ? elemMatch[1].trim() : null;
      };

      // Station ID from parent tag attributes
      const stationId = match[0].match(/id="([^"]+)"/)?.[1] ||
                        block.match(/<id>([^<]+)<\/id>/)?.[1];

      const tempRaw = getId('T');
      // Confirmed from raw XML: <W></W> is empty, <F> = wind speed m/s, <FX> = max gust, <D> = text direction e.g. "NNW"
      const windRaw = getId('F');    // wind speed m/s (vedur.is uses F for mean wind)
      const gustRaw = getId('FX');   // max gust m/s
      const maxGustRaw = getId('FX');
      const dirTextRaw = getId('D'); // direction as text: "NNW", "SW" etc - NOT degrees
      const pressRaw = getId('P');
      const timeRaw = getId('time') || getId('obs_time') || getId('created');

      const windMs = windRaw && windRaw !== 'N/A' && windRaw !== '' ? parseFloat(windRaw) : null;
      const gustMs = gustRaw && gustRaw !== 'N/A' && gustRaw !== '' ? parseFloat(gustRaw) : null;
      const maxGustMs = maxGustRaw && maxGustRaw !== 'N/A' && maxGustRaw !== '' ? parseFloat(maxGustRaw) : null;
      // Direction is already a text label from vedur.is (NNW, SW, etc) - use directly
      const directionLabel = dirTextRaw && dirTextRaw !== 'N/A' && dirTextRaw !== '' ? dirTextRaw : null;
      const temp = tempRaw && tempRaw !== 'N/A' && tempRaw !== '' ? parseFloat(tempRaw) : null;

      // Debug: capture raw XML of first station block
      const rawTags = stationMatches.indexOf(match) === 0
        ? block.substring(0, 400).replace(/\s+/g,' ')
        : undefined;

      // Find matching station metadata
      const station = STATIONS.find(s => String(s.id) === String(stationId));

      const windInfo = windLabel(windMs);

      return {
        stationId,
        name: station?.name || `Station ${stationId}`,
        region: station?.region || 'Iceland',
        lat: station?.lat || null,
        lon: station?.lon || null,
        observedAt: timeRaw,
        temperature: temp,
        wind: {
          speedMs: windMs,
          gustMs: gustMs,
          maxGustMs: maxGustMs,
          directionLabel: directionLabel || '–',
          label: windInfo.label,
          beaufort: windInfo.level,
          severity: windSeverity(windMs),
          campervanWarning: windMs !== null && windMs >= 14,
        },
        pressure: pressRaw ? parseFloat(pressRaw) : null,
        _debug: rawTags,
      };
    }).filter(o => o.stationId); // Remove any failed parses

    // Overall Iceland wind alert level
    const maxWind = Math.max(...observations.map(o => o.wind.speedMs || 0));
    const alertLevel = windSeverity(maxWind);
    const dangerStations = observations.filter(o => o.wind.campervanWarning).map(o => o.name);

    const payload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      source: 'vedur.is (Icelandic Met Office)',
      alert: {
        level: alertLevel,
        maxWindMs: maxWind,
        campervanWarning: dangerStations.length > 0,
        warningAreas: dangerStations,
        message: dangerStations.length > 0
          ? `Strong winds at: ${dangerStations.join(', ')}. Drive with caution.`
          : alertLevel === 'ok' ? 'Wind conditions acceptable island-wide.' : 'Moderate winds in some areas.',
      },
      stations: observations,
      stationCount: observations.length,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=300',
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Could not fetch live wind data',
      fetchedAt: new Date().toISOString(),
      fallback: true,
      alert: {
        level: 'unknown',
        campervanWarning: false,
        warningAreas: [],
        message: 'Check vedur.is for current conditions.',
      },
      stations: [],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}
