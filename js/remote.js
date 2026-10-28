/* 雲端數據：透過 GitHub API 讀寫私人數據倉庫；權杖以登入密碼加密後才存在裝置上 */
(() => {
  'use strict';

  const CFG = { owner: 'threshadow98171314', repo: 'HealthSpan-data', branch: 'main' };
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/`;
  const VAULT_KEY = 'healthspan:vault:v1';
  const SESSION_KEY = 'healthspan:session';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64 = (buf) => {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  const box = (storage) => ({
    get: (k) => { try { return storage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { storage.setItem(k, v); return true; } catch (e) { return false; } },
    del: (k) => { try { storage.removeItem(k); } catch (e) { /* 無法存取儲存空間時略過 */ } },
  });
  const local = box(window.localStorage);
  const tab = box(window.sessionStorage);

  // 密碼 → PBKDF2（SHA-256，31 萬次）→ AES-GCM 金鑰
  async function keyFrom(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  const vault = {
    has: () => !!local.get(VAULT_KEY),
    async save(token, password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), enc.encode(token));
      local.set(VAULT_KEY, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
    },
    // 密碼錯誤時 AES-GCM 驗證失敗會丟出錯誤
    async open(password) {
      const v = JSON.parse(local.get(VAULT_KEY));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, await keyFrom(password, unb64(v.salt)), unb64(v.ct));
      return dec.decode(pt);
    },
    clear: () => local.del(VAULT_KEY),
  };

  // 解鎖後的權杖只留在這個分頁，關掉分頁就要重新輸入密碼
  const session = {
    get: () => tab.get(SESSION_KEY),
    set: (t) => tab.set(SESSION_KEY, t),
    clear: () => tab.del(SESSION_KEY),
  };

  class RemoteError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const MESSAGES = { 401: '權杖無效或已過期', 403: '權杖沒有這個數據倉庫的權限', 404: '找不到數據倉庫或檔案' };

  // 讀寫倉庫內的檔案
  const call = (token, path, init = {}, accept) => send(token, `${API}${path}${init.method ? '' : `?ref=${CFG.branch}`}`, init, accept);

  async function send(token, url, init = {}, accept = 'application/vnd.github+json') {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        cache: 'no-store',
        headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
      });
    } catch (e) {
      throw new RemoteError(0, '無法連線到 GitHub');
    }
    if (!res.ok) throw new RemoteError(res.status, MESSAGES[res.status] || `GitHub 回應錯誤（${res.status}）`);
    return res;
  }

  async function getText(token, path) {
    const meta = await (await call(token, path)).json();
    // 超過 1 MB 的檔案 API 不回傳內容，改抓原始檔
    const text = meta.encoding === 'base64' && meta.content
      ? dec.decode(unb64(meta.content.replace(/\n/g, '')))
      : await (await call(token, path, {}, 'application/vnd.github.raw+json')).text();
    return { text, sha: meta.sha };
  }

  async function getFile(token, path, { allowMissing } = {}) {
    try {
      const { text, sha } = await getText(token, path);
      return { json: JSON.parse(text), sha };
    } catch (e) {
      if (allowMissing && e.status === 404) return { json: null, sha: null };
      throw e;
    }
  }

  // 列出資料夾內的檔案；資料夾不存在時回傳空陣列
  async function listDir(token, path) {
    try {
      const items = await (await call(token, path)).json();
      return Array.isArray(items) ? items : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async function deleteFile(token, path, sha, message) {
    await call(token, path, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: CFG.branch }), headers: { 'Content-Type': 'application/json' } });
  }

  async function putFile(token, path, json, sha, message) {
    const body = { message, branch: CFG.branch, content: b64(enc.encode(`${JSON.stringify(json, null, 2)}\n`)) };
    if (sha) body.sha = sha;
    const res = await call(token, path, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    return (await res.json()).content.sha;
  }

  // iPhone 捷徑把 Apple Watch 數據以 Issue 的形式送進私人倉庫（捷徑只需要固定網址與一個標頭）
  const ISSUES = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/issues`;

  async function listIssues(token) {
    const items = await (await send(token, `${ISSUES}?state=open&per_page=100&sort=created&direction=asc`)).json();
    return Array.isArray(items) ? items.filter((x) => !x.pull_request) : [];
  }

  async function closeIssue(token, number) {
    await send(token, `${ISSUES}/${number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }), headers: { 'Content-Type': 'application/json' } });
  }

  window.HSRemote = { CFG, vault, session, getText, getFile, putFile, listDir, deleteFile, listIssues, closeIssue, RemoteError };
})();
