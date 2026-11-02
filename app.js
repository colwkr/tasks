/* Tasks — to-dos live in Nerve (Supabase table public.tasks, rows with kind 'task'): the same rows POS shows.
   One list, top to bottom:
     Overdue   an earlier day, not checked off yet. They stay here until they're done or moved.
     Today     timed tasks by time, then the rest; what you finished today stays at the bottom, crossed off.
     Tomorrow
     Upcoming  everything after tomorrow, by day and then time.
     Unsorted  no day yet.
   A task can have a time (when it starts) and a length in minutes. Nerve clears a finished task once the day it was
   finished is over. Repeating tasks, To-buy style lists and project steps are POS's and don't show here. */
(() => {
  'use strict';

  const SB_URL = 'https://dejcovbqwlrvniitbdqv.supabase.co';
  const SB_KEY = 'sb_publishable_VB-KHKnNz_J5EKWvHKW9Ew_7B2sI6Zg';
  const TABLE = 'tasks';
  const COLS = 'id,title,day,at_time,mins,done,done_at,notes,tag,pos,created_at,repeat,list,kind';
  const TAGS = { work: 'Work', personal: 'Personal' };
  const LENGTHS = [15, 30, 45, 60, 90];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tasks.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tasks.' + k, v); } catch (e) {} },
  };

  /* ---------- a newer published version replaces this one on open ---------- */
  async function checkVersion() {
    if (window.APP_V === 'dev') return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const { v } = await r.json();
      let tried = null; try { tried = sessionStorage.getItem('tasks.tried'); } catch (e) {}
      if (v && v !== window.APP_V && tried !== v) {
        try { sessionStorage.setItem('tasks.tried', v); } catch (e) {}
        location.replace(location.pathname + '?v=' + encodeURIComponent(v));
      }
    } catch (e) {}
  }
  checkVersion();

  /* ---------- dates and times ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => ymd(new Date());
  const tomorrow = () => ymd(addDays(new Date(), 1));
  const dayStart = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); };
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  function clock(m) {
    const h = Math.floor(m / 60) % 24, mm = m % 60, h12 = h % 12 || 12;
    return `${h12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function span(s, e) {
    const a = clock(s), b = clock(e % 1440);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  }
  const length = n => (n < 60 ? `${n} min` : n % 60 ? `${Math.floor(n / 60)} hr ${n % 60} min` : `${n / 60} hr`);
  const fmt = (d, o) => d.toLocaleDateString('en-US', o);
  function dayName(k) {
    const n = Math.round((parse(k) - parse(today())) / 864e5);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n > 1 && n < 7) return fmt(parse(k), { weekday: 'long' });
    return fmt(parse(k), { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ---------- state ---------- */
  const S = {
    user: null, ready: false, loaded: false, failed: '',
    rows: [],          // tasks, as the app uses them
    edit: null,        // the task open in the sheet: { id (null for a new one), title, date, time, mins, tag, notes }
    confirmDel: false, // the sheet is asking "Delete this task?"
    day: today(),      // the day the list was drawn for; when it changes the list is redrawn
  };

  /* ---------- data: Nerve, or an in-memory copy for the local preview ---------- */
  const DEMO = !!window.TASKS_DEMO;
  const sb = DEMO ? null : window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tasks.auth' } });
  const db = DEMO ? window.TASKS_DEMO : {
    async list() {
      const { data, error } = await sb.from(TABLE).select(COLS).eq('kind', 'task').order('created_at').limit(5000);
      if (error) throw error;
      return data;
    },
    async insert(row) { const { data, error } = await sb.from(TABLE).insert({ ...row, kind: 'task' }).select(COLS).single(); if (error) throw error; return data; },
    async update(id, patch) { const { error } = await sb.from(TABLE).update(patch).eq('id', id); if (error) throw error; },
    async remove(id) { const { error } = await sb.from(TABLE).delete().eq('id', id); if (error) throw error; },
    subscribe(cb) { return sb.channel('tasks-app').on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, cb).subscribe(); },
  };
  const fromRow = r => ({
    id: r.id, title: r.title, date: r.day || null, time: r.at_time ? String(r.at_time).slice(0, 5) : null, mins: r.mins ?? null,
    done: !!r.done, doneAt: r.done_at ? Date.parse(r.done_at) : null, notes: r.notes || '', tag: r.tag || null,
    pos: r.pos ?? null, created: Date.parse(r.created_at) || 0,
  });
  // repeating tasks and list items (To buy...) belong to POS's own screens
  const mine = r => (r.kind || 'task') === 'task' && !r.repeat && !r.list;

  let loading = null, again = false;
  async function load() {
    if (loading) { again = true; return loading; }
    loading = (async () => {
      try {
        const rows = await db.list();
        S.rows = rows.filter(mine).map(fromRow);
        S.loaded = true; S.failed = '';
      } catch (e) {
        S.failed = 'Tasks could not load. Check the connection; it tries again when you come back to it.';
      }
      render();
    })();
    await loading; loading = null;
    if (again) { again = false; load(); }
  }
  let reloadT = 0;
  const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(load, 250); };
  let started = false;
  function start() {
    load();
    if (started) return;
    started = true;
    if (!DEMO) db.subscribe(reloadSoon);
  }

  /* ---------- saving: the list changes at once; if Nerve says no, it's put back ---------- */
  async function save(fn, undo) {
    render();
    try { await fn(); }
    catch (e) { if (undo) undo(); toast('That didn’t save. Check the connection and try again.'); render(); load(); }
  }
  const find = id => S.rows.find(t => t.id === id);
  function setDone(t, done) {
    const before = { done: t.done, doneAt: t.doneAt };
    t.done = done; t.doneAt = done ? Date.now() : null;
    save(() => db.update(t.id, { done, done_at: done ? new Date().toISOString() : null }), () => Object.assign(t, before));
    if (done) toast(`Done: ${t.title}`, () => setDone(t, false));
  }
  async function addTask(fields) {
    const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), title: '', date: null, time: null, mins: null, done: false, doneAt: null, notes: '', tag: null, pos: null, created: Date.now(), ...fields };
    S.rows.push(tmp);
    render();
    try {
      const row = await db.insert(toRow(fields));
      const t = fromRow(row);
      S.rows = S.rows.filter(x => x.id !== tmp.id && x.id !== t.id);
      S.rows.push(t);
      render();
      return t;
    } catch (e) {
      S.rows = S.rows.filter(x => x.id !== tmp.id);
      toast('That task didn’t save. Check the connection and try again.');
      render();
      return null;
    }
  }
  function toRow(o) {
    const r = {};
    if ('title' in o) r.title = o.title;
    if ('date' in o) r.day = o.date || null;
    if ('time' in o) r.at_time = o.time || null;
    if ('mins' in o) r.mins = o.mins || null;
    if ('notes' in o) r.notes = o.notes || null;
    if ('tag' in o) r.tag = o.tag || null;
    return r;
  }

  /* ---------- the list ---------- */
  const byOrder = (a, b) => (a.pos != null && b.pos != null && a.pos !== b.pos ? a.pos - b.pos : 0) || a.created - b.created;
  // within one day: tasks with a time, in time order, then the ones without
  const inDay = (a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || '') || byOrder(a, b);
  const byDate = (a, b) => a.date.localeCompare(b.date) || inDay(a, b);
  function sections() {
    const tk = today(), tm = tomorrow(), start = dayStart();
    const s = { overdue: [], today: [], tomorrow: [], upcoming: [], unsorted: [], doneToday: [] };
    for (const t of S.rows) {
      if (t.done) {
        // what you finish today stays in Today, crossed off, wherever it came from
        if (t.date === tk || (t.doneAt && t.doneAt >= start)) s.doneToday.push(t);
        else if (t.date && t.date > tk) (t.date === tm ? s.tomorrow : s.upcoming).push(t);
        continue;
      }
      if (!t.date) s.unsorted.push(t);
      else if (t.date < tk) s.overdue.push(t);
      else if (t.date === tk) s.today.push(t);
      else if (t.date === tm) s.tomorrow.push(t);
      else s.upcoming.push(t);
    }
    s.overdue.sort(byDate); s.today.sort(inDay); s.upcoming.sort((a, b) => (a.done - b.done) || byDate(a, b));
    s.tomorrow.sort((a, b) => (a.done - b.done) || inDay(a, b)); s.unsorted.sort(byOrder);
    s.doneToday.sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
    return s;
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  // one task: check circle, name, and a line saying when (the day too, in Overdue and Upcoming), how long, and its tag
  function row(t, sec) {
    const bits = [];
    if ((sec === 'overdue' || sec === 'upcoming') && t.date) bits.push(`<span class="${sec === 'overdue' ? 'late' : 'when'}">${esc(dayName(t.date))}</span>`);
    if (t.time) {
      const s0 = toMin(t.time), passed = sec === 'today' && !t.done && s0 + (t.mins || 0) <= nowMin();
      bits.push(`<span class="${passed ? 'late' : ''}">${esc(t.mins ? span(s0, s0 + t.mins) : clock(s0))}</span>`);
      if (t.mins) bits.push(`<span>${esc(length(t.mins))}</span>`);
    } else if (t.mins) bits.push(`<span>${ICON.clock}${esc(length(t.mins))}</span>`);
    if (t.tag && TAGS[t.tag]) bits.push(`<span class="tag ${t.tag}">${TAGS[t.tag]}</span>`);
    if (t.notes) bits.push(`<span class="has-note" aria-label="Has notes">${ICON.note}</span>`);
    const busy = t.id.startsWith('tmp-');
    return `<div class="trow${t.done ? ' done' : ''}${busy ? ' busy' : ''}" data-id="${esc(t.id)}">
      <button type="button" class="chk" data-act="done" role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? 'Not done' : 'Done'}: ${esc(t.title)}"${busy ? ' disabled' : ''}>${ICON.check}</button>
      <button type="button" class="tmain" data-act="open"${busy ? ' disabled' : ''}>
        <span class="name">${esc(t.title)}</span>${bits.length ? `<span class="meta">${bits.join('')}</span>` : ''}
      </button>
    </div>`;
  }
  // a new task typed at the bottom of a section lands on that section's day
  const addRow = (sec, label) => `<form class="addrow" data-add="${sec}" autocomplete="off"><span class="plus">${ICON.plus}</span><input name="t" placeholder="New task" maxlength="200" enterkeyhint="done" aria-label="New task for ${label}"></form>`;
  function section(key, name, list, opts = {}) {
    const open = list.filter(t => !t.done).length;
    const body = list.map(t => row(t, key)).join('') + (opts.extra || '') + (opts.add ? addRow(key, name) : '');
    return `<section class="sec sec-${key}" aria-label="${esc(name)}">
      <div class="sec-h"><h2>${esc(name)}</h2>${opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : ''}<span class="n">${open || ''}</span></div>
      ${body ? `<div class="list">${body}</div>` : ''}${opts.empty && !list.length ? `<p class="empty">${esc(opts.empty)}</p>` : ''}
    </section>`;
  }

  function vList() {
    const s = sections(), d0 = new Date(), d1 = addDays(d0, 1);
    const left = s.today.length;
    const subBits = [fmt(d0, { month: 'long', day: 'numeric' })];
    if (s.overdue.length) subBits.push(`<span class="late">${s.overdue.length} overdue</span>`);
    subBits.push(left ? `${left} left today` : 'nothing left today');
    const doneRows = s.doneToday.map(t => row(t, 'today')).join('');
    return `<header class="top">
        <div><h1>${esc(fmt(d0, { weekday: 'long' }))}</h1><p class="tsub">${subBits.join(' · ')}</p></div>
        <button type="button" class="ic" data-act="account" aria-label="Account">${ICON.user}</button>
      </header>
      ${s.overdue.length ? section('overdue', 'Overdue', s.overdue, { sub: 'not done yet' }) : ''}
      ${section('today', 'Today', s.today, { add: true, extra: doneRows })}
      ${section('tomorrow', 'Tomorrow', s.tomorrow, { add: true, sub: fmt(d1, { weekday: 'short', month: 'short', day: 'numeric' }) })}
      ${s.upcoming.length ? section('upcoming', 'Upcoming', s.upcoming) : ''}
      ${section('unsorted', 'Unsorted', s.unsorted, { add: true, sub: 'no day yet' })}`;
  }

  /* ---------- the sheet: one task's details ---------- */
  function vSheet() {
    const e = S.edit;
    if (!e) return '';
    const tk = today(), tm = tomorrow();
    const which = !e.date ? 'none' : e.date === tk ? 'today' : e.date === tm ? 'tomorrow' : 'pick';
    const seg = (name, val, label, on) => `<button type="button" data-${name}="${val}" aria-pressed="${on}">${label}</button>`;
    const lens = [[0, 'None'], ...LENGTHS.map(n => [n, length(n)])];
    const custom = e.mins && !LENGTHS.includes(e.mins);
    return `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="${e.id ? 'Task' : 'New task'}">
      <form id="edForm" autocomplete="off">
        <div class="sh-top">
          <button type="button" class="link" data-act="close">Cancel</button>
          <b>${e.id ? 'Task' : 'New task'}</b>
          <button type="submit" class="link strong">${e.id ? 'Save' : 'Add'}</button>
        </div>
        <textarea id="ed_title" class="ed-title" rows="1" maxlength="200" placeholder="What needs doing?" enterkeyhint="done" required>${esc(e.title)}</textarea>
        <div class="f"><span class="lab">Day</span>
          <div class="seg" id="edDay">${seg('day', 'today', 'Today', which === 'today')}${seg('day', 'tomorrow', 'Tomorrow', which === 'tomorrow')}${seg('day', 'none', 'No day', which === 'none')}</div>
          <label class="pick${which === 'pick' ? ' on' : ''}"><span>${which === 'pick' ? esc(fmt(parse(e.date), { weekday: 'short', month: 'short', day: 'numeric' })) : 'Pick a day'}</span><input type="date" id="ed_date" value="${esc(e.date || '')}"></label>
        </div>
        <div class="f"><span class="lab">Time <small>when it starts — leave empty for any time that day</small></span>
          <div class="row2"><input type="time" id="ed_time" step="300" value="${esc(e.time || '')}"${e.date ? '' : ' disabled'}>${e.time ? '<button type="button" class="link" data-act="notime">Clear</button>' : ''}</div>
          ${e.date ? '' : '<small class="hint">Give it a day first.</small>'}
        </div>
        <div class="f"><span class="lab">Length</span>
          <div class="chips" id="edLen">${lens.map(([n, l]) => `<button type="button" data-len="${n}" aria-pressed="${(e.mins || 0) === n}">${l}</button>`).join('')}<label class="chip-in${custom ? ' on' : ''}"><input type="number" id="ed_mins" min="1" max="1440" inputmode="numeric" placeholder="Other" value="${custom ? e.mins : ''}"><span>min</span></label></div>
        </div>
        <div class="f"><span class="lab">Work or personal</span>
          <div class="seg" id="edTag">${seg('tag', '', 'Neither', !e.tag)}${seg('tag', 'work', 'Work', e.tag === 'work')}${seg('tag', 'personal', 'Personal', e.tag === 'personal')}</div>
        </div>
        <div class="f"><span class="lab">Notes</span><textarea id="ed_notes" rows="3" maxlength="100000" placeholder="Anything to remember about it">${esc(e.notes)}</textarea></div>
        ${e.id ? (S.confirmDel
          ? `<div class="del-ask"><span>Delete this task?</span><button type="button" class="pill danger" data-act="del-yes">Delete</button><button type="button" class="pill" data-act="del-no">Keep</button></div>`
          : `<div class="sh-foot"><button type="button" class="pill${find(e.id) && find(e.id).done ? '' : ' solid'}" data-act="sheet-done">${find(e.id) && find(e.id).done ? 'Mark not done' : 'Mark done'}</button><button type="button" class="pill danger" data-act="del">Delete</button></div>`) : ''}
      </form>
    </div>`;
  }
  function openSheet(t, defaults = {}) {
    S.edit = t ? { id: t.id, title: t.title, date: t.date, time: t.time, mins: t.mins, tag: t.tag, notes: t.notes }
      : { id: null, title: '', date: today(), time: null, mins: null, tag: null, notes: '', ...defaults };
    S.confirmDel = false;
    drawSheet(true);
  }
  function drawSheet(focus) {
    const sh = $('#sheet'), scrim = $('#scrim');
    if (!S.edit) { sh.classList.remove('open'); scrim.classList.remove('open'); setTimeout(() => { if (!S.edit) { sh.hidden = true; scrim.hidden = true; sh.innerHTML = ''; } }, 220); return; }
    // keep what's being typed when the sheet redraws
    const keep = $('#ed_title') ? { title: $('#ed_title').value, notes: $('#ed_notes').value } : null;
    if (keep) { S.edit.title = keep.title; S.edit.notes = keep.notes; }
    sh.innerHTML = vSheet();
    sh.hidden = false; scrim.hidden = false;
    requestAnimationFrame(() => { sh.classList.add('open'); scrim.classList.add('open'); });
    grow($('#ed_title'));
    if (focus && !S.edit.id) setTimeout(() => $('#ed_title') && $('#ed_title').focus(), 60);
  }
  function closeSheet() { S.edit = null; S.confirmDel = false; drawSheet(); }
  function grow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  async function saveSheet() {
    const e = S.edit;
    if (!e) return;
    e.title = $('#ed_title').value.replace(/\s+/g, ' ').trim();
    e.notes = $('#ed_notes').value.trim();
    if (!e.title) { $('#ed_title').focus(); return; }
    if (!e.date) e.time = null;
    const fields = { title: e.title.slice(0, 200), date: e.date, time: e.time, mins: e.mins, tag: e.tag, notes: e.notes };
    closeSheet();
    if (!e.id) { await addTask(fields); return; }
    const t = find(e.id);
    if (!t) return;
    const before = { ...t };
    Object.assign(t, fields);
    save(() => db.update(t.id, toRow(fields)), () => Object.assign(t, before));
  }

  /* ---------- account ---------- */
  function vAccount() {
    return `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="Account"><div class="acct">
      <div class="sh-top"><span></span><b>Account</b><button type="button" class="link strong" data-act="close">Done</button></div>
      <p class="muted">Signed in as ${esc(S.user && S.user.email)}. These are the same tasks POS shows.</p>
      <button type="button" class="pill big" data-act="signout">Sign out</button>
    </div></div>`;
  }

  /* ---------- toast ---------- */
  let toastT = 0, toastUndo = null;
  function toast(msg, undo) {
    const el = $('#toast');
    toastUndo = undo || null;
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-act="undo">Undo</button>' : ''}`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 200); toastUndo = null; }, 4000);
  }

  /* ---------- drawing ---------- */
  function vLogin() {
    return `<div class="login"><form id="loginForm">
      <img src="icon.svg" width="60" height="60" alt="" class="logo">
      <h1>Tasks</h1>
      <p class="muted">Sign in with your Nerve account.</p>
      <label class="f"><span class="lab">Email</span><input id="l_email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="f"><span class="lab">Password</span><input id="l_pass" type="password" autocomplete="current-password" required></label>
      <p class="err" id="l_err" hidden></p>
      <button type="submit" class="pill solid big" id="l_go">Sign in</button>
    </form></div>`;
  }
  const typingIn = () => { const a = document.activeElement; return a && a.matches && a.matches('.addrow input') && a.value; };
  let pending = false;
  function render() {
    const v = $('#view');
    if (!S.ready) { v.innerHTML = ''; return; }
    if (!S.user) { v.innerHTML = vLogin(); $('#fab').hidden = true; return; }
    // don't redraw under someone typing a new task; draw once they're done
    if (typingIn()) { pending = true; return; }
    pending = false;
    S.day = today();
    $('#fab').hidden = false;
    if (!S.loaded) { v.innerHTML = `<p class="empty top-gap">${esc(S.failed || 'Loading your tasks…')}</p>`; return; }
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.addrow');
    const refocus = focused ? focused.dataset.add : null;
    v.innerHTML = (S.failed ? `<p class="banner">${esc(S.failed)}</p>` : '') + vList();
    if (refocus) { const i = $(`.addrow[data-add="${refocus}"] input`); if (i) i.focus(); }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act], [data-day], [data-len], [data-tag]');
    if (!b) return;
    const act = b.dataset.act;
    if (b.closest('#edForm') && !act) {
      const ed = S.edit;
      if (b.dataset.day) ed.date = b.dataset.day === 'today' ? today() : b.dataset.day === 'tomorrow' ? tomorrow() : null;
      else if (b.dataset.len != null) ed.mins = Number(b.dataset.len) || null;
      else if (b.dataset.tag != null) ed.tag = b.dataset.tag || null;
      if (!ed.date) ed.time = null;
      drawSheet();
      return;
    }
    const id = b.closest('[data-id]') && b.closest('[data-id]').dataset.id;
    if (act === 'done') { const t = find(id); if (t) setDone(t, !t.done); }
    else if (act === 'open') { const t = find(id); if (t) openSheet(t); }
    else if (act === 'add') openSheet(null);
    else if (act === 'close') closeSheet();
    else if (act === 'notime') { S.edit.time = null; drawSheet(); }
    else if (act === 'sheet-done') { const t = find(S.edit.id); if (t) { setDone(t, !t.done); closeSheet(); } }
    else if (act === 'del') { S.confirmDel = true; drawSheet(); }
    else if (act === 'del-no') { S.confirmDel = false; drawSheet(); }
    else if (act === 'del-yes') {
      const t = find(S.edit.id); closeSheet();
      if (!t) return;
      S.rows = S.rows.filter(x => x !== t);
      save(() => db.remove(t.id), () => S.rows.push(t));
      toast(`Deleted: ${t.title}`, async () => {
        const back = await addTask({ title: t.title, date: t.date, time: t.time, mins: t.mins, tag: t.tag, notes: t.notes });
        if (back && t.done) setDone(back, true);
      });
    }
    else if (act === 'account') { S.edit = null; const sh = $('#sheet'); sh.innerHTML = vAccount(); sh.hidden = false; $('#scrim').hidden = false; requestAnimationFrame(() => { sh.classList.add('open'); $('#scrim').classList.add('open'); }); }
    else if (act === 'signout') { closeSheet(); if (sb) sb.auth.signOut(); }
    else if (act === 'undo') { const u = toastUndo; toastUndo = null; $('#toast').classList.remove('show'); if (u) u(); }
  });
  $('#scrim').addEventListener('click', closeSheet);
  document.addEventListener('input', e => {
    if (e.target.id === 'ed_title') grow(e.target);
    if (e.target.id === 'ed_mins') { const n = Math.round(Number(e.target.value)); S.edit.mins = n >= 1 && n <= 1440 ? n : null; $$('#edLen [data-len]').forEach(x => x.setAttribute('aria-pressed', String((S.edit.mins || 0) === Number(x.dataset.len)))); }
  });
  document.addEventListener('change', e => {
    if (!S.edit) return;
    if (e.target.id === 'ed_date') { S.edit.date = e.target.value || null; if (!S.edit.date) S.edit.time = null; drawSheet(); }
    if (e.target.id === 'ed_time') { S.edit.time = e.target.value || null; drawSheet(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheet').classList.contains('open')) { closeSheet(); return; }
    if (e.key === 'Enter' && e.target.id === 'ed_title') { e.preventDefault(); saveSheet(); }
  });
  document.addEventListener('focusout', e => { if (e.target.matches && e.target.matches('.addrow input')) setTimeout(() => { if (pending && !typingIn()) render(); }, 0); });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'edForm') return saveSheet();
    if (f.dataset.add) {
      const input = f.querySelector('input');
      const title = input.value.replace(/\s+/g, ' ').trim();
      if (!title) return;
      input.value = '';
      const date = f.dataset.add === 'today' ? today() : f.dataset.add === 'tomorrow' ? tomorrow() : null;
      addTask({ title: title.slice(0, 200), date });
      return;
    }
    if (f.id !== 'loginForm') return;
    const err = $('#l_err'), go = $('#l_go');
    go.disabled = true; err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#l_email').value.trim(), password: $('#l_pass').value });
    go.disabled = false;
    if (error) { err.textContent = 'That email and password did not work.'; err.hidden = false; }
  });

  // at midnight, tomorrow becomes today and today's unfinished tasks move up to Overdue
  setInterval(() => { if (S.user && (S.day !== today() || $('.trow .late'))) render(); }, 30000);
  setInterval(() => { if (S.user && S.day !== today()) render(); }, 5000);

  /* ---------- start ---------- */
  if (DEMO) {
    S.user = { id: 'demo', email: 'preview@local' }; S.ready = true; render(); start();
  } else {
    sb.auth.onAuthStateChange((_ev, session) => {
      const u = session ? session.user : null, was = S.user && S.user.id;
      S.user = u; S.ready = true;
      if (u && was !== u.id) start();
      if (!u) { S.rows = []; S.loaded = false; }
      render();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) { checkVersion(); load(); } });
  }
})();
