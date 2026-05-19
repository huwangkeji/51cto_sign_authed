/**
 * 51CTO博客每日签到脚本（青龙面板专用）
 * 纯HTTP请求实现，无需Puppeteer/Chromium
 * 
 * 环境变量:
 *   ICTO_BLOG_ACCOUNTS - 账号配置，格式: 账号1@密码1&账号2@密码2
 *   示例: export ICTO_BLOG_ACCOUNTS="13931707523@8888888"
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ==================== 配置 ====================
const API_BASE = 'https://api-blog.51cto.com';
const LOGIN_URL = 'https://home.51cto.com/index';
const SIGN_PAGE_URL = 'https://blog.51cto.com/user/sign';
const BLOG_HOME_URL = 'https://blog.51cto.com/';

const SCRIPT_DIR = process.env.QL_DIR
  ? path.join(process.env.QL_DIR, 'data/scripts')
  : path.dirname(require.main ? require.main.filename : __dirname);

// ==================== 工具函数 ====================
const logs = [];
function log(msg, level = 'info') {
  const time = new Date().toLocaleString('zh-CN');
  const line = `[${time}] [${level.toUpperCase()}] ${msg}`;
  logs.push(line);
  console.log(line);
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// HTTP 请求封装（支持自动跟随重定向）
function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': opts.cookies || '',
        'Referer': opts.referer || SIGN_PAGE_URL,
        'Accept': opts.accept || 'application/json, text/plain, */*',
        'Origin': 'https://blog.51cto.com',
        ...(opts.headers || {}),
      },
    };
    if (opts.contentType) {
      options.headers['Content-Type'] = opts.contentType;
    }
    const req = https.request(options, res => {
      // 处理重定向（3xx），自动跟随
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let location = res.headers.location;
        // 处理相对路径
        if (location.startsWith('/')) {
          location = `${u.protocol}//${u.hostname}${location}`;
        }
        // 收集Set-Cookie
        const result = { status: res.statusCode, headers: res.headers, body: '', redirectUrl: location };
        // 跟随重定向（最多5次）
        const maxRedirects = opts.maxRedirects !== undefined ? opts.maxRedirects : 5;
        if (maxRedirects > 0) {
          const newOpts = { ...opts, cookies: opts.cookies, maxRedirects: maxRedirects - 1 };
          // 合并重定向返回的cookies
          const jar = new CookieJar();
          jar.addFromStr(opts.cookies);
          jar.add(res.headers['set-cookie']);
          newOpts.cookies = jar.toString();
          httpRequest(location, newOpts).then(redirectResult => {
            // 合并cookies
            jar.add(redirectResult.headers['set-cookie']);
            resolve({ ...redirectResult, headers: { ...redirectResult.headers, 'set-cookie': [...(res.headers['set-cookie'] || []), ...(redirectResult.headers['set-cookie'] || [])] } });
          }).catch(reject);
        } else {
          resolve(result);
        }
        return;
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.postData) req.write(opts.postData);
    req.end();
  });
}

// Cookie 管理
class CookieJar {
  constructor() { this.map = {}; }
  add(setCookieHeaders) {
    if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return;
    setCookieHeaders.forEach(c => {
      const part = c.split(';')[0];
      const [k, ...v] = part.split('=');
      if (k) this.map[k.trim()] = v.join('=');
    });
  }
  addFromStr(cookieStr) {
    if (!cookieStr) return;
    cookieStr.split('; ').forEach(c => {
      const [k, ...v] = c.split('=');
      if (k) this.map[k.trim()] = v.join('=');
    });
  }
  toString() {
    return Object.entries(this.map).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(key) { return key in this.map && this.map[key] !== 'deleted'; }
}

// ==================== API 签名 ====================
// 签名算法: sign = md5(md5(urlPath) + md5(keys.join() + md5(token) + md5(timestamp+"")))
// urlPath 不带前导斜杠，如 "sign/run"
// keys = Object.keys({token, timestamp, sign:""}).join() = "token,timestamp,sign"
function signRequest(urlPath, token, extraData) {
  const timestamp = Math.floor(Date.now() / 1000);
  const r = { ...(extraData || {}), token, timestamp, sign: '' };
  const keys = Object.keys(r).join() || '';
  const sign = md5(md5(urlPath) + md5(keys + md5(token) + md5(timestamp + '')));
  return { ...extraData, token, timestamp, sign };
}

// ==================== 通知 ====================
async function sendNotify(title, content) {
  try {
    const notifyPath = path.join(SCRIPT_DIR, 'sendNotify.js');
    if (fs.existsSync(notifyPath)) {
      const notify = require(notifyPath);
      await notify.sendNotify(title, content);
      log('通知发送成功');
    } else {
      log('未找到sendNotify模块，跳过通知', 'warn');
    }
  } catch (e) {
    log(`通知发送失败: ${e.message}`, 'warn');
  }
}

// ==================== 账号解析 ====================
function parseAccounts() {
  const env = process.env.ICTO_BLOG_ACCOUNTS || '';
  if (!env) {
    log('未配置环境变量 ICTO_BLOG_ACCOUNTS，请设置后重试', 'error');
    return [];
  }
  const accounts = [];
  const pairs = env.split('&');
  for (const pair of pairs) {
    const parts = pair.split('@');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      accounts.push({ username: parts[0].trim(), password: parts[1].trim() });
    } else {
      log(`账号格式错误，已跳过: ${pair}`, 'warn');
    }
  }
  return accounts;
}

