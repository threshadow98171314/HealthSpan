/* 紀錄儲存：訓練與睡眠紀錄同步到私人 GitHub 數據倉庫；離線時先存在裝置，恢復連線後自動補傳 */
(() => {
  'use strict';

  const HS = window.HS;
  const R = window.HSRemote;
  const remote = window.HS_REMOTE;
  const KINDS = ['training', 'sleep'];
  const LABEL = { training: '訓練', sleep: '睡眠' };
  const PENDING_KEY = 'healthspan:pending:v1';
  const DRAFT_KEY = 'healthspan:draft:';
  const listeners = new Set();
  const state = {};
  let lastError = null;

  // 尚未成功上傳的變更（新增／修改／刪除），依時間順序保存
  let pending = {};
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; } catch (e) { pending = {}; }
  for (const k of KINDS) if (!Array.isArray(pending[k])) pending[k] = [];
  const savePending = () => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) { /* 存不了時仍會嘗試直接上傳 */ } };

  // 把變更套用到一份紀錄上；同一筆以 updatedAt 較新的為準
  function apply(items, ops) {
    const out = items.slice();
    for (const op of ops) {
      const id = op.item ? op.item.id : op.id;
      const i = out.findIndex((x) => x.id === id);
      if (op.op === 'save') {
        if (i < 0) out.push(op.item);
        else if ((op.item.updatedAt || '') >= (out[i].updatedAt || '')) out[i] = op.item;
      } else if (op.op === 'remove' && i >= 0) {
        out.splice(i, 1);
      }
    }
    return out;
  }

  for (const k of KINDS) state[k] = { items: apply(remote.records[k].items, pending[k]), syncing: false, again: false };

  function refreshStatus() {
    const busy = KINDS.some((k) => state[k].syncing);
    const n = KINDS.reduce((a, k) => a + pending[k].length, 0);
    const [s, text] = busy ? ['busy', '同步中…']
      : n ? ['warn', lastError ? `${n} 筆未同步（${lastError}）` : `${n} 筆待同步`]
        : ['ok', '已同步'];
    document.querySelectorAll('[data-sync]').forEach((el) => {
      el.dataset.state = s;
      el.textContent = text;
      el.title = s === 'ok' ? '紀錄已存到私人數據倉庫' : text;
    });
  }
  const emit = () => { refreshStatus(); listeners.forEach((fn) => fn()); };

  async function sync(kind) {
    const st = state[kind];
    if (st.syncing) { st.again = true; return; }
    if (!pending[kind].length) return;
    st.syncing = true;
    refreshStatus();
    const ops = pending[kind].slice();
    const path = `records/${kind}.json`;
    try {
      for (let attempt = 0; ; attempt++) {
        // 每次都先抓雲端最新版本再合併，手機和電腦同時記錄也不會互相覆蓋
        const cur = await R.getFile(remote.token, path, { allowMissing: true });
        const merged = apply(cur.json || [], ops);
        try {
          await R.putFile(remote.token, path, merged, cur.sha, `${LABEL[kind]}紀錄更新 ${HS.todayStr()}`);
          pending[kind] = pending[kind].slice(ops.length);
          savePending();
          st.items = apply(merged, pending[kind]);
          lastError = null;
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 3) continue;
          throw e;
        }
      }
    } catch (e) {
      lastError = e.status === 0 ? '離線中' : e.message;
    } finally {
      st.syncing = false;
    }
    emit();
    if (st.again) { st.again = false; sync(kind); }
  }

  const syncAll = () => KINDS.forEach((k) => { if (pending[k].length) sync(k); });
  window.addEventListener('online', syncAll);
  setInterval(syncAll, 60000);

  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const sortKey = (x) => `${x.date || ''} ${x.time || x.bedtime || ''} ${x.createdAt || ''}`;

  function push(kind, op) {
    state[kind].items = apply(state[kind].items, [op]);
    pending[kind].push(op);
    savePending();
    emit();
    sync(kind);
  }

  HS.store = {
    list(kind) {
      return state[kind].items.slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    },
    get(kind, id) {
      return state[kind].items.find((x) => x.id === id) || null;
    },
    save(kind, item) {
      const now = new Date().toISOString();
      const rec = { ...item };
      if (!rec.id) { rec.id = uid(); rec.createdAt = now; }
      rec.updatedAt = now;
      push(kind, { op: 'save', item: rec });
      return rec;
    },
    remove(kind, id) {
      if (state[kind].items.some((x) => x.id === id)) push(kind, { op: 'remove', id });
    },
    dump() {
      return JSON.parse(JSON.stringify({ training: state.training.items, sleep: state.sleep.items }));
    },
    // 匯入備份：依 id 合併，同一筆以較新的 updatedAt 為準，結果會同步到雲端
    restore(obj) {
      let added = 0, updated = 0;
      for (const k of KINDS) {
        const items = obj && Array.isArray(obj[k]) ? obj[k] : [];
        const ops = [];
        for (const item of items) {
          if (!item || !item.id) continue;
          const cur = state[k].items.find((x) => x.id === item.id);
          if (!cur) added++;
          else if ((item.updatedAt || '') > (cur.updatedAt || '')) updated++;
          else continue;
          ops.push({ op: 'save', item });
        }
        if (ops.length) {
          state[k].items = apply(state[k].items, ops);
          pending[k].push(...ops);
        }
      }
      savePending();
      emit();
      syncAll();
      return { added, updated };
    },
    syncAll,
    // 表單草稿：只存在這台裝置，健身時頁面意外重新整理也不會遺失
    draft: {
      get(kind) { try { return JSON.parse(localStorage.getItem(DRAFT_KEY + kind)); } catch (e) { return null; } },
      set(kind, v) { try { localStorage.setItem(DRAFT_KEY + kind, JSON.stringify(v)); } catch (e) { /* 草稿存不了不影響主流程 */ } },
      clear(kind) { try { localStorage.removeItem(DRAFT_KEY + kind); } catch (e) { /* 同上 */ } },
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  setTimeout(() => { refreshStatus(); syncAll(); }, 0);
})();
