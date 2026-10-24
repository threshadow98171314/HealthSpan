/* 啟動：登入（第一次設定／密碼解鎖）→ 從私人倉庫載入數據 → 載入網站程式 */
(() => {
  'use strict';

  const R = window.HSRemote;
  const APP = ['core', 'store', 'health-import', 'charts', 'views/overview', 'views/body', 'views/labs', 'views/training-form', 'views/training', 'views/sleep', 'export', 'app'];
  const gate = document.getElementById('gate');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function screen(html) {
    gate.hidden = false;
    gate.innerHTML = `<div class="gate-card"><div class="brand"><span class="brand-mark">H</span>HealthSpan</div>${html}</div>`;
    const first = gate.querySelector('input');
    if (first) first.focus();
  }
  const busy = (text) => screen(`<p class="gate-msg">${esc(text)}</p>`);
  const error = (msg) => (msg ? `<p class="gate-err" role="alert">${esc(msg)}</p>` : '');

  async function load(token) {
    const [hd, an, tr, sl, ah] = await Promise.all([
      R.getFile(token, 'health-data.json'),
      R.getFile(token, 'analysis.json'),
      R.getFile(token, 'records/training.json', { allowMissing: true }),
      R.getFile(token, 'records/sleep.json', { allowMissing: true }),
      R.getFile(token, 'records/apple-health.json', { allowMissing: true }),
    ]);
    return {
      data: hd.json,
      analysis: an.json,
      records: {
        training: { items: tr.json || [], sha: tr.sha },
        sleep: { items: sl.json || [], sha: sl.sha },
        appleHealth: ah.json,
      },
    };
  }

  function start(loaded, token) {
    window.HEALTH_DATA = loaded.data;
    window.HEALTH_ANALYSIS = loaded.analysis;
    window.HS_REMOTE = { token, records: loaded.records };
    gate.hidden = true;
    gate.innerHTML = '';
    document.querySelector('.app').hidden = false;
    for (const name of APP) {
      const s = document.createElement('script');
      s.src = `js/${name}.js`;
      s.async = false; // 依序執行
      document.body.appendChild(s);
    }
  }

  function showSetup(message) {
    screen(`
      <h1>連結數據倉庫</h1>
      <p class="gate-msg">第一次在這台裝置使用：貼上 GitHub 權杖，並設定這台裝置的登入密碼。權杖會用密碼加密後才存在這台裝置，只會用來連線 GitHub。</p>
      ${error(message)}
      <form class="gate-form" novalidate>
        <label class="field"><span>GitHub 權杖</span><input type="password" name="token" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
        <label class="field"><span>設定登入密碼（至少 8 個字）</span><input type="password" name="pw" autocomplete="new-password"></label>
        <label class="field"><span>再輸入一次密碼</span><input type="password" name="pw2" autocomplete="new-password"></label>
        <button class="btn primary" type="submit">連結並登入</button>
      </form>`);
    gate.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const token = f.token.value.trim();
      const pw = f.pw.value;
      if (!token) return showSetup('請貼上 GitHub 權杖');
      if (pw.length < 8) return showSetup('密碼至少要 8 個字');
      if (pw !== f.pw2.value) return showSetup('兩次輸入的密碼不一樣');
      busy('正在驗證權杖並載入數據…');
      try {
        const loaded = await load(token);
        await R.vault.save(token, pw);
        R.session.set(token);
        start(loaded, token);
      } catch (err) {
        showSetup(err.message || '連結失敗');
      }
    };
  }

  function showUnlock(message) {
    screen(`
      <h1>登入</h1>
      <p class="gate-msg">輸入這台裝置的登入密碼。</p>
      ${error(message)}
      <form class="gate-form" novalidate>
        <label class="field"><span>密碼</span><input type="password" name="pw" autocomplete="current-password"></label>
        <button class="btn primary" type="submit">登入</button>
      </form>
      <button type="button" class="btn ghost small" data-reset style="margin-top:14px">忘記密碼或要換權杖：清除這台裝置的登入資料</button>`);
    gate.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const pw = e.target.elements.pw.value;
      let token;
      busy('正在解鎖…');
      try {
        token = await R.vault.open(pw);
      } catch (err) {
        return showUnlock('密碼錯誤');
      }
      busy('正在載入數據…');
      try {
        const loaded = await load(token);
        R.session.set(token);
        start(loaded, token);
      } catch (err) {
        if ([401, 403, 404].includes(err.status)) showSetup(`${err.message}，請重新貼上權杖。`);
        else showUnlock(err.message);
      }
    };
    gate.querySelector('[data-reset]').onclick = () => {
      if (!window.confirm('清除這台裝置的登入資料？雲端的數據不受影響，之後需要重新貼上權杖。')) return;
      R.vault.clear();
      showSetup();
    };
  }

  const token = R.session.get();
  if (token) {
    busy('正在載入數據…');
    load(token).then((loaded) => start(loaded, token)).catch((err) => {
      R.session.clear();
      if (R.vault.has()) showUnlock(err.message); else showSetup(err.message);
    });
  } else if (R.vault.has()) {
    showUnlock();
  } else {
    showSetup();
  }
})();
