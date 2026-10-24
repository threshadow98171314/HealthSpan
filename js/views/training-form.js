/* 訓練紀錄表單：新增／編輯，動作清單、組數快速輸入、草稿自動保存 */
(() => {
  'use strict';

  const HS = window.HS;
  const { esc, icon } = HS;

  const MUSCLES = {
    chest: '胸', back: '背', shoulders: '肩', biceps: '二頭', triceps: '三頭', quads: '股四頭',
    hamstrings: '腿後側', glutes: '臀', calves: '小腿', core: '核心', cardio: '有氧',
  };
  const LIBRARY = {
    chest: ['槓鈴臥推', '啞鈴臥推', '上斜槓鈴臥推', '上斜啞鈴臥推', '機械胸推', '蝴蝶機夾胸', '繩索夾胸', '雙槓撐體', '伏地挺身'],
    back: ['引體向上', '滑輪下拉', '槓鈴划船', '單手啞鈴划船', '坐姿划船', 'T 槓划船', '硬舉', '直臂下拉'],
    shoulders: ['槓鈴肩推', '啞鈴肩推', '機械肩推', '側平舉', '繩索側平舉', '反向飛鳥', '臉拉', '前平舉'],
    biceps: ['槓鈴彎舉', '啞鈴彎舉', '錘式彎舉', '牧師椅彎舉', '繩索彎舉'],
    triceps: ['繩索下壓', '過頭三頭伸展', '窄握臥推', '仰臥三頭伸展'],
    quads: ['槓鈴深蹲', '前蹲舉', '腿推', '哈克深蹲', '保加利亞分腿蹲', '腿伸屈', '弓箭步'],
    hamstrings: ['羅馬尼亞硬舉', '坐姿腿彎舉', '俯臥腿彎舉'],
    glutes: ['臀推', '髖外展機'],
    calves: ['站姿提踵', '坐姿提踵'],
    core: ['棒式', '懸垂舉腿', '繩索捲腹', '健腹輪'],
    cardio: ['跑步機', '飛輪', '划船機', '橢圓機', '爬樓梯機', '快走'],
  };
  const MUSCLE_OF = {};
  for (const [m, names] of Object.entries(LIBRARY)) for (const n of names) MUSCLE_OF[n] = m;
  const TITLES = ['推（胸・肩・三頭）', '拉（背・二頭）', '腿', '上半身', '下半身', '全身', '有氧'];

  const emptySet = (prev) => (prev ? { ...prev } : { kg: null, reps: null });
  const emptyExercise = () => ({ name: '', muscle: 'chest', sets: [emptySet()] });
  const blank = () => ({ date: HS.todayStr(), title: '', durationMin: null, notes: '', exercises: [emptyExercise()] });
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

  function setRow(ex, i, j) {
    const s = ex.sets[j];
    const cardio = ex.muscle === 'cardio';
    const a = cardio ? ['min', '分鐘', 'numeric'] : ['kg', '公斤', 'decimal'];
    const b = cardio ? ['km', '公里（可空白）', 'decimal'] : ['reps', '次數', 'numeric'];
    return `<div class="set-row">
      <span class="idx">${j + 1}</span>
      <input type="number" step="any" min="0" inputmode="${a[2]}" placeholder="${a[1]}" aria-label="第 ${j + 1} 組${a[1]}" data-ex="${i}" data-set="${j}" data-field="${a[0]}" value="${s[a[0]] ?? ''}">
      <input type="number" step="any" min="0" inputmode="${b[2]}" placeholder="${b[1]}" aria-label="第 ${j + 1} 組${b[1]}" data-ex="${i}" data-set="${j}" data-field="${b[0]}" value="${s[b[0]] ?? ''}">
      <button type="button" class="icon-btn" data-act="del-set" data-ex="${i}" data-set="${j}" aria-label="刪除第 ${j + 1} 組">${icon('x')}</button>
    </div>`;
  }

  function exerciseCard(ex, i) {
    return `<div class="ex-card" data-card="${i}">
      <div class="ex-head">
        <label class="field"><span>動作 ${i + 1}</span>
          <input list="hs-exercise-lib" placeholder="輸入或選擇動作" data-ex="${i}" data-field="name" value="${esc(ex.name)}"></label>
        <label class="field muscle"><span>主要肌群</span>
          <select data-ex="${i}" data-field="muscle">${Object.entries(MUSCLES).map(([k, v]) => `<option value="${k}"${k === ex.muscle ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <button type="button" class="icon-btn" data-act="del-ex" data-ex="${i}" aria-label="刪除動作 ${i + 1}">${icon('trash')}</button>
      </div>
      <div class="set-list">${ex.sets.map((_, j) => setRow(ex, i, j)).join('')}</div>
      <button type="button" class="btn small ghost" data-act="add-set" data-ex="${i}" style="margin-top:6px">${icon('plus')}新增一組</button>
    </div>`;
  }

  function body(state) {
    return `<form id="hs-training-form" novalidate>
      <div class="form-grid">
        <label class="field"><span>日期</span><input type="date" required data-field="date" value="${esc(state.date)}"></label>
        <label class="field"><span>時長（分鐘）</span><input type="number" min="0" inputmode="numeric" data-field="durationMin" value="${state.durationMin ?? ''}"></label>
        <label class="field full"><span>訓練主題</span><input list="hs-title-lib" placeholder="例如：推、拉、腿" data-field="title" value="${esc(state.title)}"></label>
      </div>
      <div style="margin-top:16px" id="hs-ex-list">${state.exercises.map(exerciseCard).join('')}</div>
      <button type="button" class="btn" data-act="add-ex" style="margin-top:10px">${icon('plus')}新增動作</button>
      <label class="field" style="margin-top:16px"><span>備註</span><textarea data-field="notes" placeholder="狀態、疲勞、疼痛等">${esc(state.notes)}</textarea></label>
      <datalist id="hs-exercise-lib">${Object.keys(MUSCLE_OF).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <datalist id="hs-title-lib">${TITLES.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
    </form>`;
  }

  // 儲存前整理：去掉空白組與沒有名稱的動作
  function clean(state) {
    const exercises = state.exercises.map((ex) => ({
      name: ex.name.trim(),
      muscle: ex.muscle,
      sets: ex.sets.filter((s) => Object.values(s).some((v) => v != null && v !== 0)),
    })).filter((ex) => ex.name && ex.sets.length);
    return { ...state, title: state.title.trim(), notes: state.notes.trim(), exercises };
  }

  function open(id) {
    const editing = id ? HS.store.get('training', id) : null;
    const draft = !editing && HS.store.draft.get('training');
    const state = editing ? JSON.parse(JSON.stringify(editing)) : (draft || blank());
    const persist = () => { if (!editing) HS.store.draft.set('training', state); };

    const sheet = HS.openSheet({
      title: editing ? '編輯訓練紀錄' : '記錄訓練',
      body: body(state),
      dismissible: false,
      foot: `${!editing ? '<button type="button" class="btn ghost" data-act="discard">清空</button>' : ''}<button type="button" class="btn" data-close>取消</button><button type="button" class="btn primary" data-act="save">儲存</button>`,
    });
    if (draft) HS.toast('已恢復上次未儲存的內容');
    const root = sheet.el;
    const list = () => root.querySelector('#hs-ex-list');
    const redraw = () => { list().innerHTML = state.exercises.map(exerciseCard).join(''); persist(); };

    root.addEventListener('input', (e) => {
      const t = e.target;
      const field = t.dataset.field;
      if (!field) return;
      if (t.dataset.set != null) {
        state.exercises[t.dataset.ex].sets[t.dataset.set][field] = num(t.value);
      } else if (t.dataset.ex != null) {
        const ex = state.exercises[t.dataset.ex];
        ex[field] = t.value;
        if (field === 'name' && MUSCLE_OF[t.value.trim()] && MUSCLE_OF[t.value.trim()] !== ex.muscle) {
          ex.muscle = MUSCLE_OF[t.value.trim()];
          const card = root.querySelector(`[data-card="${t.dataset.ex}"]`);
          card.querySelector('select').value = ex.muscle;
          card.querySelector('.set-list').innerHTML = ex.sets.map((_, j) => setRow(ex, Number(t.dataset.ex), j)).join('');
        }
        if (field === 'muscle') {
          root.querySelector(`[data-card="${t.dataset.ex}"] .set-list`).innerHTML = ex.sets.map((_, j) => setRow(ex, Number(t.dataset.ex), j)).join('');
        }
      } else {
        state[field] = field === 'durationMin' ? num(t.value) : t.value;
      }
      persist();
    });

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const i = Number(b.dataset.ex);
      switch (b.dataset.act) {
        case 'add-ex':
          state.exercises.push(emptyExercise());
          redraw();
          list().lastElementChild.querySelector('input').focus();
          break;
        case 'del-ex':
          state.exercises.splice(i, 1);
          if (!state.exercises.length) state.exercises.push(emptyExercise());
          redraw();
          break;
        case 'add-set': {
          const sets = state.exercises[i].sets;
          sets.push(emptySet(sets[sets.length - 1]));
          redraw();
          break;
        }
        case 'del-set':
          state.exercises[i].sets.splice(Number(b.dataset.set), 1);
          if (!state.exercises[i].sets.length) state.exercises[i].sets.push(emptySet());
          redraw();
          break;
        case 'discard':
          if (!window.confirm('清空目前填寫的內容？')) return;
          Object.assign(state, blank());
          HS.store.draft.clear('training');
          root.querySelector('.sheet-body').innerHTML = body(state);
          break;
        case 'save': {
          const rec = clean(state);
          if (!rec.date) { HS.toast('請填日期'); return; }
          if (!rec.exercises.length) { HS.toast('請至少填一個動作與一組數據'); return; }
          if (!HS.store.save('training', rec)) return;
          HS.store.draft.clear('training');
          sheet.close();
          HS.toast(editing ? '已更新訓練紀錄' : '已儲存訓練紀錄');
          break;
        }
        default:
      }
    });
  }

  HS.training = { MUSCLES, LIBRARY, MUSCLE_OF, open };
})();
