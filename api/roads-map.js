export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const res = await fetch('https://umferdin.is/en', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = await res.text();

    // Rewrite absolute URLs so assets load correctly
    const rewritten = html
      .replace(/href="\//g, 'href="https://umferdin.is/')
      .replace(/src="\//g, 'src="https://umferdin.is/')
      .replace(/action="\//g, 'action="https://umferdin.is/')
      .replace(/url\(\//g, 'url(https://umferdin.is/');

    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        // Deliberately omit X-Frame-Options so our iframe can embed it
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    // Fallback — redirect to the real site if proxy fails
    return new Response(
      `<!DOCTYPE html><html><body style="margin:0;background:#0d1219;color:#7EC8E3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
        <div>
          <div style="font-size:32px;margin-bottom:12px">🛣️</div>
          <div style="font-size:14px;margin-bottom:16px">Road map unavailable<br><span style="font-size:12px;color:#4a6080">umferdin.is could not be loaded</span></div>
          <a href="https://umferdin.is/en" target="_blank" style="padding:10px 20px;background:#E85D26;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Open umferdin.is</a>
        </div>
      </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
