export const config = { runtime: 'edge' };

const GQL_URL = 'https://umferdin.is/graphql?operationName=RoadCondition&variables=%7B%22testdata%22%3Afalse%2C%22lang%22%3A%22EN%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%221c9bbebf0182c4535b4afba0fc7e58045dd764c5a1e93c5f84aa5b0d7b8a02eb%22%7D%7D';

export default async function handler(req) {
  try {
    const res = await fetch(GQL_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Referer': 'https://umferdin.is/',
      },
    });

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
