// /api/roads.js - Vercel Edge Function
// Fetches road & travel conditions from safetravel.is (Icelandic Association for Search and Rescue)
// safetravel.is has a clean public API unlike road.is which has no documented JSON endpoint
// Cached at edge for 30 minutes

export const config = { runtime: 'edge' };

function getFRoadStatus() {
  const month = new Date().getMonth() + 1;
  if (month >= 6 && month <= 9) return { open: true, label: 'Open (summer season)', severity: 'open' };
  if (month === 5 || month === 10) return { open: false, label: 'Mostly closed — check road.is per route', severity: 'caution' };
  return { open: false, label: 'Closed (winter) — do not enter under any circumstances', severity: 'closed' };
}

const KEY_ROUTES = [
  { id: 'route1',   name: 'Ring Road (Route 1)',      note: 'Open year-round. Ice patches possible at elevation.' },
  { id: 'route49',  name: 'Route 49 (Þingvellir)',    note: 'Paved. Check for ice in winter.' },
  { id: 'route35',  name: 'Route 35 (Golden Circle)', note: 'Well-maintained tourist road.' },
  { id: 'route54',  name: 'Route 54 (Snæfellsnes)',   note: 'Can be icy near the glacier.' },
  { id: 'route862', name: 'Route 862 (Dettifoss)',    note: 'Verify on road.is before driving.' },
  { id: 'route36',  name: 'Route 36 (Þingvellir)',    note: 'Paved. Generally open.' },
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    // safetravel.is WordPress REST API - travel alerts feed
    const alertsUrl = 'https://safetravel.is/wp-json/wp/v2/posts?per_page=8&_fields=title,excerpt,date,link';

    const res = await fetch(alertsUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; IcelandTravelApp/1.0)',
      },
      signal: AbortSignal.timeout(8000)
    });

    let alerts = [];
    let debugInfo = { alertsUrl, status: res.status, contentType: res.headers.get('content-type') };

    if (res.ok) {
      const raw = await res.json().catch(e => { debugInfo.parseError = e.message; return null; });
      if (Array.isArray(raw)) {
        alerts = raw.map(post => ({
          title: post.title?.rendered?.replace(/<[^>]+>/g, '') || '',
          summary: post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim().substring(0, 200) || '',
          date: post.date,
          url: post.link,
        }));
        debugInfo.alertCount = alerts.length;
      }
    }

    const alertText = alerts.map(a => a.title + ' ' + a.summary).join(' ').toLowerCase();
    let overallSeverity = 'open';
    if (alertText.includes('clos') || alertText.includes('danger') || alertText.includes('prohibit')) overallSeverity = 'closed';
    else if (alertText.includes('caution') || alertText.includes('warning') || alertText.includes('ice') || alertText.includes('snow')) overallSeverity = 'caution';

    return new Response(JSON.stringify({
      ok: true,
      fetchedAt: new Date().toISOString(),
      source: 'safetravel.is',
      fRoads: getFRoadStatus(),
      overallSeverity,
      alerts,
      alertCount: alerts.length,
      routes: KEY_ROUTES.map(r => ({
        ...r,
        severity: r.id === 'route1' ? 'open' : 'check',
        conditions: r.note,
      })),
      _debug: debugInfo,
    }), {
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
      error: err.message,
      fetchedAt: new Date().toISOString(),
      fallback: true,
      fRoads: getFRoadStatus(),
      overallSeverity: 'check',
      alerts: [],
      routes: KEY_ROUTES.map(r => ({ ...r, severity: 'check', conditions: r.note })),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
