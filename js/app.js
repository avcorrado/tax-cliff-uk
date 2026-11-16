(function () {
  'use strict';

  const T = window.TaxCliff;
  const C = window.TaxCharts;
  const R = T.RULES;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- Formatting ---------- */
  const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const gbp = (v) => '£' + nf0.format(Math.round(Math.abs(v)));
  const arrow = (v) => (v >= 0.5 ? '↑ ' + gbp(v) : v <= -0.5 ? '↓ ' + gbp(v) : '£0');
  const fmtPct = (v) => String(+Number(v).toFixed(2));
  const pctText = (r) => {
    if (r > 1) return 'Over 100%';
    const p = Math.max(0, r) * 100;
    return (Number.isInteger(+p.toFixed(1)) ? p.toFixed(0) : p.toFixed(1)) + '%';
  };
  const axisMoney = (v) => {
    const a = Math.abs(v);
    if (a >= 10000) return '£' + +(v / 1000).toFixed(1) + 'k';
    return '£' + nf0.format(v);
  };
  const parseNum = (str) => {
    const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const cls = (v) => (v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : '');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

  /* ---------- State ---------- */
  const KIDS = [{ band: 'toddler', hours: 40 }, { band: 'preschool', hours: 40 }];
  const PRESETS = {
    parents: { salary: 101000, children: KIDS },
    escape: { salary: 110000, pensionPct: 9.1, method: 'sacrifice', children: KIDS },
    nokids: { salary: 112000, children: [] },
    plan2: { salary: 112000, plan: 'plan2', loanBalance: 38000, children: [] },
    scotland: { salary: 110000, region: 'scotland', children: [{ band: 'preschool', hours: 40 }] },
    couple: {
      salary: 105000,
      partnerOn: true,
      partnerSalary: 40000,
      children: [{ band: 'toddler', hours: 40 }, { band: 'school', hours: 15 }],
    },
    both: { salary: 99000, partnerOn: true, partnerSalary: 99000, children: KIDS },
  };
  const EMPTY_WHEN_ZERO = new Set(['loanBalance', 'gift']);

  const freshState = () => T.normalise(Object.assign(T.defaultState(), { children: [] }));

  let state = freshState();
  let mode = 'flow';
  let screen = 'salary';
  let editing = false;
  let trail = [];
  let kidsChoice = null;
  const openPanels = new Set();
  let view = 'income';
  let range = 'focus';
  let period = 'month';
  let slice = 1000;
  let tips = [];
  const charts = {};
  let urlTimer = null;
  let liveTimer = null;

  const perK = () => (period === 'month' ? 12 : 1);
  const unit = () => (period === 'month' ? 'a month' : 'a year');

  function setState(patch) {
    state = T.normalise(Object.assign({}, state, patch));
    render();
  }

  function syncPanelsFromState() {
    openPanels.clear();
    if (state.plan !== 'none' || state.postgrad || state.loanBalance > 0) openPanels.add('loan');
    if (state.partnerOn) openPanels.add('partner');
    if (state.region !== 'england') openPanels.add('region');
    if (state.gift > 0) openPanels.add('gift');
    if (state.method !== 'sacrifice') openPanels.add('method');
  }

  /* ---------- URL ---------- */
  function readUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      if (!p.has('s')) return;
      const next = {};
      next.salary = +p.get('s');
      if (p.has('r')) next.region = p.get('r');
      if (p.has('m')) next.method = p.get('m');
      if (p.has('p')) next.pensionPct = +p.get('p');
      if (p.has('e')) next.employerPct = +p.get('e');
      if (p.has('g')) next.gift = +p.get('g');
      if (p.has('l')) next.plan = p.get('l');
      if (p.has('pg')) next.postgrad = p.get('pg') === '1';
      if (p.has('lb')) next.loanBalance = +p.get('lb');
      if (p.has('lr')) next.loanRate = +p.get('lr');
      next.children = (p.get('k') || '')
        .split('_')
        .filter(Boolean)
        .map((c) => {
          const [band, hours, monthly] = c.split('.');
          return { band, hours: +hours, monthly: monthly === undefined ? null : +monthly };
        });
      if (p.has('ps')) {
        next.partnerOn = true;
        next.partnerSalary = +p.get('ps');
      }
      if (p.has('wk')) next.weeks = +p.get('wk');
      state = T.normalise(next);
      kidsChoice = state.children.length ? 'yes' : 'no';
      syncPanelsFromState();
      if (p.get('per') === 'year') period = 'year';
      if (['income', 'marginal', 'pension'].includes(p.get('v'))) view = p.get('v');
      if (p.get('z') === 'full') range = 'full';
      mode = p.get('d') === '1' ? 'data' : 'results';
    } catch (e) {
      /* ignore malformed links */
    }
  }

  function buildQuery() {
    const d = T.defaultState();
    const p = new URLSearchParams();
    p.set('s', Math.round(state.salary));
    if (state.region !== d.region) p.set('r', state.region);
    if (state.method !== d.method) p.set('m', state.method);
    if (state.pensionPct) p.set('p', fmtPct(state.pensionPct));
    if (state.employerPct) p.set('e', fmtPct(state.employerPct));
    if (state.gift) p.set('g', Math.round(state.gift));
    if (state.plan !== 'none') p.set('l', state.plan);
    if (state.postgrad) p.set('pg', '1');
    if (state.loanBalance) p.set('lb', Math.round(state.loanBalance));
    if (state.loanRate != null) p.set('lr', fmtPct(state.loanRate));
    p.set('k', state.children.map((c) => c.band + '.' + c.hours + (c.monthly != null ? '.' + Math.round(c.monthly) : '')).join('_'));
    if (state.partnerOn) p.set('ps', Math.round(state.partnerSalary));
    if (state.weeks !== d.weeks) p.set('wk', state.weeks);
    if (period !== 'month') p.set('per', period);
    if (view !== 'income') p.set('v', view);
    if (range !== 'focus') p.set('z', range);
    if (mode === 'data') p.set('d', '1');
    return p.toString();
  }

  function scheduleUrl() {
    clearTimeout(urlTimer);
    if (mode === 'flow') return;
    urlTimer = setTimeout(() => {
      try {
        history.replaceState(null, '', '?' + buildQuery());
      } catch (e) {
        /* file URLs may refuse */
      }
    }, 350);
  }

  /* ---------- Analysis ---------- */
  function analyse(s) {
    const hh = T.calcHousehold(s);
    const dz = T.deadZone(s);
    return {
      hh,
      dz,
      cliff: T.cliffCost(s),
      next: T.nextSlice(s, 1000),
      zone: T.zoneFor(hh.you.ani),
      x60: T.salaryAtANI(s, R.childBenefit.chargeStart),
      x80: T.salaryAtANI(s, R.childBenefit.chargeEnd),
      x100: dz.cliffSalary,
      x125: T.salaryAtANI(s, R.taperEnd),
    };
  }

  const ZONE_COPY = {
    allowance: ['Inside your Personal Allowance', 'Income up to £12,570 is free of income tax.'],
    basic: ['Basic rate territory', 'You are well clear of the cliff. The trap starts at £100,000 of adjusted net income.'],
    higher: ['Higher rate, with the cliff ahead', ''],
    trap: ['You are inside the trap', ''],
    top: ['Past the trap', 'Your Personal Allowance is gone, but the marginal rate has dropped back down.'],
  };

  function statusCopy(a) {
    const { hh, dz, next, zone } = a;
    let title = ZONE_COPY[zone][0];
    let body = ZONE_COPY[zone][1];
    let zc = zone;
    const toCliff = dz.cliffSalary - state.salary;
    const rate = pctText(next.rate);
    if (zone === 'higher') {
      body =
        'Your adjusted net income is ' + gbp(hh.you.ani) + '. You are ' + gbp(toCliff) + ' of salary away from £100,000, where every extra pound starts costing about 62p' +
        (hh.kids && hh.childcare.gross > 0 ? ' and childcare help disappears' : '') + '.';
      if (hh.kids && hh.childcare.gross > 0 && toCliff < 3000) {
        title = 'You are right at the edge of the cliff';
        zc = 'cliff';
      }
    } else if (zone === 'trap') {
      body = next.rate > 1
        ? 'Your next £1,000 of salary would leave you ' + gbp(-next.retained) + ' worse off.'
        : 'Your Personal Allowance has shrunk to ' + gbp(hh.you.allowance) + ' (from £12,570). Your next £1,000 of salary keeps only ' + gbp(Math.max(0, next.retained)) + ', a ' + rate + ' effective tax rate.';
    } else if (zone === 'top') {
      body = 'Your next £1,000 keeps ' + gbp(Math.max(0, next.retained)) + ' (' + rate + ' effective rate). The Personal Allowance is gone and the damage is done.';
    } else if (zone === 'basic') {
      body = 'Your next £1,000 keeps ' + gbp(Math.max(0, next.retained)) + ' (' + rate + ' effective rate). The trap begins in ' + gbp(toCliff) + ' of salary.';
    }
    const tags = [];
    tags.push('<span class="tag">Adjusted net income ' + gbp(hh.you.ani) + '</span>');
    tags.push('<span class="tag' + (hh.you.allowance < R.personalAllowance ? ' bad' : '') + '">Personal Allowance ' + gbp(hh.you.allowance) + '</span>');
    if (hh.kids && hh.childcare.gross > 0) {
      tags.push(
        hh.supportOK
          ? '<span class="tag good">Childcare help kept</span>'
          : hh.earnsEnough
          ? '<span class="tag bad">Tax Free Childcare and 30 hours lost</span>'
          : '<span class="tag bad">Childcare help needs both parents working</span>'
      );
    }
    if (hh.kids && hh.hicbcPct > 0) tags.push('<span class="tag bad">Child Benefit ' + hh.hicbcPct + '% clawed back</span>');
    if (state.plan !== 'none' || state.postgrad) tags.push('<span class="tag">Student loan repayments on</span>');
    return { title, body, zone: zc, tags: tags.join('') };
  }

  /* ---------- Shared HTML bits ---------- */
  function stackHtml(parts, total, aria) {
    const sum = total || parts.reduce((p, x) => p + x.v, 0) || 1;
    return (
      '<div class="stack" role="img" aria-label="' + aria + '">' +
      parts.map((x) => '<span style="flex-basis:' + (x.v / sum) * 100 + '%;background:' + x.color + '" title="' + x.label + '"></span>').join('') +
      '</div><ul class="stack-legend">' +
      parts.map((x) => '<li><i style="background:' + x.color + '"></i>' + x.label + ' ' + x.text + '</li>').join('') +
      '</ul>'
    );
  }

  function legendHtml(items) {
    return items
      .map((i) =>
        i.box
          ? '<li><span class="sw box" style="background:' + i.color + '"></span>' + i.label + '</li>'
          : '<li><span class="sw' + (i.dash ? ' dash' : '') + '" style="border-color:' + i.color + '"></span>' + i.label + '</li>'
      )
      .join('');
  }

  function kpiHtml(a) {
    const { hh, cliff, next } = a;
    const k = perK();
    const base = T.calcHousehold(Object.assign({}, state, { pensionPct: 0 }));
    const pensionCost = base.spendable - hh.spendable;
    const own = hh.pensionSaved;
    const cards = [
      {
        k: 'Household money in pocket',
        v: gbp(hh.spendable / k),
        s: unit() + '. Take home pay ' + gbp(hh.you.takeHome / k) + (hh.partner ? ' plus partner ' + gbp(hh.partner.takeHome / k) : '') + ', adjusted for benefits and childcare.',
        c: '',
      },
      {
        k: 'Tax on your next £1,000',
        v: pctText(next.rate),
        s: next.retained >= 0 ? 'You keep ' + gbp(next.retained) + ' of the next £1,000 of salary.' : 'Earning £1,000 more leaves you ' + gbp(-next.retained) + ' worse off.',
        c: next.rate > 0.55 ? 'bad' : '',
      },
      {
        k: 'Cost of the £100,000 rules',
        v: cliff.total > 1 ? gbp(cliff.total / k) : 'None here',
        s:
          cliff.total > 1
            ? unit() + ' lost versus a world with no allowance taper and no childcare cut off (' + gbp(cliff.allowance / k) + ' allowance, ' + gbp(cliff.childcare / k) + ' childcare).'
            : 'Your adjusted net income is at or below £100,000.',
        c: cliff.total > 1 ? 'bad' : 'good',
      },
      {
        k: 'Going into your pension',
        v: own > 0 ? gbp(own / k) : 'Nothing yet',
        s:
          own > 0
            ? unit() + ' (' + fmtPct(state.pensionPct) + '% of salary). That changes your cash by ' + (pensionCost >= 0 ? 'minus ' : 'plus ') + gbp(Math.abs(pensionCost) / k) + '.'
            : 'Pension contributions are the main way out of the trap.',
        c: own > 0 && pensionCost < 0 ? 'good' : '',
      },
    ];
    return cards.map((x) => '<div class="kpi ' + x.c + '"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div><div class="s">' + x.s + '</div></div>').join('');
  }

  function stripHtml(a) {
    const hh = a.hh;
    const max = Math.min(400000, Math.max(150000, Math.ceil((Math.max(state.salary, a.x125) + 15000) / 10000) * 10000));
    const pc = (x) => Math.min(100, Math.max(0, (x / max) * 100));
    const seg = (x0, x1, c, label) => (x1 > x0 ? '<span class="seg ' + c + '" style="flex:' + (x1 - x0) + '"><i>' + label + '</i></span>' : '');
    let segs = '';
    if (hh.kids) segs += seg(0, Math.min(a.x60, a.x100), 'ok', 'Normal rates') + seg(Math.min(a.x60, a.x100), a.x100, 'warn', 'Child Benefit taken back');
    else segs += seg(0, a.x100, 'ok', 'Normal rates');
    segs += seg(a.x100, a.x125, 'trap', 'Trap zone') + seg(a.x125, max, 'past', 'Past the trap');
    const flip = pc(state.salary) > 80;
    return (
      '<div class="strip"><div class="strip-bar">' + segs + '</div>' +
      '<div class="strip-tick" style="left:' + pc(a.x100) + '%"><span>£100,000</span></div>' +
      '<div class="strip-tick late" style="left:' + pc(a.x125) + '%"><span>£125,140</span></div>' +
      '<div class="strip-marker' + (flip ? ' flip' : '') + '" style="left:' + pc(state.salary) + '%"><span>You, ' + gbp(state.salary) + '</span></div></div>'
    );
  }

  /* ---------- Chart builders ---------- */
  function niceDomain(min, max) {
    if (!(max > min)) max = min + 1;
    const ticks = C.makeTicks(min, max, 5);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : max - min;
    return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
  }

  function sampleXs(lo, hi, stp, extras) {
    const xs = new Set();
    for (let x = lo; x <= hi + 1e-9; x += stp) xs.add(+x.toFixed(4));
    xs.add(hi);
    (extras || []).forEach((x) => {
      if (x >= lo && x <= hi) xs.add(+x.toFixed(4));
    });
    return Array.from(xs).sort((p, q) => p - q);
  }

  function salaryDomain(a) {
    if (range === 'full') return [0, Math.max(250000, Math.ceil((state.salary + 5000) / 5000) * 5000)];
    const lo = Math.max(0, Math.min(a.x100 - 50000, state.salary - 8000));
    const hi = Math.min(400000, Math.max(a.x125 + 45000, state.salary + 8000));
    return [Math.floor(lo / 5000) * 5000, Math.ceil(hi / 5000) * 5000];
  }

  function buildIncome(a, o) {
    o = o || {};
    const k = perK();
    const [lo, hi] = salaryDomain(a);
    const stp = hi - lo > 150000 ? 500 : 250;
    const xs = sampleXs(lo, hi, stp, [a.x100, a.x100 + 0.01, state.salary]);
    const trapOpts = { noTaper: true, noTest: true };
    const at = (x, opts) => T.calcHousehold(Object.assign({}, state, { salary: x }), opts).spendable / k;
    const actual = xs.map((x) => [x, at(x)]);
    const ghost = xs.map((x) => [x, at(x, trapOpts)]);
    const vals = actual.concat(ghost).map((p) => p[1]);
    const lowest = Math.min.apply(null, vals);
    const highest = Math.max.apply(null, vals);
    const yd =
      range === 'full' && !o.zoom
        ? niceDomain(Math.min(0, lowest), highest * 1.04)
        : niceDomain(lowest - (highest - lowest) * 0.06, highest + (highest - lowest) * 0.04);

    const hh = a.hh;
    const partnerHigher = hh.partner && hh.partner.ani > hh.you.ani;
    const bands = [];
    if (hh.kids && !partnerHigher) bands.push({ x0: a.x60, x1: a.x80, cls: 'warn' });
    bands.push({ x0: a.x100, x1: a.x125, cls: 'trap' });

    const notes = [];
    const dots = [{ x: state.salary, y: hh.spendable / k, color: 'var(--blue)' }];
    const hlines = [];
    if (a.dz.drop > 100) {
      const before = a.dz.reference / k;
      const after = (a.dz.reference - a.dz.drop) / k;
      notes.push({ x: a.x100, y: (before + after) / 2, dx: 10, text: '↓ ' + gbp(a.dz.drop / k) + ' lost\nfor one extra £1', color: 'var(--accent)', strong: true });
      if (a.dz.breakEven) {
        hlines.push({ y: before, color: 'var(--green)', dash: '6 5', label: 'Back to where you were at the cliff' });
        notes.push({ x: a.dz.breakEven, y: before, dy: 20, anchor: 'middle', text: 'Break even ' + gbp(a.dz.breakEven), color: 'var(--green)', strong: true });
        dots.push({ x: a.dz.breakEven, y: before, color: 'var(--green)', r: 5 });
      }
    }
    const ghostNow = T.calcHousehold(state, trapOpts).spendable / k;

    const cfg = {
      height: o.height,
      x: { domain: [lo, hi], format: axisMoney, label: 'Your gross salary' },
      y: { domain: yd, format: axisMoney, label: 'Household money in pocket, ' + unit() },
      bands,
      areas: [{ top: ghost, bottom: actual, cls: 'gap' }],
      lines: [
        { points: ghost, color: 'var(--muted)', dash: '2 5', width: 2 },
        { points: actual, color: 'var(--blue)', width: 3 },
      ],
      vlines: [
        { x: a.x100, label: 'The cliff', color: 'var(--accent)', row: 0 },
        { x: a.x125, label: 'Allowance gone', color: 'var(--accent)', row: 1 },
      ],
      hlines,
      dots,
      notes,
      selected: state.salary,
      snap: 100,
      onSelect: (x) => setState({ salary: Math.round(x) }),
      tooltip: (x) => {
        const h = T.calcHousehold(Object.assign({}, state, { salary: x }));
        const g = at(x, trapOpts) * k;
        return {
          title: 'Salary ' + gbp(x) + (Math.abs(h.you.ani - x) > 1 ? ' (income ' + gbp(h.you.ani) + ')' : ''),
          rows: [
            { color: 'var(--blue)', label: 'Money in pocket', value: gbp(h.spendable / k), y: h.spendable / k },
            { color: 'var(--muted)', label: 'Without the £100k rules', value: gbp(g / k), y: g / k },
            { color: 'var(--accent)', label: 'Cost of the rules', value: gbp((g - h.spendable) / k) },
          ],
          foot: 'Take home pay ' + gbp(h.you.takeHome / k) + ', childcare help ' + (h.supportOK ? 'kept' : 'lost'),
        };
      },
      aria:
        'Line chart of household money in pocket ' + unit() + ' against gross salary from ' + gbp(lo) + ' to ' + gbp(hi) + '. At your salary of ' + gbp(state.salary) + ' it is ' + gbp(hh.spendable / k) +
        '. Without the £100,000 rules it would be ' + gbp(ghostNow) + '.' + (a.dz.drop > 100 ? ' At the cliff, one extra pound of salary removes ' + gbp(a.dz.drop / k) + '.' : ''),
    };
    return {
      cfg,
      legend: [
        { color: 'var(--blue)', label: 'Your money in pocket' },
        { color: 'var(--muted)', label: 'Without the £100,000 rules', dash: true },
        { color: 'var(--accent)', label: 'Cost of the rules (shaded)', box: true },
        { color: 'var(--accent-soft)', label: 'The 62% trap zone', box: true },
        ...(hh.kids && !partnerHigher ? [{ color: 'var(--amber-soft)', label: 'Child Benefit charge zone', box: true }] : []),
      ],
      title: 'What you really keep at every salary',
      sub:
        'Money in your pocket after tax, National Insurance, student loan, childcare and benefits. The gap to the dotted line is what the £100,000 rules cost.' +
        (range === 'focus' ? ' The vertical axis does not start at zero in this zoomed view.' : ''),
    };
  }

  const rateColor = (r) => (r > 1 ? 'var(--ink)' : r >= 0.6 ? 'var(--accent)' : r >= 0.4 ? 'var(--amber)' : r >= 0.25 ? 'var(--blue)' : 'var(--green)');

  function buildMarginal(a, o) {
    o = o || {};
    const [lo, hi] = salaryDomain(a);
    const stp = hi - lo > 150000 ? 500 : 250;
    const fn = (x) => {
      const h = T.calcHousehold(Object.assign({}, state, { salary: x }));
      return h.spendable + h.pensionSaved;
    };
    const bars = [];
    let maxRate = 0;
    let prev = fn(lo);
    for (let x = lo; x < hi; x += stp) {
      const nxt = fn(x + stp);
      const r = 1 - (nxt - prev) / stp;
      prev = nxt;
      maxRate = Math.max(maxRate, Math.min(r, 1));
      bars.push({ x0: x, x1: x + stp, y: Math.max(0, r), fill: rateColor(r), r });
    }
    const yMax = bars.some((b) => b.r > 1) ? 1.05 : Math.max(0.7, Math.ceil(maxRate * 10) / 10 + 0.05);
    const trapMid = (a.x100 + a.x125) / 2;
    const inTrapRate = T.marginalRate(state, trapMid, 500);
    const nowRate = T.nextSlice(Object.assign({}, state, { salary: Math.floor(state.salary / stp) * stp }), stp).rate;
    const notes = [{ x: trapMid, y: Math.min(yMax, Math.max(0, inTrapRate)), dy: -8, anchor: 'middle', text: pctText(inTrapRate) + ' in the trap', color: 'var(--accent)', strong: true }];
    if (a.dz.drop > 100 && yMax >= 1) {
      notes.push({ x: a.x100, y: 1.05, dx: -8, dy: 14, anchor: 'end', text: 'Cliff: ' + gbp(a.dz.drop) + ' lost\nfor one extra £1', color: 'var(--ink)', strong: true });
    }
    const cfg = {
      height: o.height,
      x: { domain: [lo, hi], format: axisMoney, label: 'Your gross salary' },
      y: { domain: [0, yMax], format: (v) => Math.round(v * 100) + '%', ticks: C.makeTicks(0, yMax, 5), label: 'Share of each extra £ lost' },
      bands: [{ x0: a.x100, x1: a.x125, cls: 'trap' }],
      bars,
      vlines: [
        { x: a.x100, label: 'The cliff', color: 'var(--accent)', row: 0 },
        { x: a.x125, label: 'Allowance gone', color: 'var(--accent)', row: 1 },
      ],
      dots: [{ x: state.salary, y: Math.min(yMax, Math.max(0, nowRate)), color: 'var(--ink)' }],
      notes,
      selected: state.salary,
      snap: 100,
      onSelect: (x) => setState({ salary: Math.round(x) }),
      tooltip: (x) => {
        const sl = T.nextSlice(Object.assign({}, state, { salary: Math.floor(x / stp) * stp }), stp);
        const rows = [];
        const add = (label, v, color) => {
          if (Math.abs(v) > 0.005) rows.push({ color, label, value: pctText(v / stp) });
        };
        add('Income tax', sl.tax, 'var(--amber)');
        add('National Insurance', sl.ni, 'var(--blue)');
        add('Student loan', sl.studentLoan, 'var(--muted)');
        add('Child Benefit charge', sl.hicbc, 'var(--accent)');
        add('Childcare help lost', sl.childcare, 'var(--accent)');
        add('Into your pension', sl.pension, 'var(--green)');
        rows.push({ color: 'var(--green)', label: 'You keep in cash', value: sl.kept >= 0 ? pctText(sl.kept / stp) : 'less than nothing' });
        return { title: 'Salary ' + gbp(x) + ' to ' + gbp(x + stp), rows, foot: 'Total effective tax rate ' + pctText(sl.rate) };
      },
      aria:
        'Bar chart of the share of each extra pound lost to tax and lost benefits, against gross salary from ' + gbp(lo) + ' to ' + gbp(hi) + '. Inside the trap zone it is ' + pctText(inTrapRate) +
        (a.dz.drop > 100 ? ', and at the cliff one extra pound costs ' + gbp(a.dz.drop) + '.' : '.'),
    };
    return {
      cfg,
      legend: [
        { box: true, color: 'var(--green)', label: 'Under 25%' },
        { box: true, color: 'var(--blue)', label: '25% to 40%' },
        { box: true, color: 'var(--amber)', label: '40% to 60%' },
        { box: true, color: 'var(--accent)', label: '60% to 100%' },
        { box: true, color: 'var(--ink)', label: 'Over 100%, a cliff' },
      ],
      title: 'How much of each extra pound disappears',
      sub: 'Income tax, National Insurance, student loan and lost benefits as a share of each extra step of salary. The trap is a hump taller than the top rate.',
    };
  }

  function buildPension(a, o) {
    o = o || {};
    const k = perK();
    const salary = Math.max(1, state.salary);
    const maxPct = Math.max(1, Math.floor(Math.min(100, (Math.max(0, a.hh.pensionCap) / salary) * 100) * 2) / 2);
    const need = T.pensionPctForANI(state, R.taperStart);
    const extras = [state.pensionPct];
    if (need.needed) extras.push(need.exactPct, need.exactPct - 0.001);
    const xs = sampleXs(0, maxPct, 0.5, extras);
    const res = xs.map((p) => ({ p, h: T.calcHousehold(Object.assign({}, state, { pensionPct: p })) }));
    const cash = res.map((r) => [r.p, r.h.spendable / k]);
    const both = res.map((r) => [r.p, (r.h.spendable + r.h.pensionSaved) / k]);
    const vals = cash.concat(both).map((p) => p[1]);
    const lowest = Math.min.apply(null, vals);
    const highest = Math.max.apply(null, vals);
    const yd = niceDomain(lowest - (highest - lowest) * 0.05, highest + (highest - lowest) * 0.08);
    const nowBoth = (a.hh.spendable + a.hh.pensionSaved) / k;
    const vlines = [];
    const notes = [];
    const showNeed = need.needed > 0 && need.exactPct <= maxPct;
    if (showNeed) {
      vlines.push({ x: need.exactPct, label: fmtPct(need.pct) + '% gets you to £100,000', color: 'var(--accent)', row: 0 });
      const c0 = T.calcHousehold(Object.assign({}, state, { pensionPct: need.exactPct })).spendable / k;
      const c1 = T.calcHousehold(Object.assign({}, state, { pensionPct: Math.max(0, need.exactPct - 0.001) })).spendable / k;
      if (c0 - c1 > 100 / k) {
        notes.push({ x: need.exactPct, y: (c0 + c1) / 2, dx: 10, text: '↑ ' + gbp(c0 - c1) + ' of cash\ncomes back here', color: 'var(--green)', strong: true });
      }
    }
    const cfg = {
      height: o.height,
      x: { domain: [0, maxPct], format: (v) => fmtPct(v) + '%', label: 'Pension contribution, % of your gross salary' },
      y: { domain: yd, format: axisMoney, label: 'Money ' + unit() },
      bands: showNeed ? [{ x0: 0, x1: need.exactPct, cls: 'trap' }] : [],
      lines: [
        { points: both, color: 'var(--green)', dash: '7 5', width: 2.5 },
        { points: cash, color: 'var(--blue)', width: 3 },
      ],
      vlines,
      dots: state.pensionPct <= maxPct ? [{ x: state.pensionPct, y: a.hh.spendable / k, color: 'var(--blue)' }, { x: state.pensionPct, y: nowBoth, color: 'var(--green)' }] : [],
      notes,
      selected: state.pensionPct <= maxPct ? state.pensionPct : null,
      snap: 0.5,
      onSelect: (x) => setState({ pensionPct: Math.round(x * 2) / 2 }),
      tooltip: (x) => {
        const h = T.calcHousehold(Object.assign({}, state, { pensionPct: x }));
        const d0 = T.calcHousehold(Object.assign({}, state, { pensionPct: 0 })).spendable;
        return {
          title: 'Pension of ' + fmtPct(x) + '% (' + gbp(h.pensionSaved) + ' a year)',
          rows: [
            { color: 'var(--blue)', label: 'Cash in pocket', value: gbp(h.spendable / k), y: h.spendable / k },
            { color: 'var(--green)', label: 'Cash plus pension saved', value: gbp((h.spendable + h.pensionSaved) / k), y: (h.spendable + h.pensionSaved) / k },
            { color: 'var(--muted)', label: 'Cash change versus none', value: (h.spendable >= d0 ? 'up ' : 'down ') + gbp(Math.abs(h.spendable - d0) / k) },
          ],
          foot: 'Adjusted net income ' + gbp(h.you.ani) + (h.supportOK ? '' : ', childcare help lost'),
        };
      },
      aria:
        'Chart of household money against pension percentage at a salary of ' + gbp(state.salary) + '. ' +
        (need.needed ? 'A pension of ' + fmtPct(need.pct) + '% of salary brings income to £100,000 and restores the allowance and childcare help.' : 'Your income is already at or below £100,000.'),
    };
    return {
      cfg,
      legend: [
        { color: 'var(--blue)', label: 'Cash in your pocket' },
        { color: 'var(--green)', label: 'Cash plus what you saved in your pension', dash: true },
        { box: true, color: 'var(--accent-soft)', label: 'Still inside the trap' },
      ],
      title: need.needed ? 'Pay into your pension and watch your cash climb' : 'What a pension contribution costs you',
      sub: 'Your salary stays at ' + gbp(state.salary) + '. Drag along the chart to change your pension percentage. The green line adds back the money you saved, so it never falls.',
    };
  }

  function mountChart(instance, built, ids) {
    instance.update(built.cfg);
    if (ids.legend) $(ids.legend).innerHTML = legendHtml(built.legend);
    if (ids.title) $(ids.title).textContent = built.title;
    if (ids.sub) $(ids.sub).textContent = built.sub;
  }

  /* ---------- Plain language blocks ---------- */
  function penceParts(a, delta) {
    const s2 = Object.assign({}, state, { salary: state.salary + delta });
    const A = a.hh;
    const B = T.calcHousehold(s2);
    const noA = T.calcHousehold(state, { noTaper: true });
    const noB = T.calcHousehold(s2, { noTaper: true });
    const taxDelta = B.you.tax - A.you.tax;
    const plain = noB.you.tax - noA.you.tax;
    const to = (v) => (v / delta) * 100;
    const p = {
      plain: to(plain),
      allowance: to(taxDelta - plain),
      ni: to(B.you.ni - A.you.ni),
      loan: to(B.you.studentLoan - A.you.studentLoan),
      hicbc: to(B.hicbc - A.hicbc),
      childcare: to(B.childcare.net - A.childcare.net),
      pension: to(B.pensionSaved - A.pensionSaved),
    };
    p.keep = 100 - p.plain - p.allowance - p.ni - p.loan - p.hicbc - p.childcare - p.pension;
    return p;
  }

  function howHtml(a) {
    const y = a.hh.you;
    const k = 12;
    const parts = [
      { label: 'Income tax', v: y.tax, color: 'var(--amber)' },
      { label: 'National Insurance', v: y.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: y.studentLoan, color: 'var(--muted)' },
      { label: 'Pension and Gift Aid', v: y.sacrifice + y.personal + y.giftGross, color: 'var(--green)' },
      { label: 'Take home pay', v: y.takeHome, color: 'var(--ink)' },
    ].filter((x) => x.v > 0.5).map((x) => Object.assign(x, { text: gbp(x.v / k) + ' a month (' + Math.round((x.v / y.salary) * 100) + '%)' }));

    const p = penceParts(a, 100);
    const pence = [
      { label: 'Income tax at your normal rate', v: p.plain, color: 'var(--amber)' },
      { label: 'Extra tax because your allowance shrinks', v: p.allowance, color: 'var(--accent)' },
      { label: 'National Insurance', v: p.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: p.loan, color: 'var(--muted)' },
      { label: 'Child Benefit taken back', v: p.hicbc, color: '#a05a00' },
      { label: 'Childcare help lost', v: p.childcare, color: '#7a0f1e' },
      { label: 'Into your pension', v: p.pension, color: 'var(--green)' },
    ].filter((x) => Math.abs(x.v) > 0.4);
    const taxTotal = pence.filter((x) => x.label !== 'Into your pension').reduce((q, x) => q + x.v, 0);
    pence.forEach((x) => (x.text = Math.round(x.v) + 'p'));
    pence.push({ label: 'You keep in cash', v: Math.max(0, p.keep), color: 'var(--ink)', text: Math.round(p.keep) + 'p' });

    const meter = Math.round((y.allowance / R.personalAllowance) * 100);
    return (
      '<div class="viz-block"><h4>Where your ' + gbp(y.salary / k) + ' a month goes</h4>' + stackHtml(parts, y.salary, 'Where your salary goes') + '</div>' +
      '<div class="viz-block"><h4>Your Personal Allowance</h4><div class="meter inv"><span style="width:' + meter + '%"></span></div>' +
      '<p class="small">' + gbp(y.allowance) + ' of £12,570 left.' + (meter < 100 ? ' You have lost ' + gbp(R.personalAllowance - y.allowance) + ' of it.' : ' You have not started losing it yet.') + '</p></div>' +
      '<div class="viz-block"><h4>Of every extra £1 you earn</h4>' + stackHtml(pence, 100, 'Where an extra pound goes') +
      '<p class="pence-sum">' + (p.keep < 0 ? 'Your next pound would leave you worse off.' : '<b>' + Math.round(taxTotal) + 'p</b> goes in tax and lost benefits. <b>' + Math.round(100 - taxTotal) + 'p</b> stays with you' + (p.pension > 0.5 ? ', some of it in your pension' : '') + '.') + '</p>' +
      (p.allowance > 0.5 ? '<p class="small">Each extra £1 of income removes 50p of your allowance, and that 50p is then taxed at your top rate. That hidden step is the extra ' + Math.round(p.allowance) + 'p.</p>' : '') + '</div>'
    );
  }

  function loanCardHtml() {
    const lp = T.loanPayoff(state);
    if (lp.state === 'none') return '';
    const tiles =
      '<div class="loan-card"><div class="tile"><span class="k">Repaid each month</span><b>' + gbp(lp.monthly) + '</b><span class="s">' + gbp(lp.annual) + ' a year at your current pay</span></div>' +
      (lp.state === 'clears'
        ? '<div class="tile"><span class="k">Loan cleared in about</span><b>' + (lp.years < 1 ? plural(lp.months, 'month', 'months') : +lp.years.toFixed(1) + ' years') + '</b><span class="s">around ' + monthYear.format(new Date(new Date().setMonth(new Date().getMonth() + lp.months))) + '</span></div>' +
          '<div class="tile good"><span class="k">Your pay then rises by</span><b>' + gbp(lp.monthly) + '</b><span class="s">a month, ' + gbp(lp.annual) + ' a year</span></div>'
        : '') + '</div>';
    let msg = '';
    if (lp.state === 'unknown') msg = '<p class="small">Add your current balance in the optional student loan details to see when your repayments stop and your pay goes up.</p>';
    else if (lp.state === 'never') msg = '<p class="small">At your current pay and a ' + fmtPct(lp.rate * 100) + '% interest rate, your repayments barely cover the interest, so this loan would probably not clear before it is written off. Check your statement for the real interest rate.</p>';
    else msg = '<p class="small">This assumes your pay and the repayment thresholds stay the same and a ' + fmtPct(lp.rate * 100) + '% interest rate. A pay rise speeds it up. Write off dates (usually 25 to 40 years) are not modelled.</p>';
    return tiles + msg;
  }

  /* ---------- Question screens: live "what this means" cards ---------- */
  function insSalary(a) {
    const { hh, next, zone } = a;
    const toCliff = a.x100 - state.salary;
    const keep = Math.max(0, Math.round(next.retained / 10));
    let title;
    let body;
    if (state.salary <= R.personalAllowance) {
      title = 'You pay no income tax';
      body = 'Income up to £12,570 is tax free, so the £100,000 cliff is a long way off.';
    } else if (zone === 'trap') {
      title = 'You are in the trap zone';
      body = 'Between £100,000 and £125,140 you keep only about ' + keep + 'p of every extra £1 you earn. That is the same as paying ' + pctText(next.rate) + ' tax on it.';
    } else if (zone === 'top') {
      title = 'You are past the trap';
      body = 'You have already lost your Personal Allowance. Each extra £1 now keeps about ' + keep + 'p.';
    } else if (toCliff <= 15000) {
      title = 'You are close to the cliff';
      body = 'You are only ' + gbp(toCliff) + ' below £100,000. A pay rise or bonus that takes you over the line is worth less than it looks.';
    } else {
      title = 'You are comfortably below the cliff';
      body = 'The line is at £100,000, which is ' + gbp(toCliff) + ' above your pay. Nothing dramatic happens yet. Of your next £1,000 you keep about ' + gbp(Math.max(0, next.retained)) + '.';
    }
    const cls = zone === 'trap' ? ' bad' : '';
    $('insSalary').className = 'insight-card' + cls;
    $('insSalary').innerHTML = '<h4>' + title + '</h4><p>' + body + '</p>' + stripHtml(a);
  }

  function insKids() {
    const el = $('insKids');
    el.className = 'insight-card';
    if (kidsChoice === 'no') {
      el.innerHTML = '<h4>No childcare worries</h4><p>The childcare cliff will not affect you. The 62% rate between £100,000 and £125,140 still applies if you earn that much, and we will show you how to deal with it.</p>';
    } else if (kidsChoice === 'yes') {
      el.innerHTML = '<h4>Good to know</h4><p>Families can lose thousands of pounds a year in childcare help the moment one parent earns over £100,000. Next we will check what is at stake for you.</p>';
    } else {
      el.innerHTML = '';
    }
  }

  function insAges(a) {
    const hh = a.hh;
    const el = $('insAges');
    el.className = 'insight-card';
    if (!hh.kids) {
      el.innerHTML = '';
      return;
    }
    const pct = hh.hicbcPct;
    const under5 = state.children.some((c) => ['baby', 'toddler', 'preschool'].includes(c.band));
    el.innerHTML =
      '<h4>Child Benefit: ' + gbp(hh.benefitGross) + ' a year</h4>' +
      '<p>That is what the government pays for ' + plural(hh.kids, 'child', 'children') + ' (' + gbp(hh.benefitGross / 12) + ' a month).</p>' +
      '<div class="meter' + (pct > 0 ? ' low' : '') + '"><span style="width:' + pct + '%"></span></div>' +
      '<p class="small">' +
      (pct === 0 ? 'At your income you keep all of it. It starts being taken back above £60,000.'
        : pct < 100 ? 'At your income ' + gbp(hh.hicbc) + ' of it (' + pct + '%) is taken back through the tax system. It is all gone at £80,000.'
        : 'At your income all of it is taken back through the tax system. You can still claim it to protect your National Insurance record.') + '</p>' +
      (under5 ? '<p class="small">Children from 9 months to 4 can also get 30 free hours of childcare a week, but only while you are at or under £100,000.</p>' : '');
  }

  function insChildcare(a) {
    const hh = a.hh;
    const dz = a.dz;
    const el = $('insChildcare');
    el.className = 'insight-card';
    if (!hh.kids || hh.childcare.gross <= 0) {
      el.innerHTML = '';
      return;
    }
    const c = hh.childcare;
    const rows = [
      ['Childcare at full price', c.gross, ''],
      ['Free hours (worth)', -c.funded, 'pos'],
      ['Tax Free Childcare top up', -c.tfc, 'pos'],
    ].filter((r) => Math.abs(r[1]) > 0.5);
    const table = '<table class="mini-table"><tbody>' + rows.map((r) => '<tr><th scope="row">' + r[0] + '</th><td class="num-col ' + r[2] + '">' + (r[1] < 0 ? 'less ' : '') + gbp(r[1]) + ' a year</td></tr>').join('') + '<tr class="total"><th scope="row">You pay</th><td class="num-col">' + gbp(c.net) + ' a year</td></tr></tbody></table>';
    if (dz.drop > 100 && hh.supportOK) {
      el.className = 'insight-card bad';
      el.innerHTML =
        '<h4>One pound over £100,000 costs you ' + gbp(dz.drop) + ' a year</h4>' +
        '<p>The moment you or your partner earn over £100,000, the free hours and Tax Free Childcare switch off. Your childcare bill would jump from ' + gbp(c.net) + ' to ' + gbp(c.net + dz.drop) + ' a year.</p>' + table;
    } else if (!hh.supportOK && hh.earnsEnough) {
      el.className = 'insight-card bad';
      el.innerHTML = '<h4>You have already lost ' + gbp(a.cliff.childcare) + ' a year of childcare help</h4><p>Free hours and Tax Free Childcare stop for the whole family once either parent is over £100,000. We will show you how to get it back.</p>' + table;
    } else {
      el.className = 'insight-card good';
      el.innerHTML = '<h4>You keep your childcare help</h4><p>At your income you get the free hours and Tax Free Childcare. They are worth about ' + gbp(c.funded + c.tfc) + ' a year to you.</p>' + table;
    }
  }

  function pensionNeed() {
    const need = T.pensionPctForANI(state, R.taperStart);
    const s = T.strategies(state);
    return { need, row: s.rows.find((r) => r.id === 'hundred-' + state.method) };
  }

  function insPension(a) {
    const hh = a.hh;
    const el = $('insPension');
    const { need, row } = pensionNeed();
    const base = T.calcHousehold(Object.assign({}, state, { pensionPct: 0 }));
    el.className = 'insight-card';
    let html = '';
    if (hh.you.ani > R.taperStart + 0.005 && need.needed > 0) {
      el.className = 'insight-card bad';
      html = '<h4>' + (hh.pensionSaved > 0 ? 'Your ' + fmtPct(state.pensionPct) + '% is not quite enough' : 'You are over the line') + '</h4>' +
        '<p>Your income for the tests is ' + gbp(hh.you.ani) + ', so you are ' + gbp(hh.you.ani - R.taperStart) + ' over £100,000.</p>';
      if (row && row.feasible) {
        html += '<div class="tip"><b>Tip: raise it to ' + fmtPct(row.pct) + '%</b>' +
          (row.change > 1
            ? 'That is ' + gbp(row.extra) + ' more a year into your pension, and you would take home ' + gbp(row.change / 12) + ' MORE each month.'
            : 'That is ' + gbp(row.extra) + ' more a year into your pension for about ' + gbp(row.cost / 12) + ' a month in take home pay.') +
          '<br><button type="button" class="btn small primary" data-apply-pct="' + row.pct + '">Set my pension to ' + fmtPct(row.pct) + '%</button></div>';
      } else {
        html += '<div class="tip warn"><b>Pension alone cannot get you there</b>You would need more than the £60,000 a year pension limit. Pay in as much as you can and look at the extra ideas on your results page.</div>';
      }
    } else if (hh.pensionSaved > 0 && base.you.ani > R.taperStart + 0.005) {
      el.className = 'insight-card good';
      html = '<h4>Your pension is keeping you out of the trap</h4><p>Without it your income would be ' + gbp(base.you.ani) + ' and you would lose ' + gbp(a.cliff.total > 0 ? a.cliff.total : T.cliffCost(Object.assign({}, state, { pensionPct: 0 })).total) + ' a year. With it you are at ' + gbp(hh.you.ani) + '.</p>' +
        '<p class="small">Your pension takes ' + gbp(hh.pensionSaved / 12) + ' a month from your pay. After tax relief and the help you get back, ' +
        (base.spendable - hh.spendable >= 0
          ? 'it costs you about ' + gbp((base.spendable - hh.spendable) / 12) + ' a month in take home pay.'
          : 'you actually end up with ' + gbp((hh.spendable - base.spendable) / 12) + ' MORE a month in your pocket.') + '</p>';
    } else {
      const test = T.calcHousehold(Object.assign({}, state, { pensionPct: state.pensionPct + 5 }));
      const per = (hh.spendable - test.spendable) / Math.max(1, test.pensionSaved - hh.pensionSaved);
      html = '<h4>You are under the line</h4><p>At ' + gbp(hh.you.ani) + ' there is nothing to escape. A pension still saves you tax: each extra £1 you put in costs you about ' + Math.round(per * 100) + 'p after tax relief.</p>';
    }
    el.innerHTML = html;
    mountChart(charts.p, buildPension(a, { height: 300 }), { legend: 'legendP' });
  }

  function insExtras(a) {
    const el = $('insExtras');
    el.className = 'insight-card';
    const parts = [];
    if (openPanels.has('loan')) {
      const l = loanCardHtml();
      if (l) parts.push('<h4>Your student loan</h4>' + l);
    }
    if (openPanels.has('partner') && state.partnerOn) {
      const hh = a.hh;
      parts.push('<h4>Your partner</h4><p>' + (hh.partner && hh.partner.ani > R.childcare.incomeLimit ? 'Your partner is over £100,000, so any childcare help is lost for the whole family.' : 'Childcare help is kept only while both of you are at or under £100,000.') + '</p>');
    }
    el.innerHTML = parts.join('');
  }

  /* ---------- Results page ---------- */
  function heroCopy(a) {
    const { hh, cliff, dz, zone } = a;
    const toCliff = a.x100 - state.salary;
    const base = T.calcHousehold(Object.assign({}, state, { pensionPct: 0 }));
    const baseCost = hh.pensionSaved > 0 && base.you.ani > R.taperStart + 0.005 ? T.cliffCost(Object.assign({}, state, { pensionPct: 0 })).total : 0;
    if (cliff.total > 1) {
      return {
        kind: '',
        title: 'The £100,000 cliff is costing you ' + gbp(cliff.total) + ' a year',
        body:
          cliff.childcare > 1
            ? 'That is ' + gbp(cliff.childcare) + ' of lost childcare help and ' + gbp(cliff.allowance) + ' of Personal Allowance you would have kept without the rules. Here is what you can do about it.'
            : 'That is Personal Allowance you lose between £100,000 and £125,140, and it is taxed on top. Here is what you can do about it.',
      };
    }
    if (baseCost > 1) {
      return { kind: 'good', title: 'Your pension is keeping you out of the trap', body: 'Without it you would be over £100,000 and lose about ' + gbp(baseCost) + ' a year. Nice work. Here is how to make the most of it.' };
    }
    if (zone === 'higher' && toCliff <= 15000) {
      return {
        kind: 'warn',
        title: 'You are ' + gbp(toCliff) + ' below the cliff',
        body: hh.kids && hh.childcare.gross > 0
          ? 'Stay under £100,000 and you keep everything. Cross it and you would lose about ' + gbp(dz.drop) + ' of childcare help in one go.'
          : 'Stay under £100,000 and you keep everything. Cross it and each extra £1 only keeps about 38p.',
      };
    }
    return { kind: 'good', title: 'You are nowhere near the cliff, yet', body: 'At ' + gbp(state.salary) + ' the £100,000 rules are ' + gbp(toCliff) + ' away. If your pay is likely to rise, plan your pension before it does.' };
  }

  function buildTips(a) {
    const s = state;
    const hh = a.hh;
    const out = [];
    const strat = T.strategies(s);
    const find = (id) => strat.rows.find((r) => r.id === id);
    const mine = find('hundred-' + s.method);
    const gift = find('hundred-gift');
    const sixty = find('sixty-' + s.method);
    const toCliff = a.x100 - s.salary;
    const care = hh.kids && hh.childcare.gross > 0;
    const over = hh.you.ani > R.taperStart + 0.005;

    if (over && mine) {
      if (mine.feasible) {
        out.push({
          best: true,
          tag: 'Your biggest win',
          title: 'Raise your pension from ' + fmtPct(s.pensionPct) + '% to ' + fmtPct(mine.pct) + '%',
          body: 'That is ' + gbp(mine.extra) + ' more a year going into your pension. It brings the income HMRC counts down to £100,000, which gives you back ' + (care ? 'your childcare help and ' : '') + 'your Personal Allowance.',
          gain: mine.change > 1
            ? 'You would take home ' + gbp(mine.change / 12) + ' MORE every month, and still add ' + gbp(mine.extra) + ' a year to your pension.'
            : 'It costs about ' + gbp(mine.cost / 12) + ' a month in take home pay, for ' + gbp(mine.extra) + ' a year in your pension. That is just ' + Math.round(mine.costPerPound * 100) + 'p of pay for every £1 saved.',
          how: s.method === 'sacrifice'
            ? 'Ask your employer to increase your salary sacrifice. Do it early in the tax year if you can, so it spreads across your payslips.'
            : 'Pay into a personal pension, then claim the extra tax relief from HMRC through your tax return or tax code. Salary sacrifice is usually better value if your employer offers it, because it also cuts National Insurance.',
          action: { label: 'Try ' + fmtPct(mine.pct) + '% for me', set: { pensionPct: mine.pct } },
        });
      } else {
        out.push({
          tag: 'Pension limit',
          title: 'Pension alone cannot get you under the line',
          body: 'You would need about ' + fmtPct(mine.pct) + '% of your pay, which is more than the £60,000 a year pension limit (or more than you earn). Pay in as much as you can and use the ideas below.',
          how: 'You can also use unused pension allowance from the previous three tax years, called carry forward.',
        });
      }
    }
    if (over && gift && gift.extra * 0.8 <= 3000) {
      out.push({
        tag: 'If you already give to charity',
        title: 'Give ' + gbp(gift.extra * 0.8) + ' with Gift Aid',
        body: 'Gift Aid donations lower the income HMRC counts. A gift of ' + gbp(gift.extra * 0.8) + ' (worth ' + gbp(gift.extra) + ' to the charity) would also bring you down to £100,000.',
        gain: gift.change > 1 ? 'You would also gain about ' + gbp(gift.change / 12) + ' a month in take home pay.' : 'Your net cost is about ' + gbp(gift.cost / 12) + ' a month.',
        how: 'Only worth it if you were going to give anyway. Keep a record of your donations.',
        action: { label: 'Try it for me', set: { gift: s.gift + gift.extra / R.giftAidGrossUp } },
      });
    }
    if (!over && toCliff > 0 && toCliff <= 15000) {
      out.push({
        tag: 'Heads up',
        title: 'Watch out for bonuses and pay rises',
        body: 'You are ' + gbp(toCliff) + ' below £100,000. A pay rise or bonus that takes you over the line costs you more than it gives' + (care ? ', because you would lose about ' + gbp(a.dz.drop) + ' of childcare help' : '') + '.',
        how: 'Ask your employer to pay a bonus into your pension instead of your bank account, or to put part of a pay rise into your pension.',
      });
    }
    if (hh.hicbcPct > 0 && hh.hicbcPct < 100 && sixty && sixty.feasible && !over) {
      out.push({
        tag: 'Child Benefit',
        title: 'Raise your pension to ' + fmtPct(sixty.pct) + '% to keep your Child Benefit',
        body: 'Your income is ' + gbp(hh.you.ani) + ', so ' + gbp(hh.hicbc) + ' of your Child Benefit is taken back. Paying more into your pension brings you back to £60,000.',
        gain: sixty.change > 1 ? 'You would take home ' + gbp(sixty.change / 12) + ' more each month.' : 'It costs about ' + gbp(sixty.cost / 12) + ' a month in take home pay for ' + gbp(sixty.extra) + ' a year in your pension.',
        action: { label: 'Try ' + fmtPct(sixty.pct) + '%', set: { pensionPct: sixty.pct } },
      });
    }
    if (hh.partner && hh.partner.ani > R.childcare.incomeLimit && hh.you.ani <= R.childcare.incomeLimit && care) {
      out.push({
        tag: 'Your partner',
        title: 'The cliff is on your partner\'s side',
        body: 'Your own income is under £100,000, but your partner\'s is over it, so the family has lost childcare help.',
        how: 'Your partner raising their pension contribution is the fix. This explorer only models your pension, so try it with your partner\'s salary lowered to see the effect.',
      });
    }
    if (a.zone === 'top' || (!over && a.zone === 'higher' && toCliff > 15000)) {
      const test = T.calcHousehold(Object.assign({}, s, { pensionPct: s.pensionPct + 5 }));
      const per = (hh.spendable - test.spendable) / Math.max(1, test.pensionSaved - hh.pensionSaved);
      out.push({
        tag: 'Good to know',
        title: 'A pension still saves you tax',
        body: 'Each extra £1 you pay into a pension costs you about ' + Math.round(per * 100) + 'p of take home pay at your income.',
        how: 'If your pay is likely to rise towards £100,000, build your pension up first so the cliff has less to bite on.',
      });
    }
    if (over && (s.plan !== 'none' || s.postgrad) && s.method === 'sacrifice') {
      out.push({
        tag: 'Student loan',
        title: 'Salary sacrifice also lowers your loan repayments',
        body: 'Student loan repayments are 9% of your pay above the threshold. Pay you sacrifice into a pension is not counted, so you repay less as well.',
      });
    }
    if (!out.length) {
      out.push({
        tag: 'Good news',
        title: 'Nothing to fix right now',
        body: 'At ' + gbp(s.salary) + ' you are in good shape. If your pay is likely to rise, check back with the new figure.',
      });
    }
    return out;
  }

  const tipHtml = (t, i) =>
    '<article class="tip-card' + (t.best ? ' best' : '') + '">' +
    (t.tag ? '<div class="badge-row">' + t.tag + '</div>' : '') +
    '<h4>' + t.title + '</h4><p>' + t.body + '</p>' +
    (t.gain ? '<p class="gain">' + t.gain + '</p>' : '') +
    (t.how ? '<p class="tip-how"><b>How:</b> ' + t.how + '</p>' : '') +
    (t.action ? '<button type="button" class="btn small primary" data-tip="' + i + '">' + t.action.label + '</button>' : '') +
    '</article>';

  function renderResults(a) {
    const hero = heroCopy(a);
    const hh = a.hh;
    const retained = Math.max(0, a.next.retained);
    $('rpHero').className = 'rp-hero ' + hero.kind;
    $('rpHero').innerHTML =
      '<p class="kicker">Your results</p><h2>' + hero.title + '</h2><p>' + hero.body + '</p>' +
      '<div class="big-numbers">' +
      '<div class="tile"><span class="k">Money in your pocket</span><b>' + gbp(hh.spendable / 12) + '</b><span class="s">a month for your household, after tax, pension and childcare</span></div>' +
      '<div class="tile' + (a.next.rate > 0.55 ? ' bad' : '') + '"><span class="k">You keep from your next £1,000</span><b>' + gbp(retained) + '</b><span class="s">a ' + pctText(a.next.rate) + ' tax rate on extra pay</span></div>' +
      '<div class="tile' + (hh.pensionSaved > 0 ? ' good' : '') + '"><span class="k">Going into your pension</span><b>' + gbp(hh.pensionSaved / 12) + '</b><span class="s">a month (' + fmtPct(state.pensionPct) + '% of your pay)</span></div></div>';

    tips = buildTips(a);
    $('rpTips').innerHTML = tips.map(tipHtml).join('');

    const loan = loanCardHtml();
    $('rpLoanBlock').hidden = !loan;
    $('rpLoan').innerHTML = loan;

    $('rpHow').innerHTML = howHtml(a);

    const built = buildIncome(a, { height: 340, zoom: true });
    mountChart(charts.r, built, { legend: 'legendR' });
    $('rpChartSub').textContent = 'The solid line is what ends up in your pocket at each salary. The dotted line is what you would keep without the £100,000 rules. Click or drag to try other salaries.';
  }

  /* ---------- Dashboard ---------- */
  function insightsList(a) {
    const s = state;
    const { hh, dz, cliff, zone } = a;
    const out = [];
    const add = (kind, title, text) => out.push({ kind, title, text });
    const strat = T.strategies(s);

    if (zone === 'trap') {
      add('bad', 'You keep ' + gbp(Math.max(0, a.next.retained)) + ' of your next £1,000', 'Between £100,000 and £125,140 income tax, National Insurance and the lost Personal Allowance combine into an effective ' + pctText(a.next.rate) + ' rate. That is higher than the 47% rate paid by someone earning £500,000.');
    } else if (zone === 'higher' || zone === 'basic') {
      add('info', 'The trap begins in ' + gbp(dz.cliffSalary - s.salary) + ' of salary', 'At £100,000 of adjusted net income the Personal Allowance starts to shrink by £1 for every £2 earned. Your next £1,000 currently keeps ' + gbp(Math.max(0, a.next.retained)) + '.');
    } else if (zone === 'top') {
      add('info', 'You have passed the worst of it', 'Above £125,140 the Personal Allowance is gone and each extra pound is taxed at ' + pctText(a.next.rate) + ', down from about 62% inside the trap.');
    }

    if (dz.drop > 100) {
      if (hh.supportOK) {
        add('bad', 'One more pound at the cliff costs ' + gbp(dz.drop) + ' a year', 'At £100,001 Tax Free Childcare and the 30 funded hours switch off for the whole family, and the allowance starts to disappear. Your childcare bill goes from ' + gbp(hh.childcare.net) + ' to ' + gbp(hh.childcare.net + dz.drop) + ' a year.');
      } else if (hh.earnsEnough) {
        add('bad', 'You have already lost ' + gbp(cliff.childcare) + ' a year of childcare help', 'Tax Free Childcare and the 30 funded hours are lost for the whole family when either parent is over £100,000 of adjusted net income.');
      }
    }

    if (dz.breakEven) {
      const deficit = dz.reference - hh.spendable;
      if (s.salary > dz.cliffSalary && deficit > 0) {
        add('bad', 'You are in the dead zone, ' + gbp(deficit / perK()) + ' ' + unit() + ' worse off than at £100,000', 'A salary of ' + gbp(dz.breakEven) + ' is the first one that leaves you better off than someone on ' + gbp(dz.cliffSalary) + '. That is ' + gbp(dz.extraNeeded) + ' of extra salary just to get back to where the cliff left you.');
      } else {
        add('warn', 'A pay rise of ' + gbp(dz.extraNeeded) + ' just to break even', 'Anyone who crosses the cliff needs to reach a salary of ' + gbp(dz.breakEven) + ' before they are better off than at ' + gbp(dz.cliffSalary) + '. Every salary in between leaves them worse off.');
      }
    }

    const best = strat.rows.find((r) => r.id === 'hundred-sacrifice');
    const personal = strat.rows.find((r) => r.id === 'hundred-personal');
    if (best && best.feasible) {
      if (best.change > 1) {
        add('good', 'A pension of ' + fmtPct(best.pct) + '% of salary puts ' + gbp(best.change / perK()) + ' ' + unit() + ' more in your pocket', 'It adds ' + gbp(best.extra) + ' a year to your pension and brings your adjusted net income down to £100,000, restoring the Personal Allowance' + (hh.kids && hh.childcare.gross > 0 ? ' and your childcare help' : '') + '.');
      } else {
        add('good', 'A pension of ' + fmtPct(best.pct) + '% of salary costs you just ' + gbp(best.cost / perK()) + ' ' + unit() + ' in cash', 'That is ' + Math.round(best.costPerPound * 100) + 'p of take home pay for every £1 that lands in your pension, with salary sacrifice' + (personal ? ' (' + Math.round(personal.costPerPound * 100) + 'p with a personal pension or net pay arrangement)' : '') + '.');
      }
    } else if (best && !best.feasible) {
      add('warn', 'The pension route is capped', 'Bringing your income to £100,000 would need about ' + fmtPct(best.pct) + '% of salary, more than the annual allowance or your pay allows. Gift Aid donations or carrying forward unused allowance may help.');
    }

    const flat = Object.assign({}, s, { pensionPct: 0, gift: 0, employerPct: 0 });
    const total = s.salary + (s.partnerOn ? s.partnerSalary : 0);
    if (total > 0) {
      const now = T.calcHousehold(flat).spendable;
      const split = T.calcHousehold(Object.assign({}, flat, { partnerOn: true, salary: total / 2, partnerSalary: total / 2 })).spendable;
      if (split - now > 500) {
        add('warn', 'Same household pay, different tax: ' + gbp((split - now) / perK()) + ' ' + unit(), 'If your household earned the same ' + gbp(total) + ' as two people on ' + gbp(total / 2) + ' each, you would keep ' + gbp(split - now) + ' more a year (before any pension planning). The £100,000 rules test individuals, not households.');
      }
    }

    if (hh.kids && hh.hicbcPct > 0 && hh.hicbcPct < 100) {
      add('warn', 'Child Benefit is ' + hh.hicbcPct + '% clawed back', 'The High Income Child Benefit Charge takes ' + gbp(hh.hicbc) + ' of your ' + gbp(hh.benefitGross) + ' Child Benefit. It reaches 100% at £80,000.');
    } else if (hh.kids && hh.hicbcPct === 100) {
      add('info', 'Child Benefit is fully clawed back', 'The charge equals all of your ' + gbp(hh.benefitGross) + ' Child Benefit. You can choose not to receive it, but keep registering to protect National Insurance credits.');
    }
    if (hh.partner && hh.partner.ani > R.childcare.incomeLimit && hh.you.ani <= R.childcare.incomeLimit && hh.kids && hh.childcare.gross > 0) {
      add('bad', 'Your partner has tripped the cliff for you', 'Tax Free Childcare and funded hours are lost if either parent is over £100,000, even though your own income is under the line.');
    }
    if (hh.kids && hh.childcare.gross > 0 && !hh.earnsEnough) {
      add('warn', 'Childcare schemes need both parents working', 'Each parent needs to earn about £10,575 a year. Tax Free Childcare and the 30 funded hours are not counted for this household.');
    }
    if ((s.plan !== 'none' || s.postgrad) && s.pensionPct > 0 && s.method === 'personal') {
      add('info', 'Your student loan ignores personal pension payments', 'Student loan repayments are based on pay, not adjusted net income. Salary sacrifice reduces them, a personal pension or net pay arrangement does not.');
    }
    if (s.region === 'scotland' && zone === 'trap') {
      add('info', 'Scotland makes the hump taller', 'The Scottish advanced rate of 45% is withdrawn with the allowance, giving 67.5% before National Insurance and 69.5% with it. Funded hours for 3 and 4 year olds have no income test, so the childcare cliff is smaller.');
    }
    if (hh.pensionCapped) {
      add('warn', 'Pension capped by the annual allowance', 'Your contribution is limited to ' + gbp(hh.pensionCap) + ' once employer money of ' + gbp(hh.employerAmount) + ' is counted against the £60,000 annual allowance.');
    }
    return out;
  }

  const insightHtml = (list) => list.map((i) => '<div class="insight ' + i.kind + '"><div><h4>' + i.title + '</h4><p>' + i.text + '</p></div></div>').join('');

  function renderDashboard(a) {
    const k = perK();
    $('barTakeHome').textContent = gbp(a.hh.spendable / k) + ' ' + unit();
    $('barMarginal').textContent = pctText(a.next.rate);
    $('barMarginal').style.color = a.next.rate > 0.55 ? 'var(--accent)' : '';
    const sc = statusCopy(a);
    $('statusBanner').className = 'status z-' + sc.zone;
    $('statusBanner').innerHTML = '<h3>' + sc.title + '</h3><p>' + sc.body + '</p><div class="tags">' + sc.tags + '</div>';
    $('kpis').innerHTML = kpiHtml(a);

    $('rangeSeg').hidden = view === 'pension';
    $$('.tabs button').forEach((b) => {
      const on = b.dataset.view === view;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $('chartPanel').setAttribute('aria-labelledby', 'tab-' + view);
    $$('#rangeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.rangeMode === range ? 'true' : 'false'));
    const built = view === 'income' ? buildIncome(a) : view === 'marginal' ? buildMarginal(a) : buildPension(a);
    mountChart(charts.dash, built, { legend: 'chartLegend', title: 'chartTitle', sub: 'chartSub' });

    $('insights').innerHTML = insightHtml(insightsList(a).slice(0, 8));
    renderBreakdown(a);
    renderNext();
    renderStrategies();
    renderSamples(a);
  }

  function renderBreakdown(a) {
    const hh = a.hh;
    const y = hh.you;
    const k = perK();
    const parts = [
      { label: 'Income tax', v: y.tax, color: 'var(--amber)' },
      { label: 'National Insurance', v: y.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: y.studentLoan, color: 'var(--muted)' },
      { label: 'Pension and Gift Aid', v: y.sacrifice + y.personal + y.giftGross, color: 'var(--green)' },
      { label: 'Take home pay', v: y.takeHome, color: 'var(--ink)' },
    ].filter((x) => x.v > 0.5);
    const total = parts.reduce((p, x) => p + x.v, 0) || 1;
    parts.forEach((x) => (x.text = gbp(x.v / k) + ' (' + Math.round((x.v / total) * 100) + '%)'));
    const rows = [];
    const row = (label, v, kind) => {
      if (kind !== 'always' && Math.abs(v) < 0.5) return;
      rows.push('<tr class="' + (kind === 'total' ? 'total' : '') + '"><th scope="row">' + label + '</th><td class="num-col">' + gbp(v) + '</td><td class="num-col">' + gbp(v / 12) + '</td></tr>');
    };
    row('Your gross salary', y.salary, 'always');
    row('Less: salary sacrificed into pension', y.sacrifice);
    row('Less: income tax', y.tax);
    row('Less: National Insurance', y.ni);
    row('Less: student loan', y.studentLoan);
    row('Less: pension paid from take home', y.personal);
    row('Less: Gift Aid donations (grossed up)', y.giftGross);
    row('Your take home pay', y.takeHome, 'total');
    if (hh.partner) row('Add: partner take home pay', hh.partner.takeHome);
    row('Add: Child Benefit', hh.benefitGross);
    row('Less: High Income Child Benefit Charge', hh.hicbc);
    row('Less: childcare at full price', hh.childcare.gross);
    row('Add: value of funded hours', hh.childcare.funded);
    row('Add: Tax Free Childcare top up', hh.childcare.tfc);
    row('Household money in pocket', hh.spendable, 'total');
    $('breakdown').innerHTML =
      stackHtml(parts, total, 'Breakdown of your gross salary') +
      '<div class="table-scroll"><table><thead><tr><th>Item</th><th class="num-col">A year</th><th class="num-col">A month</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function renderNext() {
    const n = T.nextSlice(state, slice);
    const lost = n.delta - n.retained;
    const total = Math.max(n.delta, lost + n.pension) || 1;
    const parts = [
      { label: 'Income tax', v: n.tax, color: 'var(--amber)' },
      { label: 'National Insurance', v: n.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: n.studentLoan, color: 'var(--muted)' },
      { label: 'Child Benefit charge', v: n.hicbc, color: '#a05a00' },
      { label: 'Childcare help lost', v: n.childcare, color: '#7a0f1e' },
      { label: 'Into your pension', v: n.pension, color: 'var(--green)' },
      { label: 'You keep in cash', v: Math.max(0, n.kept), color: 'var(--ink)' },
    ].filter((x) => x.v > 0.5);
    parts.forEach((x) => (x.text = gbp(x.v)));
    const headline =
      n.retained >= 0
        ? 'Of an extra ' + gbp(slice) + ' you keep <b>' + gbp(n.retained) + '</b>, an effective tax rate of <b>' + pctText(n.rate) + '</b>.'
        : 'An extra ' + gbp(slice) + ' of salary leaves you <b class="neg">' + gbp(-n.retained) + ' worse off</b>.';
    $('nextSlice').innerHTML =
      '<div class="seg" role="group" aria-label="Size of pay rise" style="margin-bottom:12px">' +
      [100, 1000, 10000].map((v) => '<button type="button" data-slice="' + v + '" aria-pressed="' + (v === slice) + '">' + gbp(v) + ' more</button>').join('') +
      '</div><p class="slice-total">' + headline + '</p>' + stackHtml(parts, total, 'Split of the next pay rise');
    $$('#nextSlice [data-slice]').forEach((b) =>
      b.addEventListener('click', () => {
        slice = +b.dataset.slice;
        renderNext();
      })
    );
  }

  function renderStrategies() {
    const s = state;
    const { base, rows } = T.strategies(s);
    const k = perK();
    if (!rows.length) {
      const test = T.calcHousehold(Object.assign({}, s, { pensionPct: s.pensionPct + (1000 / Math.max(1, s.salary)) * 100 }));
      const per = (base.spendable - test.spendable) / Math.max(1, test.pensionSaved - base.pensionSaved);
      $('strategies').innerHTML =
        '<p>Your adjusted net income of <b>' + gbp(base.you.ani) + '</b> is at or below the £100,000 threshold, so there is nothing to escape. Extra pension payments here currently cost you about ' + Math.round(per * 100) + 'p of cash per £1 invested.</p>';
      return;
    }
    const body = rows
      .map((r, i) => {
        const group = i === 0 || rows[i - 1].target !== r.target ? '<tr><th colspan="5" class="small">' + r.targetLabel + ' of adjusted net income</th></tr>' : '';
        const gain = r.change > 0.5;
        const what = r.pct == null ? 'Donate ' + gbp(r.extra * 0.8) : fmtPct(r.pct) + '% of salary';
        const cell = !r.feasible
          ? '<td colspan="2" class="small">Not possible within the annual allowance or your pay</td>'
          : '<td class="num-col ' + (gain ? 'pos' : 'neg') + '">' + arrow(r.change / k) + '</td><td class="num-col">' + (gain ? '<span class="badge ok">You gain cash</span>' : Math.round(r.costPerPound * 100) + 'p') + '</td>';
        const apply = r.feasible ? '<td class="num-col"><button type="button" class="btn small" data-apply="' + r.id + '">Apply</button></td>' : '<td></td>';
        return group + '<tr><th scope="row">' + r.label + '<div class="small">' + what + ', ' + gbp(r.extra) + ' extra a year</div></th><td class="num-col">' + gbp(r.extra) + '</td>' + cell + apply + '</tr>';
      })
      .join('');
    $('strategies').innerHTML =
      '<div class="table-scroll"><table><thead><tr><th>Route</th><th class="num-col">Gross amount</th><th class="num-col">Your cash ' + unit() + '</th><th class="num-col">Cost per £1</th><th></th></tr></thead><tbody>' + body +
      '</tbody></table></div><p class="small">Pension routes add the gross amount to your pension. With a Gift Aid donation the charity receives the gross amount and you keep nothing, so it is only worth it if you were already planning to give.</p>';
    $$('#strategies [data-apply]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = rows.find((x) => x.id === b.dataset.apply);
        if (r.pct == null) setState({ gift: s.gift + r.extra / R.giftAidGrossUp });
        else setState({ pensionPct: r.pct, method: r.id.endsWith('sacrifice') ? 'sacrifice' : 'personal' });
      })
    );
  }

  function renderSamples(a) {
    const k = perK();
    const anis = [60000, 80000, 90000, 99999, 100000, 100001, 105000, 110000, 120000, 125140, 130000, 150000, 200000];
    const set = new Set(anis.map((x) => Math.round(T.salaryAtANI(state, x))));
    set.add(Math.round(state.salary));
    const salaries = Array.from(set).sort((p, q) => p - q);
    const body = salaries
      .map((sal) => {
        const h = T.calcHousehold(Object.assign({}, state, { salary: sal }));
        const diff = h.spendable - a.dz.reference;
        const inTrap = h.you.ani > R.taperStart && h.you.ani <= R.taperEnd;
        const cur = sal === Math.round(state.salary);
        const help = h.benefitGross - h.hicbc + h.childcare.funded + h.childcare.tfc;
        return (
          '<tr class="clickable ' + (inTrap ? 'row-trap ' : '') + (cur ? 'row-current' : '') + '" data-salary="' + sal + '" tabindex="0">' +
          '<th scope="row">' + gbp(sal) + (cur ? ' <span class="small">(you)</span>' : '') + '</th>' +
          '<td class="num-col">' + gbp(h.you.ani) + '</td>' +
          '<td class="num-col">' + gbp(h.you.tax / k) + '</td>' +
          '<td class="num-col">' + gbp(h.you.ni / k) + '</td>' +
          '<td class="num-col">' + gbp(h.you.studentLoan / k) + '</td>' +
          '<td class="num-col">' + gbp(help / k) + '</td>' +
          '<td class="num-col"><b>' + gbp(h.spendable / k) + '</b></td>' +
          '<td class="num-col ' + cls(diff) + '">' + arrow(diff / k) + '</td></tr>'
        );
      })
      .join('');
    $('samples').innerHTML =
      '<table><thead><tr><th>Gross salary</th><th class="num-col">Adjusted net income</th><th class="num-col">Income tax</th><th class="num-col">National Insurance</th><th class="num-col">Student loan</th><th class="num-col">Child Benefit and childcare help</th><th class="num-col">Money in pocket</th><th class="num-col">Versus the cliff edge</th></tr></thead><tbody>' + body +
      '</tbody></table><p class="small">All figures ' + unit() + '. "Versus the cliff edge" compares each row with the salary where adjusted net income is exactly £100,000.</p>';
    $$('#samples tr[data-salary]').forEach((tr) => {
      const go = () => setState({ salary: +tr.dataset.salary });
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });
  }

  /* ---------- Children ---------- */
  function ageRowHtml(c, i) {
    const opts = T.BANDS.map((b) => '<option value="' + b + '"' + (b === c.band ? ' selected' : '') + '>' + T.BAND_INFO[b].label + '</option>').join('');
    return '<div class="child-row" data-i="' + i + '"><div class="cr-top"><label for="cb' + i + '">Child ' + (i + 1) + '</label><select id="cb' + i + '" data-f="band">' + opts + '</select><button type="button" class="remove" aria-label="Remove child ' + (i + 1) + '" data-f="remove">×</button></div></div>';
  }

  function costRowHtml(c, i) {
    if (c.band === 'teen') return '';
    return '<div class="child-row" data-i="' + i + '"><div class="cr-top"><label>Child ' + (i + 1) + ', ' + T.BAND_INFO[c.band].label.toLowerCase() + '</label></div>' +
      '<div class="cr-grid"><div><label for="cm' + i + '">Cost a month</label><div class="money-input"><span class="pound" aria-hidden="true">£</span><input id="cm' + i + '" data-f="monthly" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"></div><span class="est" data-f="tag"></span></div>' +
      '<div><label for="ch' + i + '">Hours a week</label><div class="money-input"><input id="ch' + i + '" data-f="hours" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"></div></div></div>' +
      '<p class="hint"><span data-f="note"></span> <button type="button" class="linklike" data-f="reset" hidden>Use the estimate</button></p></div>';
  }

  function renderChildren() {
    $('ageList').innerHTML = state.children.length ? state.children.map(ageRowHtml).join('') : '<p class="empty-note">No children added yet. Tap a button above.</p>';
    $('costList').innerHTML = state.children.map(costRowHtml).join('');
    $$('[data-add-band]').forEach((b) => (b.disabled = state.children.length >= 4));
    syncChildren();
  }

  function syncChildren() {
    $$('#costList .child-row').forEach((row) => {
      const i = +row.dataset.i;
      const c = state.children[i];
      if (!c || c.band === 'teen') return;
      const est = T.estimateMonthly(c.hours, state.weeks);
      const monthly = c.monthly != null ? c.monthly : est;
      const mInput = row.querySelector('[data-f=monthly]');
      const hInput = row.querySelector('[data-f=hours]');
      if (document.activeElement !== mInput) mInput.value = nf0.format(monthly);
      if (document.activeElement !== hInput) hInput.value = String(c.hours);
      row.querySelector('[data-f=tag]').textContent = c.monthly != null ? 'Your figure' : 'Estimate';
      const hourly = c.hours > 0 && state.weeks > 0 ? (monthly * 12) / (c.hours * state.weeks) : 0;
      row.querySelector('[data-f=note]').textContent =
        c.monthly != null
          ? 'Your own figure, about £' + hourly.toFixed(2) + ' an hour.'
          : 'Not sure? We estimate ' + gbp(est) + ' a month from ' + c.hours + ' hours at about £' + R.childcare.defaultHourly.toFixed(2) + ' an hour. Type your own bill to replace it.';
      row.querySelector('[data-f=reset]').hidden = c.monthly == null;
    });
  }

  function wireChildren() {
    const edit = (i, patch) => {
      const kids = state.children.map((c) => Object.assign({}, c));
      Object.assign(kids[i], patch);
      setState({ children: kids });
    };
    const list = $('costList');
    list.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const row = e.target.closest('.child-row');
      if (!f || !row) return;
      const i = +row.dataset.i;
      if (f === 'monthly') edit(i, { monthly: e.target.value.trim() === '' ? null : parseNum(e.target.value) });
      if (f === 'hours') edit(i, { hours: parseNum(e.target.value) });
    });
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.child-row');
      if (row && e.target.dataset.f === 'reset') edit(+row.dataset.i, { monthly: null });
    });
    const ages = $('ageList');
    ages.addEventListener('change', (e) => {
      if (e.target.dataset.f !== 'band') return;
      const i = +e.target.closest('.child-row').dataset.i;
      edit(i, { band: e.target.value, hours: T.BAND_INFO[e.target.value].hours, monthly: null });
      renderChildren();
    });
    ages.addEventListener('click', (e) => {
      const row = e.target.closest('.child-row');
      if (row && e.target.dataset.f === 'remove') {
        setState({ children: state.children.filter((_, j) => j !== +row.dataset.i) });
        renderChildren();
      }
    });
    $$('[data-add-band]').forEach((b) =>
      b.addEventListener('click', () => {
        const band = b.dataset.addBand;
        setState({ children: state.children.concat([{ band, hours: T.BAND_INFO[band].hours, monthly: null }]) });
        renderChildren();
      })
    );
  }

  /* ---------- Generic field bindings ---------- */
  const rangeHtml = () =>
    '<div class="range-wrap"><div class="range-track" aria-hidden="true"></div>' +
    '<span class="range-mark m100" aria-hidden="true"><i></i><em>£100,000</em></span>' +
    '<span class="range-mark m125" aria-hidden="true"><i></i><em>£125,140</em></span>' +
    '<input data-range="salary" type="range" min="0" max="250000" step="500" aria-label="Gross salary slider"></div>';

  function bindFields() {
    $$('[data-mount="salary-range"]').forEach((el) => (el.innerHTML = rangeHtml()));
    $$('[data-money]').forEach((el) => {
      const key = el.dataset.money;
      el.addEventListener('input', () => setState({ [key]: parseNum(el.value) }));
      el.addEventListener('blur', () => (el.value = EMPTY_WHEN_ZERO.has(key) && !state[key] ? '' : nf0.format(state[key])));
    });
    $$('[data-pct]').forEach((el) => {
      const key = el.dataset.pct;
      el.addEventListener('input', () => {
        const raw = el.value.trim();
        setState({ [key]: key === 'loanRate' && raw === '' ? null : Math.min(key === 'loanRate' ? 20 : 100, parseNum(raw)) });
      });
      el.addEventListener('blur', () => (el.value = state[key] == null ? '' : fmtPct(state[key])));
    });
    $$('[data-number]').forEach((el) => {
      const key = el.dataset.number;
      el.addEventListener('input', () => setState({ [key]: parseNum(el.value) }));
      el.addEventListener('blur', () => (el.value = String(state[key])));
    });
    $$('[data-range]').forEach((el) => el.addEventListener('input', () => setState({ [el.dataset.range]: +el.value })));
    $$('[data-select]').forEach((el) => el.addEventListener('change', () => setState({ [el.dataset.select]: el.value })));
    $$('[data-check]').forEach((el) => el.addEventListener('change', () => setState({ [el.dataset.check]: el.checked })));
    $$('[data-choice]').forEach((el) => el.addEventListener('click', () => setState({ [el.dataset.choice]: el.dataset.value })));
  }

  function setField(el, text) {
    if (document.activeElement !== el) el.value = text;
  }

  function syncFields(a) {
    $$('[data-money]').forEach((el) => {
      const key = el.dataset.money;
      setField(el, EMPTY_WHEN_ZERO.has(key) && !state[key] ? '' : nf0.format(state[key]));
    });
    $$('[data-pct]').forEach((el) => {
      const key = el.dataset.pct;
      if (key === 'loanRate') el.placeholder = fmtPct(T.loanDefaultRate(state.plan));
      setField(el, state[key] == null ? '' : fmtPct(state[key]));
    });
    $$('[data-number]').forEach((el) => setField(el, String(state[el.dataset.number])));
    $$('[data-range]').forEach((el) => (el.value = Math.min(+el.max, state[el.dataset.range])));
    $$('[data-select]').forEach((el) => (el.value = state[el.dataset.select]));
    $$('[data-check]').forEach((el) => (el.checked = !!state[el.dataset.check]));
    $$('[data-choice]').forEach((el) => el.setAttribute('aria-pressed', state[el.dataset.choice] === el.dataset.value ? 'true' : 'false'));
    $$('input[name=period]').forEach((r) => (r.checked = r.value === period));
    $$('[data-toggle]').forEach((b) => b.setAttribute('aria-pressed', openPanels.has(b.dataset.toggle) ? 'true' : 'false'));
    $$('[data-panel]').forEach((p) => (p.hidden = !openPanels.has(p.dataset.panel)));
    $$('[data-kids]').forEach((b) => b.setAttribute('aria-checked', kidsChoice === b.dataset.kids ? 'true' : 'false'));

    const ra = Math.min(1, a.x100 / 250000);
    const rb = Math.min(1, a.x125 / 250000);
    $$('.range-wrap').forEach((w) => {
      w.style.setProperty('--a', ra);
      w.style.setProperty('--b', rb);
    });
    $('regionHint').textContent = {
      england: 'Income tax at 20%, 40% and 45%. The 30 funded hours for working parents are modelled.',
      scotland: 'Six Scottish tax bands with a 48% top rate. Funded hours for 3 and 4 year olds have no income test.',
      wales_ni: 'Income tax as in England. Funded childcare in Wales and Northern Ireland differs and is not modelled.',
    }[state.region];
    $('methodHint').textContent =
      state.method === 'sacrifice'
        ? 'Reduces your salary before tax, National Insurance and student loan. The most efficient route.'
        : 'Reduces income tax only. National Insurance and student loan stay on full pay. Higher rate relief and the restored allowance are claimed afterwards.';
    $('pctOf').textContent = 'of ' + gbp(state.salary) + ' is ' + gbp(a.hh.pensionSaved) + ' a year';
    $('barPensionText').textContent = fmtPct(state.pensionPct) + '%';
  }

  /* ---------- Flow control ---------- */
  const hasCareKids = () => state.children.some((c) => c.band !== 'teen');

  function activeScreens() {
    const list = ['salary', 'kids'];
    if (kidsChoice === 'yes') {
      list.push('ages');
      if (hasCareKids()) list.push('childcare');
    }
    list.push('pension', 'extras');
    return list;
  }

  function canProceed(s) {
    if (s === 'salary') return state.salary > 0;
    if (s === 'kids') return kidsChoice !== null;
    if (s === 'ages') return state.children.length > 0;
    return true;
  }

  function nextAfter(cur) {
    if (editing) {
      if (cur === 'kids' && kidsChoice === 'yes' && state.children.length === 0) return 'ages';
      if (cur === 'ages' && hasCareKids()) return 'childcare';
      return 'results';
    }
    const list = activeScreens();
    const i = list.indexOf(cur);
    return i >= 0 && i < list.length - 1 ? list[i + 1] : 'results';
  }

  function bringIntoView(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.4) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function focusQuestion() {
    const t = document.querySelector('.screen[data-screen="' + screen + '"] .q');
    if (t) t.focus({ preventScroll: true });
  }

  function go(target) {
    if (target === 'results') {
      showResults();
      return;
    }
    trail.push(screen);
    screen = target;
    applyMode();
    render();
    bringIntoView($('flow'));
    focusQuestion();
  }

  function goBack() {
    if (trail.length) {
      screen = trail.pop();
      applyMode();
      render();
      bringIntoView($('flow'));
      focusQuestion();
    } else if (editing) {
      showResults();
    }
  }

  function showResults() {
    mode = 'results';
    editing = false;
    trail = [];
    applyMode();
    render();
    bringIntoView($('answerRow'));
  }

  function showData() {
    mode = 'data';
    applyMode();
    render();
    bringIntoView($('answerRow'));
  }

  function editScreen(name) {
    mode = 'flow';
    editing = true;
    trail = [];
    screen = name === 'kids' && kidsChoice === 'yes' && state.children.length ? 'ages' : name;
    applyMode();
    render();
    bringIntoView($('flow'));
    focusQuestion();
  }

  function applyMode() {
    const f = mode === 'flow';
    $('flow').hidden = !f;
    document.querySelector('.examples').hidden = !f;
    $('results').hidden = mode !== 'results';
    $('dashboard').hidden = mode !== 'data';
    $('answerRow').hidden = f;
    $$('.screen').forEach((el) => (el.hidden = !f || el.dataset.screen !== screen));
  }

  function updateFlowChrome() {
    if (mode !== 'flow') return;
    const list = activeScreens();
    const idx = Math.max(0, list.indexOf(screen));
    const pct = Math.round(((idx + 1) / (list.length + 1)) * 100);
    $('flowBarFill').style.width = pct + '%';
    $('flowProgress').setAttribute('aria-valuenow', String(pct));
    $('flowCount').textContent = editing ? 'Editing an answer' : kidsChoice === null ? 'Question ' + (idx + 1) : 'Question ' + (idx + 1) + ' of ' + list.length;
    $('flowBack').disabled = !trail.length && !editing;
    const ok = canProceed(screen);
    const next = $('flowNext');
    next.disabled = !ok;
    const last = nextAfter(screen) === 'results';
    next.textContent = editing && last ? 'Update my results' : last ? 'See my results' : 'Next';
    $('flowHint').textContent = ok ? '' : screen === 'kids' ? 'Choose one to continue.' : screen === 'ages' ? 'Add at least one child to continue, or go back and choose no children.' : 'Enter your salary to continue.';
  }

  function renderScreen(a) {
    if (screen === 'salary') insSalary(a);
    else if (screen === 'kids') insKids();
    else if (screen === 'ages') insAges(a);
    else if (screen === 'childcare') insChildcare(a);
    else if (screen === 'pension') insPension(a);
    else insExtras(a);
  }

  function renderAnswerRow() {
    const kids = state.children.length;
    const chips = [
      ['salary', 'Salary ' + gbp(state.salary)],
      ['kids', kids ? plural(kids, 'child', 'children') : 'No children'],
      ['pension', 'Pension ' + fmtPct(state.pensionPct) + '%'],
      ['extras', 'More details'],
    ];
    $('answerRow').innerHTML =
      '<span class="presets-label">Your answers</span>' +
      chips.map((c) => '<button type="button" class="chip" data-edit="' + c[0] + '">' + c[1] + '</button>').join('') +
      (mode === 'results' ? '<button type="button" class="chip ghost-chip" data-view-data>See all the data</button>' : '');
  }

  function renderLive(a) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      $('live').textContent = 'Salary ' + gbp(state.salary) + '. Household money in pocket ' + gbp(a.hh.spendable / perK()) + ' ' + unit() + '. Tax on your next £1,000 is ' + pctText(a.next.rate) + '.';
    }, 800);
  }

  function render() {
    const a = analyse(state);
    syncFields(a);
    syncChildren();
    renderAnswerRow();
    if (mode === 'flow') renderScreen(a);
    else if (mode === 'results') renderResults(a);
    else renderDashboard(a);
    updateFlowChrome();
    scheduleUrl();
    renderLive(a);
  }

  /* ---------- Wiring ---------- */
  function resetAll() {
    state = freshState();
    kidsChoice = null;
    openPanels.clear();
    period = 'month';
    view = 'income';
    range = 'focus';
    editing = false;
    trail = [];
    screen = 'salary';
    mode = 'flow';
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      /* ignore */
    }
    renderChildren();
    applyMode();
    render();
    bringIntoView($('flow'));
    focusQuestion();
  }

  function wire() {
    bindFields();
    wireChildren();

    $('flowNext').addEventListener('click', () => {
      if (canProceed(screen)) go(nextAfter(screen));
    });
    $('flowBack').addEventListener('click', goBack);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && mode === 'flow' && e.target.matches('.screen input[type=text]') && canProceed(screen)) {
        e.preventDefault();
        go(nextAfter(screen));
      }
    });

    $$('[data-kids]').forEach((b) =>
      b.addEventListener('click', () => {
        kidsChoice = b.dataset.kids;
        if (kidsChoice === 'no') setState({ children: [] });
        else render();
        renderChildren();
      })
    );

    $$('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.toggle;
        if (openPanels.has(key)) {
          openPanels.delete(key);
          const reset = {
            loan: { plan: 'none', postgrad: false, loanBalance: 0, loanRate: null },
            partner: { partnerOn: false },
            region: { region: 'england' },
            gift: { gift: 0 },
            method: { method: 'sacrifice' },
          }[key];
          setState(reset);
        } else {
          openPanels.add(key);
          if (key === 'partner') setState({ partnerOn: true });
          else render();
        }
      })
    );

    $$('[data-set-salary]').forEach((b) => b.addEventListener('click', () => setState({ salary: +b.dataset.setSalary })));
    $$('[data-set-pct]').forEach((b) => b.addEventListener('click', () => setState({ pensionPct: +b.dataset.setPct })));
    $$('[data-jump]').forEach((b) =>
      b.addEventListener('click', () => {
        const at = T.salaryAtANI(state, R.taperStart);
        setState({ salary: b.dataset.jump === 'below' ? Math.ceil(at) - 1 : Math.floor(at) + 1 });
      })
    );
    $$('.nudge').forEach((b) => b.addEventListener('click', () => setState({ salary: Math.max(0, state.salary + +b.dataset.nudge) })));

    document.addEventListener('click', (e) => {
      const apply = e.target.closest('[data-apply-pct]');
      if (apply) setState({ pensionPct: +apply.dataset.applyPct });
      const tip = e.target.closest('[data-tip]');
      if (tip && tips[+tip.dataset.tip] && tips[+tip.dataset.tip].action) setState(tips[+tip.dataset.tip].action.set);
      const edit = e.target.closest('[data-edit]');
      if (edit) editScreen(edit.dataset.edit);
      if (e.target.closest('[data-view-data]')) showData();
    });

    $$('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        state = T.normalise(Object.assign(T.defaultState(), PRESETS[b.dataset.preset]));
        kidsChoice = state.children.length ? 'yes' : 'no';
        syncPanelsFromState();
        renderChildren();
        mode = 'results';
        editing = false;
        trail = [];
        applyMode();
        render();
        $('explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );

    $('showData').addEventListener('click', showData);
    $('backToResults').addEventListener('click', showResults);
    $('resetAll').addEventListener('click', resetAll);

    $('shareLink').addEventListener('click', async () => {
      const base = window.location.protocol === 'file:' ? window.location.href.split('?')[0] : window.location.origin + window.location.pathname;
      const url = base + '?' + buildQuery();
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch (e) {
        ok = false;
      }
      $('shareStatus').textContent = ok ? 'Link copied. Anyone opening it sees this exact scenario.' : 'Copy this link: ' + url;
    });

    $$('input[name=period]').forEach((r) =>
      r.addEventListener('change', () => {
        period = r.value;
        render();
      })
    );
    const tabs = $$('.tabs button');
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => {
        view = b.dataset.view;
        render();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        view = next.dataset.view;
        render();
      });
    });
    $$('#rangeSeg button').forEach((b) =>
      b.addEventListener('click', () => {
        range = b.dataset.rangeMode;
        render();
      })
    );

    const widths = new Map();
    const ro = new ResizeObserver((entries) => {
      entries.forEach((en) => {
        const w = Math.round(en.contentRect.width);
        const key = en.target.id;
        if (w && widths.get(key) !== w) {
          widths.set(key, w);
          const inst = { chartHost: charts.dash, chartHostP: charts.p, chartHostR: charts.r }[key];
          if (inst) inst.resize();
        }
      });
    });
    ['chartHost', 'chartHostP', 'chartHostR'].forEach((id) => ro.observe($(id)));
  }

  function watchStickyBar() {
    if (!('IntersectionObserver' in window)) return;
    const bar = $('salaryBar');
    const io = new IntersectionObserver(
      (entries) => bar.classList.toggle('stuck', !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0),
      { rootMargin: '-60px 0px 0px 0px' }
    );
    io.observe($('sbSentinel'));
  }

  function init() {
    charts.dash = C.createChart($('chartHost'));
    charts.p = C.createChart($('chartHostP'));
    charts.r = C.createChart($('chartHostR'));
    readUrl();
    wire();
    watchStickyBar();
    $('heroCliff').textContent = gbp(T.deadZone(T.normalise(T.defaultState())).drop);
    renderChildren();
    applyMode();
    render();
  }

  init();
})();
