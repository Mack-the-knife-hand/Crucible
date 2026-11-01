// =============================================================================
// goals.js — writing goals, streaks and history
// -----------------------------------------------------------------------------
// Counts the NET words added to the open book each day (words written minus
// words cut), kept in the book's project.json:
//   meta.wordLog = { "2026-10-31": { start: 81200, end: 82050 }, … }
//   meta.target  = { words: 90000, deadline: "2027-03-01" }   (optional)
// The daily goal is a global setting (Settings → or the Goals window).
// =============================================================================

const Goals = {
  sessionStart: null,

  init() {
    $('#stGoal').addEventListener('click', () => this.open());
    Bus.on('settings', () => this.render());
  },

  day(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  log() {
    const m = S.project.meta;
    return m.wordLog || (m.wordLog = {});
  },

  // Called whenever the word count is refreshed.
  update(total, loading = false) {
    if (!S.project) return;
    const log = this.log();
    const today = this.day();
    if (loading || this.sessionStart === null) this.sessionStart = total;
    if (!log[today]) {
      const days = Object.keys(log).sort();
      const prev = days.length ? log[days[days.length - 1]].end : total;
      log[today] = { start: prev, end: total };
    }
    log[today].end = total;
    this.render();
  },

  net(d) { const e = this.log()[d]; return e ? e.end - e.start : 0; },

  streak(goal) {
    if (!goal) return 0;
    let n = 0;
    const d = new Date();
    if (this.net(this.day(d)) < goal) d.setDate(d.getDate() - 1); // today not done yet: count from yesterday
    for (;;) {
      if (this.net(this.day(d)) >= goal) { n++; d.setDate(d.getDate() - 1); } else break;
    }
    return n;
  },

  render() {
    const chip = $('#stGoal');
    if (!S.project || !S.settings) return;
    const goal = S.settings.dailyGoal || 0;
    const today = this.net(this.day());
    if (!goal) { chip.textContent = `Today ${today >= 0 ? '+' : ''}${today.toLocaleString()}`; chip.title = 'Net words added to this book today. Click to set a daily goal.'; return; }
    const pct = Math.max(0, Math.min(100, (today / goal) * 100));
    chip.innerHTML = '';
    chip.append(`Today ${Math.max(0, today).toLocaleString()} / ${goal.toLocaleString()}`,
      el('span', { class: 'goal-bar' }, el('span', { style: `width:${pct}%`, class: today >= goal ? 'met' : '' })));
    const st = this.streak(goal);
    chip.title = `Daily goal ${goal.toLocaleString()} words${st ? ` · ${st}-day streak` : ''}. Click for history.`;
  },

  open() {
    const log = this.log();
    const goal = S.settings.dailyGoal || 0;
    const total = countWords(Editor.text);
    const target = S.project.meta.target || {};
    const goalIn = el('input', { type: 'number', min: 0, step: 50, value: goal || '', placeholder: 'e.g. 500', style: 'width:110px' });
    const tWords = el('input', { type: 'number', min: 0, step: 1000, value: target.words || '', placeholder: 'e.g. 90000', style: 'width:110px' });
    const tDate = el('input', { type: 'date', value: target.deadline || '' });
    const need = el('div', { class: 'hint' });
    const calcNeed = () => {
      const w = +tWords.value, dl = tDate.value;
      if (!w) { need.textContent = ''; return; }
      const left = w - total;
      if (left <= 0) { need.textContent = `You've reached it: ${total.toLocaleString()} words. 🎉`; return; }
      if (!dl) { need.textContent = `${left.toLocaleString()} words to go.`; return; }
      const days = Math.ceil((new Date(dl + 'T23:59') - new Date()) / 864e5);
      need.textContent = days > 0 ? `${left.toLocaleString()} words to go: about ${Math.ceil(left / days).toLocaleString()} a day for ${days} day(s).` : `${left.toLocaleString()} words to go, and the deadline has passed.`;
    };
    [tWords, tDate].forEach((x) => x.addEventListener('input', calcNeed));
    calcNeed();

    // Last 30 days chart.
    const days = [];
    const d = new Date();
    d.setDate(d.getDate() - 29);
    for (let i = 0; i < 30; i++) { days.push(this.day(d)); d.setDate(d.getDate() + 1); }
    const vals = days.map((x) => this.net(x));
    const max = Math.max(goal, ...vals, 1);
    const W = 600, H = 140, bw = W / 30;
    const bars = vals.map((v, i) => {
      const h = Math.max(0, (v / max) * (H - 20));
      const met = goal && v >= goal;
      return `<rect x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${h}" rx="2" fill="${met ? 'var(--ok)' : 'var(--ember)'}" opacity="${v > 0 ? 1 : 0.15}"><title>${days[i]}: ${v.toLocaleString()} words</title></rect>`;
    }).join('');
    const goalLine = goal ? `<line x1="0" x2="${W}" y1="${H - (goal / max) * (H - 20)}" y2="${H - (goal / max) * (H - 20)}" stroke="var(--muted)" stroke-dasharray="4 4"/>` : '';
    const chart = el('div', { class: 'goal-chart', html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Words per day, last 30 days">${goalLine}${bars}</svg>` });
    const all = Object.keys(log).map((k) => this.net(k));
    const stat = (label, v) => el('div', { class: 'goal-stat' }, el('strong', {}, v), el('span', { class: 'muted' }, label));

    openModal({
      title: 'Writing goals',
      wide: true,
      body: el('div', {},
        el('div', { class: 'goal-stats' },
          stat('today (net)', this.net(this.day()).toLocaleString()),
          stat('this session', (total - (this.sessionStart ?? total)).toLocaleString()),
          stat('day streak', goal ? String(this.streak(goal)) : '–'),
          stat('best day', Math.max(0, ...all).toLocaleString()),
          stat('words in book', total.toLocaleString())),
        el('div', { class: 'muted', style: 'font-size:12px;margin:10px 0 4px' }, 'Last 30 days (green = goal met)'),
        chart,
        el('div', { class: 'field' }, el('label', {}, 'Daily goal (words)'), goalIn, el('div', { class: 'hint' }, 'Applies to every book. 0 or empty turns it off.')),
        el('div', { class: 'field' }, el('label', {}, 'Book target'), el('div', { style: 'display:flex;gap:8px;align-items:center' }, tWords, 'words by', tDate), need),
        el('p', { class: 'muted', style: 'font-size:12px' }, 'Counts net words added to this book each day (cutting text counts against the day). History is kept with the book.')),
      buttons: [
        { label: 'Close' },
        {
          label: 'Save', accent: true,
          onClick: async () => {
            S.project.meta.target = { words: +tWords.value || 0, deadline: tDate.value || '' };
            markDirty(true);
            await persistSettings({ dailyGoal: Math.max(0, Math.round(+goalIn.value || 0)) });
            this.render();
          },
        },
      ],
    });
  },
};
