const https = require('https');

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': opts.cookies || '',
        'Referer': opts.referer || '',
        'Content-Type': opts.contentType || '',
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.postData) req.write(opts.postData);
    req.end();
  });
}

async function main() {
  const jar = {};
  function addCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]).forEach(c => {
      const [k, ...v] = c.split(';')[0].split('=');
      if (k) jar[k.trim()] = v.join('=');
    });
  }
  function cookieStr() {
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // Get login page
  const loginPage = await request('https://home.51cto.com/index?reback=https%3A%2F%2Fblog.51cto.com%2Fuser%2Fsign');
  addCookies(loginPage.headers['set-cookie']);
  const csrfMatch = loginPage.body.match(/name="_csrf"[^>]*value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  // Login
  const postData = new URLSearchParams({
    '_csrf': csrf,
    'LoginForm[username]': '13931707523',
    'LoginForm[password]': 'Shidun110',
    'agree': '1',
  }).toString();

  const loginResult = await request('https://home.51cto.com/index?reback=https%3A%2F%2Fblog.51cto.com%2Fuser%2Fsign', {
    method: 'POST', cookies: cookieStr(),
    contentType: 'application/x-www-form-urlencoded',
    referer: 'https://home.51cto.com/index',
    postData,
  });
  addCookies(loginResult.headers['set-cookie']);

  console.log('Status:', loginResult.status);
  console.log('Body length:', loginResult.body.length);
  console.log('Body (first 2000 chars):');
  console.log(loginResult.body.substring(0, 2000));

  // Search for error indicators
  if (loginResult.body.includes('errorMsg')) {
    const err = loginResult.body.match(/errorMsg[^>]*>([\s\S]*?)</);
    console.log('\nError message:', err ? err[1] : 'found but empty');
  }

  // Check if there's a JS redirect
  if (loginResult.body.includes('window.location')) {
    const loc = loginResult.body.match(/window\.location[^=]*=\s*["']([^"']+)/);
    console.log('\nJS redirect:', loc ? loc[1] : 'found but no URL');
  }

  // Check for meta refresh
  if (loginResult.body.includes('meta') && loginResult.body.includes('refresh')) {
    console.log('\nMeta refresh found');
  }

  // Check if the login form is still showing (login failed)
  console.log('\nLogin form present:', loginResult.body.includes('LoginForm[username]'));
  console.log('Has nav/user area:', loginResult.body.includes('nav') || loginResult.body.includes('user-info'));
  
  // Check _identity cookie
  console.log('\n_identity:', jar['_identity'] || 'NOT SET');

  // Maybe login is actually succeeding but the _identity is being deleted
  // and set again in the same response
  // Let's look at ALL set-cookie headers
  console.log('\nAll Set-Cookie headers:');
  const setCookies = loginResult.headers['set-cookie'] || [];
  setCookies.forEach((c, i) => {
    console.log(`  ${i}: ${c.substring(0, 100)}...`);
  });
}

main().catch(e => console.error(e));
