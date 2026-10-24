/* 啟動：主選單、路由、主題切換、匯出按鈕 */
(() => {
  'use strict';

  const HS = window.HS;
  const ROUTES = [
    ['overview', '總覽'],
    ['body', '身體組成'],
    ['labs', '血液與健檢'],
    ['training', '訓練'],
    ['sleep', '睡眠'],
  ];
  const view = document.getElementById('view');
  const nav = document.querySelector('.nav');

  nav.innerHTML = ROUTES.map(([k, label]) => `<a href="#/${k}" data-route="${k}">${HS.icon(k)}<span>${label}</span></a>`).join('');
  document.querySelectorAll('[data-export]').forEach((b) => {
    b.innerHTML = `${HS.icon('export')}${b.classList.contains('icon-btn') ? '' : '<span>匯出給 AI</span>'}`;
  });
  document.querySelectorAll('[data-lock]').forEach((b) => {
    b.innerHTML = `${HS.icon('lock')}${b.classList.contains('icon-btn') ? '' : '<span>鎖定</span>'}`;
  });

  function syncThemeButtons() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.innerHTML = `${HS.icon(dark ? 'sun' : 'moon')}${b.classList.contains('icon-btn') ? '' : `<span>${dark ? '淺色模式' : '深色模式'}</span>`}`;
      b.setAttribute('aria-label', dark ? '切換為淺色模式' : '切換為深色模式');
    });
  }

  const current = () => {
    const k = location.hash.replace(/^#\/?/, '');
    return ROUTES.some(([r]) => r === k) ? k : 'overview';
  };

  function render() {
    const k = current();
    HS.charts.destroyAll();
    view.onclick = null;
    HS.views[k].render(view);
    nav.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.route === k;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = `${HS.views[k].title} · HealthSpan`;
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  document.addEventListener('hs:theme', () => { syncThemeButtons(); render(); });
  HS.store.onChange(render);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) HS.toggleTheme();
    if (e.target.closest('[data-export]')) HS.exporter.open();
    // 鎖定：清掉這個分頁的登入狀態，下次要重新輸入密碼
    if (e.target.closest('[data-lock]')) {
      window.HSRemote.session.clear();
      window.location.reload();
    }
  });

  HS.applyTheme();
})();
