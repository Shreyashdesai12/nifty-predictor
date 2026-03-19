// Netlify Serverless Function — Proxy for NSE Options Chain API
// NSE blocks browser-side CORS requests, so we proxy through this function.

const NSE_BASE = 'https://www.nseindia.com';
const OPTION_CHAIN_URL = `${NSE_BASE}/api/option-chain-indices?symbol=NIFTY`;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

async function getCookies() {
  const res = await fetch(NSE_BASE, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
  });

  // Extract set-cookie headers
  let cookies = '';
  try {
    const setCookies = res.headers.getSetCookie();
    if (setCookies && setCookies.length > 0) {
      cookies = setCookies.map(c => c.split(';')[0]).join('; ');
    }
  } catch {
    // Fallback: try raw headers
    const raw = res.headers.get('set-cookie');
    if (raw) {
      cookies = raw.split(',').map(c => c.split(';')[0].trim()).join('; ');
    }
  }

  return cookies;
}

async function fetchOptionChain(cookies) {
  const res = await fetch(OPTION_CHAIN_URL, {
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookies,
      'Referer': `${NSE_BASE}/option-chain`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`NSE API returned HTTP ${res.status}`);
  }

  return res.json();
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    // Step 1: Get session cookies from NSE
    const cookies = await getCookies();

    if (!cookies) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Could not obtain NSE session. NSE may be blocking automated requests.',
          fallback: true,
        }),
      };
    }

    // Step 2: Fetch options chain data
    const data = await fetchOptionChain(cookies);

    // Step 3: Return to frontend
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: err.message || 'Unknown error fetching NSE data',
        fallback: true,
      }),
    };
  }
};