// ==================== 登录流程 ====================
async function doLogin(account) {
  log(`开始登录: ${account.username}`);
  const jar = new CookieJar();

  // 1. 获取登录页 + CSRF token
  const loginPage = await httpRequest(`${LOGIN_URL}?reback=${encodeURIComponent(SIGN_PAGE_URL)}`);
  jar.add(loginPage.headers['set-cookie']);

  const csrfMatch = loginPage.body.match(/name="_csrf"[^>]*value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  if (!csrf) throw new Error('获取CSRF token失败，登录页可能加载异常');
  log('已获取CSRF token');

  // 2. POST 登录（使用 URLSearchParams 正确编码）
  const postData = new URLSearchParams({
    '_csrf': csrf,
    'LoginForm[username]': account.username,
    'LoginForm[password]': account.password,
    'agree': '1',
  }).toString();

  const loginResult = await httpRequest(`${LOGIN_URL}?reback=${encodeURIComponent(SIGN_PAGE_URL)}`, {
    method: 'POST',
    cookies: jar.toString(),
    contentType: 'application/x-www-form-urlencoded',
    referer: LOGIN_URL,
    postData,
  });
  jar.add(loginResult.headers['set-cookie']);

  // 检查登录错误（只在非重定向时检查）
  if (loginResult.status === 200) {
    const errMatch = loginResult.body.match(/id="errorMsg"[^>]*>([^<]*)/);
    if (errMatch && errMatch[1].trim()) {
      throw new Error(`登录失败: ${errMatch[1].trim()}`);
    }
  }

  // 3. 登录成功后会302重定向到博客页面
  // 自动跟随重定向会收集所有cookies（包括 _identity）
  // 但跨域重定向时 cookies 可能不同步，需额外访问博客首页

  // 4. 访问博客首页确保 cookie 同步
  log('同步博客Cookie...');
  const blogHome = await httpRequest(BLOG_HOME_URL, { cookies: jar.toString() });
  jar.add(blogHome.headers['set-cookie']);

  // 注意: _identity 在 home.51cto.com 上可能被设为 deleted，
  // 但 blog.51cto.com 会重新设置有效的 _identity
  // 即使 _identity 显示 deleted，通过 pub_sauth1/pub_sauth2 等 cookie 也能登录

  // 验证登录状态：访问签到页面看是否能获取到 token
  const signPageTest = await httpRequest(SIGN_PAGE_URL, { cookies: jar.toString() });
  jar.add(signPageTest.headers['set-cookie']);

  const titleMatch = signPageTest.body.match(/<title>([^<]*)/);
  if (titleMatch && titleMatch[1].includes('每日签到')) {
    log('登录验证成功（签到页面可访问）');
  } else if (signPageTest.body.includes('home.51cto.com/index') || (titleMatch && titleMatch[1].includes('登录'))) {
    throw new Error('登录验证失败，签到页面被重定向到登录页');
  } else {
    log('登录状态不确定，继续尝试签到...', 'warn');
  }

  log('登录成功');
  return jar;
}

// ==================== 获取 Token ====================
async function getToken(cookies) {
  log('获取签到页面Token...');
  const signPage = await httpRequest(SIGN_PAGE_URL, { cookies });

  // 检查是否被重定向到登录页
  if (signPage.body.includes('home.51cto.com/index') && !signPage.body.includes('每日签到')) {
    throw new Error('签到页面被重定向，Cookie可能已失效');
  }

  // 从 __NUXT__ 数据提取 token
  const nuxtMatch = signPage.body.match(/window\.__NUXT__\s*=\s*(.+?);?\s*<\/script>/s);
  if (!nuxtMatch) throw new Error('未找到__NUXT__数据，页面加载异常');

  const tokenMatch = nuxtMatch[1].match(/token["']?\s*[:=]\s*["']([^"']+)/);
  if (!tokenMatch) throw new Error('未找到API token，可能需要重新登录');

  log('Token获取成功');
  return tokenMatch[1];
}

