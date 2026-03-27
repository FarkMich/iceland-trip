// /api/roads.js - Vercel Edge Function
// Proxies road.is public API and returns clean, CORS-friendly JSON
// Cached at edge for 30 minutes (vercel.json Cache-Control header)

export const config = { runtime: 'edge' };

// road.is condition code -> English label + severity
const CONDITION_MAP = {
  // Icelandic status codes from Vegagerdin
  'Gott': { label: 'Good', severity: 'open' },
  'Snjór': { label: 'Snow', severity: 'caution' },
  'Is': { label: 'Ice', severity: 'caution' },
  'Snjór og is': { label: 'Snow & ice', severity: 'caution' },
  'Hálka': { label: 'Slippery', severity: 'caution' },
  'Lok': { label: 'Closed', severity: 'closed' },
  'Lokað': { label: 'Closed', severity: 'closed' },
  'Snjóflóð': { label: 'Avalanche risk', severity: 'closed' },
  'Þoka': { label: 'Fog', severity: 'caution' },
  'Slydda': { label: 'Sleet', severity: 'caution' },
  'Blautur snjór': { label: 'Wet snow', severity: 'caution' },
  'Þurrt': { label: 'Dry', severity: 'open' },
  'Blautt': { label: 'Wet', severity: 'caution' },
};

// Key route segments we care about for Iceland travel
const KEY_ROUTES = [
  { id: 'route1', name: 'Ring Road (Route 1)', query: '1' },
  { id: 'route49', name: 'Route 49 (Þingvellir)', query: '49' },
  { id: 'route35', name: 'Route 35 (Golden Circle)', query: '35' },
  { id: 'route54', name: 'Route 54 (Snæfellsnes)', query: '54' },
  { id: 'route862', name: 'Route 862 (Dettifoss)', query: '862' },
  { id: 'route36', name: 'Route 36 (Þingvellir)', query: '36' },
];

function parseCondition(icelandic) {
  if (!icelandic) return { label: 'Unknown', severity: 'check' };
  for (const [key, val] of Object.entries(CONDITION_MAP)) {
    if (icelandic.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return { label: icelandic, severity: 'check' };
}

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    // Vegagerdin (road.is) open data feeds - GeoJSON format
    // These are the actual machine-readable endpoints
    const conditionsUrl = 'https://www.vegagerdin.is/vefthjonustur/leid?format=json';
    const closedRoadsUrl = 'https://www.vegagerdin.is/vefthjonustur/lokunarlisti?format=json';

    // Also try their ATOM/RSS feed for closures
    const atomUrl = 'https://www.road.is/travel-info/road-closures/?format=atom';

    const [condRes, closureRes] = await Promise.allSettled([
      fetch(conditionsUrl, {
        headers: {
          'Accept': 'application/json, application/geo+json, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; IcelandTravelApp/1.0)',
        },
        signal: AbortSignal.timeout(8000)
      }),
      fetch(closedRoadsUrl, {
        headers: {
          'Accept': 'application/json, application/geo+json, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; IcelandTravelApp/1.0)',
        },
        signal: AbortSignal.timeout(8000)
      })
    ]);

    let conditions = [];
    let closures = [];
    let debugInfo = { condUrl: conditionsUrl };

    if (condRes.status === 'fulfilled') {
      debugInfo.condStatus = condRes.value.status;
      debugInfo.condType = condRes.value.headers.get('content-type');
      if (condRes.value.ok) {
        const raw = await condRes.value.json().catch(async (e) => {
          debugInfo.condNote = 'non-JSON: ' + e.message;
          return null;
        });
        if (raw) conditions = Array.isArray(raw) ? raw : (raw.features || raw.results || raw.data || []);
      } else {
        debugInfo.condNote = `HTTP ${condRes.value.status}`;
      }
    } else {
      debugInfo.condFail = condRes.reason?.message;
    }

    if (closureRes.status === 'fulfilled' && closureRes.value.ok) {
      const raw = await closureRes.value.json().catch(() => null);
      if (raw) closures = Array.isArray(raw) ? raw : (raw.features || raw.results || raw.data || []);
    }

    // Build summary for key routes
    const routeSummaries = KEY_ROUTES.map(route => {
      // Find matching segments for this route number
      const matching = conditions.filter(c => {
        const roadNum = c.road_number || c.vegNumer || c.properties?.road_number || '';
        return String(roadNum) === route.query;
      });

      // Determine worst condition across all segments
      let worstSeverity = 'open';
      let conditionLabels = [];

      matching.forEach(seg => {
        const condText = seg.condition || seg.condition_is || seg.properties?.condition || '';
        const parsed = parseCondition(condText);
        if (parsed.severity === 'closed') worstSeverity = 'closed';
        else if (parsed.severity === 'caution' && worstSeverity !== 'closed') worstSeverity = 'caution';
        if (parsed.label && !conditionLabels.includes(parsed.label)) {
          conditionLabels.push(parsed.label);
        }
      });

      return {
        id: route.id,
        name: route.name,
        route: route.query,
        severity: matching.length > 0 ? worstSeverity : 'check',
        conditions: conditionLabels.length > 0 ? conditionLabels.join(', ') : 'No data available',
        segmentCount: matching.length,
      };
    });

    // Active closures - filter for relevant ones
    const activeClosures = closures
      .filter(c => {
        const status = c.status || c.properties?.status || '';
        return status.toLowerCase().includes('clos') || status.toLowerCase().includes('lok');
      })
      .slice(0, 10)
      .map(c => ({
        road: c.road_number || c.vegNumer || c.properties?.road_number || 'Unknown',
        reason: c.reason || c.description || c.properties?.reason || '',
        from: c.from_location || c.properties?.from || '',
        to: c.to_location || c.properties?.to || '',
      }));

    // F-roads status (always closed Nov-May/June, open June-Oct)
    const month = new Date().getMonth() + 1; // 1-12
    const fRoadsOpen = month >= 6 && month <= 10;

    const payload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      source: 'road.is (Vegagerdin)',
      fRoads: {
        open: fRoadsOpen,
        label: fRoadsOpen ? 'Open (summer season)' : 'Closed (winter — do not enter)',
        severity: fRoadsOpen ? 'open' : 'closed',
      },
      routes: routeSummaries,
      activeClosures,
      rawConditionCount: conditions.length,
      _debug: debugInfo,
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
    // Graceful fallback - app still works, just shows "check road.is"
    return new Response(JSON.stringify({
      ok: false,
      error: 'Could not fetch live road data',
      fetchedAt: new Date().toISOString(),
      fallback: true,
      fRoads: {
        open: false,
        label: 'Check road.is directly',
        severity: 'check',
      },
      routes: [],
      activeClosures: [],
    }), {
      status: 200, // Return 200 so the app handles it gracefully, not as a network error
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}