// ==================== 签到流程 ====================
async function doSign(jar, account) {
  const cookies = jar.toString();

  // 1. 获取 Token
  const token = await getToken(cookies);

  // 2. 先检查签到状态 (GET /sign/run)
  log('检查签到状态...');
  const checkData = signRequest('sign/run', token);
  const checkParams = new URLSearchParams(checkData).toString();
  const checkResult = await httpRequest(`${API_BASE}/sign/run?${checkParams}`, {
    cookies, method: 'GET',
  });

  let checkResp;
  try { checkResp = JSON.parse(checkResult.body); } catch (e) {
    throw new Error('签到状态API返回异常: ' + checkResult.body.substring(0, 200));
  }

  if (checkResp.code === 0 && checkResp.data && checkResp.data.alert === 1) {
    log('今日已签到，无需重复签到');
    return { success: true, msg: '今日已签到' };
  }

  // 3. 执行签到 (POST /sign/run)
  log('执行签到...');
  const signData = signRequest('sign/run', token);
  const signBody = JSON.stringify(signData);
  const signResult = await httpRequest(`${API_BASE}/sign/run`, {
    cookies,
    method: 'POST',
    contentType: 'application/json',
    postData: signBody,
  });

  let signResp;
  try { signResp = JSON.parse(signResult.body); } catch (e) {
    throw new Error('签到API返回异常: ' + signResult.body.substring(0, 200));
  }

  if (signResp.code === 0) {
    const alert = signResp.data && signResp.data.alert;
    if (alert === 1) {
      log('签到成功！');
      return { success: true, msg: '签到成功' };
    } else {
      // alert=0 可能表示已签到或签到完成
      log('签到请求成功（可能今日已签到）');
      return { success: true, msg: '签到请求成功' };
    }
  } else {
    return { success: false, msg: `签到失败: ${signResp.msg || '未知错误'}` };
  }
}

// ==================== 主函数 ====================
async function main() {
  log('========== 51CTO博客签到脚本启动 ==========');
  log(`脚本目录: ${SCRIPT_DIR}`);

  const accounts = parseAccounts();
  if (accounts.length === 0) {
    log('没有可用的账号配置，脚本退出', 'error');
    await sendNotify('51CTO签到失败', '未配置账号环境变量 ICTO_BLOG_ACCOUNTS\n格式: 账号@密码，多账号用 & 分隔');
    process.exit(1);
  }

  log(`共配置 ${accounts.length} 个账号`);
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    log(`\n---------- 处理账号 ${i + 1}/${accounts.length}: ${account.username} ----------`);

    try {
      const jar = await doLogin(account);
      const signResult = await doSign(jar, account);
      results.push({
        username: account.username,
        status: signResult.success ? '成功' : '失败',
        msg: signResult.msg,
      });
    } catch (err) {
      log(`账号 ${account.username} 处理异常: ${err.message}`, 'error');
      results.push({
        username: account.username,
        status: '异常',
        msg: err.message,
      });
    }
  }

  // 汇总结果
  log('\n========== 签到结果汇总 ==========');
  let notifyBody = '';
  for (const r of results) {
    const line = `${r.username}: ${r.status} - ${r.msg}`;
    log(line);
    notifyBody += line + '\n';
  }

  const allSuccess = results.every(r => r.status === '成功');
  const hasError = results.some(r => r.status === '异常');
  let notifyTitle;
  if (allSuccess) {
    notifyTitle = '51CTO博客签到成功';
  } else if (hasError) {
    notifyTitle = '51CTO博客签到出现异常';
  } else {
    notifyTitle = '51CTO博客签到部分失败';
  }

  await sendNotify(notifyTitle, notifyBody);
  log('脚本执行完毕');
  process.exit(allSuccess ? 0 : 1);
}

main().catch(err => {
  console.error('未捕获的异常:', err);
  process.exit(1);
});
