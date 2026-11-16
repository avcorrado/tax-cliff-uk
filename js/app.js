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

  /* ---------- State ---------- */
  const KIDS = [{ band: 'toddler', hours: 40 }, { band: 'preschool', hours: 40 }];
  const PRESETS = {
    parents: { salary: 101000, children: KIDS },
    escape: { salary: 110000, pensionPct: 9.1, method: 'sacrifice', children: KIDS },
    nokids: { salary: 112000, children: [] },
    plan2: { salary: 112000, plan: 'plan2', children: [] },
    scotland: { salary: 110000, region: 'scotland', children: [{ band: 'preschool', hours: 40 }] },
    couple: {
      salary: 105000,
      partnerOn: true,
      partnerSalary: 40000,
      children: [{ band: 'toddler', hours: 40 }, { band: 'school', hours: 15 }],
    },
    both: { salary: 99000, partnerOn: true, partnerSalary: 99000, children: KIDS },
  };
  const STEP_LABELS = ['', 'Your pay', 'Your tax', 'Family', 'The cliff', 'Pension', 'Summary'];

  let state = T.normalise(T.defaultState());
  let mode = 'steps';
  let step = 1;
  let view = 'income';
  let range = 'focus';
  let period = 'month';
  let slice = 1000;
  let fixNote = '';
  const charts = {};
  let urlTimer = null;
  let liveTimer = null;

  const perK = () => (period === 'month' ? 12 : 1);
  const unit = () => (period === 'month' ? 'a month' : 'a year');

  function setState(patch) {
    fixNote = '';
    state = T.normalise(Object.assign({}, state, patch));
    render();
  }

  /* ---------- URL ---------- */
  function readUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      if (![...p.keys()].length) return;
      const next = {};
      if (p.has('s')) next.salary = +p.get('s');
      if (p.has('r')) next.region = p.get('r');
      if (p.has('m')) next.method = p.get('m');
      if (p.has('p')) next.pensionPct = +p.get('p');
      if (p.has('e')) next.employerPct = +p.get('e');
      if (p.has('g')) next.gift = +p.get('g');
      if (p.has('l')) next.plan = p.get('l');
      if (p.has('pg')) next.postgrad = p.get('pg') === '1';
      if (p.has('k')) {
        next.children = p
          .get('k')
          .split('_')
          .filter(Boolean)
          .map((c) => {
            const [band, hours, monthly] = c.split('.');
            return { band, hours: +hours, monthly: monthly === undefined ? null : +monthly };
          });
      }
      if (p.has('ps')) {
        next.partnerOn = true;
        next.partnerSalary = +p.get('ps');
      }
      if (p.has('wk')) next.weeks = +p.get('wk');
      state = T.normalise(next);
      if (p.get('per') === 'year') period = 'year';
      if (['income', 'marginal', 'pension'].includes(p.get('v'))) view = p.get('v');
      if (p.get('z') === 'full') range = 'full';
      if (p.get('d') === '1') mode = 'done';
      else if (p.has('st')) step = Math.min(6, Math.max(1, +p.get('st') || 1));
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
    p.set('k', state.children.map((c) => c.band + '.' + c.hours + (c.monthly != null ? '.' + Math.round(c.monthly) : '')).join('_'));
    if (state.partnerOn) p.set('ps', Math.round(state.partnerSalary));
    if (state.weeks !== d.weeks) p.set('wk', state.weeks);
    if (period !== 'month') p.set('per', period);
    if (view !== 'income') p.set('v', view);
    if (range !== 'focus') p.set('z', range);
    if (mode === 'done') p.set('d', '1');
    else if (step > 1) p.set('st', step);
    return p.toString();
  }

  function scheduleUrl() {
    clearTimeout(urlTimer);
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

  function legendHtml(items) {
    return items
      .map((i) =>
        i.box
          ? '<li><span class="sw box" style="background:' + i.color + '"></span>' + i.label + '</li>'
          : '<li><span class="sw' + (i.dash ? ' dash' : '') + '" style="border-color:' + i.color + '"></span>' + i.label + '</li>'
      )
      .join('');
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
      range === 'full'
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

  /* ---------- Insights ---------- */
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
        add('good', 'A pension of ' + fmtPct(best.pct) + '% of salary puts ' + gbp(best.change / perK()) + ' ' + unit() + ' more in your pocket', 'It adds ' + gbp(best.extra) + ' a year to your pension and brings your adjusted net income down to £100,000, restoring the Personal Allowance' + (hh.kids && hh.childcare.gross > 0 ? ' and your childcare help' : '') + '. Open the pension step to try it.');
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

  /* ---------- Guided step visuals ---------- */
  function viz1(a) {
    const sc = statusCopy(a);
    const hh = a.hh;
    const max = Math.min(400000, Math.max(150000, Math.ceil((Math.max(state.salary, a.x125) + 15000) / 10000) * 10000));
    const pc = (x) => Math.min(100, Math.max(0, (x / max) * 100));
    const seg = (x0, x1, c, label) => (x1 > x0 ? '<span class="seg ' + c + '" style="flex:' + (x1 - x0) + '"><i>' + label + '</i></span>' : '');
    let segs = '';
    if (hh.kids) segs += seg(0, Math.min(a.x60, a.x100), 'ok', 'Normal rates') + seg(Math.min(a.x60, a.x100), a.x100, 'warn', 'Child Benefit clawed back');
    else segs += seg(0, a.x100, 'ok', 'Normal rates');
    segs += seg(a.x100, a.x125, 'trap', '62% zone') + seg(a.x125, max, 'past', 'Past the trap');
    const flip = pc(state.salary) > 80;
    $('viz1').innerHTML =
      '<div class="where z-' + sc.zone + '"><p class="where-kicker">Right now</p><h4>' + sc.title + '</h4><p>' + sc.body + '</p></div>' +
      '<div class="strip"><div class="strip-bar">' + segs + '</div>' +
      '<div class="strip-tick" style="left:' + pc(a.x100) + '%"><span>The cliff</span></div>' +
      '<div class="strip-tick late" style="left:' + pc(a.x125) + '%"><span>Allowance gone</span></div>' +
      '<div class="strip-marker' + (flip ? ' flip' : '') + '" style="left:' + pc(state.salary) + '%"><span>You, ' + gbp(state.salary) + '</span></div></div>' +
      '<div class="tiles">' +
      '<div class="tile"><span class="k">Adjusted net income</span><b>' + gbp(hh.you.ani) + '</b><span class="s">The number HMRC tests against £100,000' + (hh.pensionSaved ? ', after your pension' : '') + '.</span></div>' +
      '<div class="tile' + (hh.you.allowance < R.personalAllowance ? ' bad' : '') + '"><span class="k">Personal Allowance left</span><b>' + gbp(hh.you.allowance) + '</b><span class="s">Out of £12,570 tax free.</span></div>' +
      '<div class="tile' + (a.next.rate > 0.55 ? ' bad' : '') + '"><span class="k">Tax on your next £1,000</span><b>' + pctText(a.next.rate) + '</b><span class="s">You would keep ' + gbp(Math.max(0, a.next.retained)) + '.</span></div></div>';
  }

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

  function viz2(a) {
    const y = a.hh.you;
    const k = perK();
    const parts = [
      { label: 'Income tax', v: y.tax, color: 'var(--amber)' },
      { label: 'National Insurance', v: y.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: y.studentLoan, color: 'var(--muted)' },
      { label: 'Pension and Gift Aid', v: y.sacrifice + y.personal + y.giftGross, color: 'var(--green)' },
      { label: 'Take home pay', v: y.takeHome, color: 'var(--ink)' },
    ].filter((x) => x.v > 0.5).map((x) => Object.assign(x, { text: gbp(x.v / k) + ' (' + Math.round((x.v / y.salary) * 100) + '%)' }));

    const p = penceParts(a, 100);
    const pence = [
      { label: 'Income tax at your normal rate', v: p.plain, color: 'var(--amber)' },
      { label: 'Extra tax because your allowance shrinks', v: p.allowance, color: 'var(--accent)' },
      { label: 'National Insurance', v: p.ni, color: 'var(--blue)' },
      { label: 'Student loan', v: p.loan, color: 'var(--muted)' },
      { label: 'Child Benefit charge', v: p.hicbc, color: '#a05a00' },
      { label: 'Childcare help lost', v: p.childcare, color: '#7a0f1e' },
      { label: 'Into your pension', v: p.pension, color: 'var(--green)' },
    ].filter((x) => Math.abs(x.v) > 0.4);
    const taxTotal = pence.filter((x) => x.label !== 'Into your pension').reduce((q, x) => q + x.v, 0);
    pence.forEach((x) => (x.text = Math.round(x.v) + 'p'));
    pence.push({ label: 'You keep in cash', v: Math.max(0, p.keep), color: 'var(--ink)', text: Math.round(p.keep) + 'p' });

    const meter = Math.round((y.allowance / R.personalAllowance) * 100);
    $('viz2').innerHTML =
      '<div class="viz-block"><h4>Where your ' + gbp(y.salary / k) + ' ' + unit() + ' goes</h4>' + stackHtml(parts, y.salary, 'Where your salary goes') + '</div>' +
      '<div class="viz-block"><h4>Your Personal Allowance</h4><div class="meter inv"><span style="width:' + meter + '%"></span></div>' +
      '<p class="small">' + gbp(y.allowance) + ' of £12,570 left.' + (meter < 100 ? ' You have lost ' + gbp(R.personalAllowance - y.allowance) + ' of it.' : ' You have not started losing it yet.') + '</p></div>' +
      '<div class="viz-block"><h4>Of every extra £1 you earn</h4>' + stackHtml(pence, 100, 'Where an extra pound goes') +
      '<p class="pence-sum">' + (p.keep < 0 ? 'Your next pound would leave you worse off.' : '<b>' + Math.round(taxTotal) + 'p</b> goes in tax and lost benefits. <b>' + Math.round(100 - taxTotal) + 'p</b> stays with you' + (p.pension > 0.5 ? ', some of it in your pension' : '') + '.') + '</p>' +
      (p.allowance > 0.5 ? '<p class="small">Each extra £1 of income removes 50p of your allowance, and that 50p is then taxed at your top rate. That hidden step is the extra ' + Math.round(p.allowance) + 'p.</p>' : '') + '</div>';
  }

  function viz3(a) {
    const hh = a.hh;
    const k = perK();
    if (!hh.kids) {
      $('viz3').innerHTML =
        '<div class="empty-card"><h4>No children added</h4><p>Without children the childcare part of the cliff does not apply to you. The 62% rate between £100,000 and £125,140 still does, and the next step shows exactly how it works.</p><p class="small">Add a child on the left to see Child Benefit and childcare help.</p></div>';
      return;
    }
    const c = hh.childcare;
    const pct = hh.hicbcPct;
    const risk = a.dz.drop > 100 && hh.supportOK ? a.dz.drop : 0;
    const lost = !hh.supportOK && hh.earnsEnough ? a.cliff.childcare : 0;
    const rows = [
      ['Nursery at full price', c.gross, ''],
      ['Funded hours', -c.funded, 'pos'],
      ['Tax Free Childcare top up', -c.tfc, 'pos'],
    ].filter((r) => Math.abs(r[1]) > 0.5);
    $('viz3').innerHTML =
      '<div class="card-grid">' +
      '<div class="mini"><span class="k">Child Benefit</span><b>' + gbp(hh.benefitGross / k) + '</b><span class="s">' + unit() + ' for ' + plural(hh.kids, 'child', 'children') + '</span>' +
      '<div class="meter' + (pct > 0 ? ' low' : '') + '"><span style="width:' + pct + '%"></span></div>' +
      '<p class="small">' + (pct === 0 ? 'You keep all of it. The clawback starts above £60,000.' : pct < 100 ? gbp(hh.hicbc / k) + ' ' + unit() + ' is clawed back (' + pct + '%). It is all gone at £80,000.' : 'All of it is clawed back, which is ' + gbp(hh.hicbc / k) + ' ' + unit() + '.') + '</p></div>' +
      '<div class="mini"><span class="k">Your nursery bill</span><b>' + gbp(c.net / k) + '</b><span class="s">' + unit() + ' after help</span>' +
      (rows.length ? '<table class="mini-table"><tbody>' + rows.map((r) => '<tr><th scope="row">' + r[0] + '</th><td class="num-col ' + r[2] + '">' + (r[1] < 0 ? 'less ' : '') + gbp(r[1] / k) + '</td></tr>').join('') + '</tbody></table>' : '<p class="small">Add nursery hours to see funded hours and Tax Free Childcare.</p>') + '</div>' +
      '<div class="mini ' + (risk || lost ? 'bad' : 'good') + '"><span class="k">' + (lost ? 'Help you have lost' : 'Help at risk at £100,000') + '</span><b>' + (risk || lost ? gbp((risk || lost) / k) : 'Nothing') + '</b><span class="s">' + unit() + '</span>' +
      '<p class="small">' + (risk ? 'Tax Free Childcare and funded hours vanish the moment your income passes £100,000, plus the allowance starts to shrink.' : lost ? 'Either parent over £100,000 removes it for the whole family.' : c.gross > 0 ? 'You will not lose childcare help at this income.' : 'Add nursery hours to see what is at stake.') + '</p></div></div>';
  }

  function viz4(a) {
    const k = perK();
    const dz = a.dz;
    let top = '';
    if (dz.drop > 100) {
      top =
        '<div class="ba"><div class="ba-card"><span class="k">Just below the cliff</span><b>' + gbp(dz.reference / k) + '</b><span class="s">' + unit() + ' in your pocket</span></div>' +
        '<div class="ba-arrow" aria-hidden="true">↓</div>' +
        '<div class="ba-card bad"><span class="k">One pound later</span><b>' + gbp((dz.reference - dz.drop) / k) + '</b><span class="s">' + gbp(dz.drop / k) + ' ' + unit() + ' less</span></div></div>';
    } else {
      const gain = T.spendableAt(state, a.x125) + T.calcHousehold(Object.assign({}, state, { salary: a.x125 })).pensionSaved - (dz.reference + T.calcHousehold(Object.assign({}, state, { salary: a.x100 })).pensionSaved);
      const earned = a.x125 - a.x100;
      top =
        '<div class="empty-card"><h4>No cliff edge for you</h4><p>You have no childcare help to lose, so there is no sudden drop. The damage is the slope: between ' + gbp(a.x100) + ' and ' + gbp(a.x125) + ' you earn ' + gbp(earned) + ' more but keep only ' + gbp(Math.max(0, gain)) + ' of it.</p></div>';
    }
    $('viz4Top').innerHTML = top;
    let bottom = '';
    if (dz.breakEven) {
      const deficit = dz.reference - a.hh.spendable;
      bottom =
        '<div class="callout bad"><b>The dead zone.</b> ' +
        (state.salary > dz.cliffSalary && deficit > 0 ? 'At your salary you are ' + gbp(deficit / k) + ' ' + unit() + ' worse off than someone on ' + gbp(dz.cliffSalary) + '. ' : '') +
        'You need a salary of <b>' + gbp(dz.breakEven) + '</b>, which is ' + gbp(dz.extraNeeded) + ' more, before you are better off than at the cliff edge.</div>';
    } else {
      bottom = '<div class="callout">Without childcare help to lose, your money keeps rising as you earn more, but slowly. Each extra pound in the shaded zone keeps only about ' + Math.round((1 - Math.max(0, Math.min(1, a.next.rate))) * 100) + 'p.</div>';
    }
    $('viz4Bottom').innerHTML = bottom;
    mountChart(charts.g4, buildIncome(a, { height: 340 }), { legend: 'legend4' });
  }

  function viz5(a) {
    const k = perK();
    const hh = a.hh;
    const need = T.pensionPctForANI(state, R.taperStart);
    const base = T.calcHousehold(Object.assign({}, state, { pensionPct: 0 }));
    const cost = base.spendable - hh.spendable;
    let top = '';
    if (hh.pensionSaved > 0) {
      top =
        '<div class="callout ' + (cost < 0 ? 'good' : '') + '"><b>' + fmtPct(state.pensionPct) + '% is ' + gbp(hh.pensionSaved) + ' a year.</b> ' +
        (cost >= 0 ? 'It costs you ' + gbp(cost / k) + ' ' + unit() + ' in cash, about ' + Math.round((cost / hh.pensionSaved) * 100) + 'p for every £1 saved.' : 'It puts ' + gbp(-cost / k) + ' ' + unit() + ' <b>more</b> in your pocket as well as ' + gbp(hh.pensionSaved) + ' in your pension.') +
        ' Your income for the tests is ' + gbp(hh.you.ani) + (hh.kids && hh.childcare.gross > 0 ? (hh.supportOK ? ', so childcare help is kept.' : ', so childcare help is still lost.') : '.') + '</div>';
    } else if (need.needed) {
      top = '<div class="callout">You would need <b>' + fmtPct(need.pct) + '%</b> of your salary, about ' + gbp(need.needed) + ' a year, to bring your income down to £100,000.</div>';
    } else {
      top = '<div class="callout">Your income is already at or below £100,000, so pension payments here save tax at your normal rate rather than escaping a trap.</div>';
    }
    if (fixNote) top = '<div class="callout warn">' + fixNote + '</div>' + top;
    $('viz5Top').innerHTML = top;
    let bottom = '';
    if (need.needed && !need.feasible) {
      bottom = '<div class="callout warn">Reaching £100,000 would need ' + fmtPct(need.pct) + '% of salary, which is above the annual allowance or your pay. Gift Aid donations in advanced settings can help.</div>';
    }
    $('viz5Bottom').innerHTML = bottom;
    mountChart(charts.g5, buildPension(a, { height: 340 }), { legend: 'legend5' });
  }

  function viz6(a) {
    const list = insightsList(a).slice(0, 3);
    $('viz6').innerHTML = '<div class="kpis tight">' + kpiHtml(a) + '</div><div class="insights" style="margin-top:14px">' + insightHtml(list) + '</div>';
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard(a) {
    const k = perK();
    $('barTakeHome').textContent = gbp(a.hh.spendable / k) + ' ' + unit();
    $('barMarginal').textContent = pctText(a.next.rate);
    $('barMarginal').style.color = a.next.rate > 0.55 ? 'var(--accent)' : '';
    const sc = statusCopy(a);
    $('statusBanner').className = 'status z-' + sc.zone;
    $('statusBanner').innerHTML = '<h3>' + sc.title + '</h3><p>' + sc.body + '</p><div class="tags">' + sc.tags + '</div>';
    $('kpis').innerHTML = kpiHtml(a);

    $$('#chartHost').forEach(() => {});
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
  function childRowHtml(c, i) {
    const opts = T.BANDS.map((b) => '<option value="' + b + '"' + (b === c.band ? ' selected' : '') + '>' + T.BAND_INFO[b].label + '</option>').join('');
    const body =
      c.band === 'teen'
        ? '<p class="hint">Older children get Child Benefit but have no childcare cost in this model.</p>'
        : '<div class="cr-grid"><div><label for="cm' + i + '">Nursery cost a month</label><div class="money-input"><span class="pound" aria-hidden="true">£</span><input id="cm' + i + '" data-f="monthly" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"></div><span class="est" data-f="tag"></span></div>' +
          '<div><label for="ch' + i + '">Hours a week</label><div class="money-input"><input id="ch' + i + '" data-f="hours" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"></div></div></div>' +
          '<p class="hint"><span data-f="note"></span> <button type="button" class="linklike" data-f="reset" hidden>Use the estimate</button></p>';
    return '<div class="child-row" data-i="' + i + '"><div class="cr-top"><label for="cb' + i + '">Child ' + (i + 1) + '</label><select id="cb' + i + '" data-f="band">' + opts + '</select><button type="button" class="remove" aria-label="Remove child ' + (i + 1) + '" data-f="remove">×</button></div>' + body + '</div>';
  }

  function renderChildren() {
    const list = $('childList');
    list.innerHTML = state.children.length
      ? state.children.map(childRowHtml).join('')
      : '<p class="empty-note">No children added yet. Tap a button above to add one.</p>';
    $$('[data-add-band]').forEach((b) => (b.disabled = state.children.length >= 4));
    syncChildren();
  }

  function syncChildren() {
    $$('#childList .child-row').forEach((row) => {
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
    const list = $('childList');
    const edit = (i, patch) => {
      const kids = state.children.map((c) => Object.assign({}, c));
      Object.assign(kids[i], patch);
      setState({ children: kids });
    };
    list.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const row = e.target.closest('.child-row');
      if (!f || !row) return;
      const i = +row.dataset.i;
      if (f === 'monthly') edit(i, { monthly: e.target.value.trim() === '' ? null : parseNum(e.target.value) });
      if (f === 'hours') edit(i, { hours: parseNum(e.target.value) });
    });
    list.addEventListener('change', (e) => {
      if (e.target.dataset.f !== 'band') return;
      const i = +e.target.closest('.child-row').dataset.i;
      edit(i, { band: e.target.value, hours: T.BAND_INFO[e.target.value].hours, monthly: null });
      renderChildren();
    });
    list.addEventListener('click', (e) => {
      const f = e.target.dataset.f;
      const row = e.target.closest('.child-row');
      if (!row) return;
      const i = +row.dataset.i;
      if (f === 'remove') {
        setState({ children: state.children.filter((_, j) => j !== i) });
        renderChildren();
      } else if (f === 'reset') {
        edit(i, { monthly: null });
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
      el.addEventListener('blur', () => (el.value = nf0.format(state[key])));
    });
    $$('[data-pct]').forEach((el) => {
      const key = el.dataset.pct;
      el.addEventListener('input', () => setState({ [key]: Math.min(100, parseNum(el.value)) }));
      el.addEventListener('blur', () => (el.value = fmtPct(state[key])));
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
    $$('[data-money]').forEach((el) => setField(el, nf0.format(state[el.dataset.money])));
    $$('[data-pct]').forEach((el) => setField(el, fmtPct(state[el.dataset.pct])));
    $$('[data-number]').forEach((el) => setField(el, String(state[el.dataset.number])));
    $$('[data-range]').forEach((el) => (el.value = Math.min(+el.max, state[el.dataset.range])));
    $$('[data-select]').forEach((el) => (el.value = state[el.dataset.select]));
    $$('[data-check]').forEach((el) => (el.checked = !!state[el.dataset.check]));
    $$('[data-choice]').forEach((el) => el.setAttribute('aria-pressed', state[el.dataset.choice] === el.dataset.value ? 'true' : 'false'));
    $$('[data-show-if]').forEach((el) => (el.hidden = !state[el.dataset.showIf]));
    $$('input[name=period]').forEach((r) => (r.checked = r.value === period));

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

  /* ---------- Modes and navigation ---------- */
  function applyMode() {
    const steps = mode === 'steps';
    $('steps').hidden = !steps;
    $('guideNav').hidden = !steps;
    $('progress').hidden = !steps;
    $('answerRow').hidden = steps;
    $('dashboard').hidden = steps;
    $('guide').classList.toggle('compact', !steps);
    $$('.step').forEach((el) => (el.hidden = +el.dataset.step !== step));
    $$('#progress button').forEach((b) => {
      const n = +b.dataset.goto;
      b.classList.toggle('active', n === step);
      b.classList.toggle('done', n < step);
      b.setAttribute('aria-current', n === step ? 'step' : 'false');
    });
    $('navBack').disabled = step === 1;
    $('navNext').textContent = step === 6 ? 'Show me all the data' : 'Next: ' + STEP_LABELS[step + 1];
  }

  function bringGuideIntoView() {
    const r = $('guide').getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.5) $('guide').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function goStep(n, focus) {
    step = Math.min(6, Math.max(1, n));
    mode = 'steps';
    applyMode();
    render();
    if (focus) {
      bringGuideIntoView();
      const t = document.querySelector('.step[data-step="' + step + '"] .step-title');
      if (t) t.focus({ preventScroll: true });
    }
  }

  function showAll() {
    mode = 'done';
    applyMode();
    render();
    $('guide').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAnswerRow() {
    const kids = state.children.length;
    const chips = [
      ['1', 'Salary ' + gbp(state.salary)],
      ['3', kids ? plural(kids, 'child', 'children') : 'No children'],
      ['5', 'Pension ' + fmtPct(state.pensionPct) + '%'],
    ];
    $('answerRow').innerHTML =
      '<span class="presets-label">Your answers</span>' +
      chips.map((c) => '<button type="button" class="chip" data-edit="' + c[0] + '">' + c[1] + '</button>').join('') +
      '<button type="button" class="chip" data-open-advanced>Advanced settings</button>' +
      '<button type="button" class="chip ghost-chip" data-edit="1">Walk me through again</button>';
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
    if (mode === 'steps') {
      ({ 1: viz1, 2: viz2, 3: viz3, 4: viz4, 5: viz5, 6: viz6 })[step](a);
    } else {
      renderDashboard(a);
    }
    scheduleUrl();
    renderLive(a);
  }

  /* ---------- Wiring ---------- */
  function openAdvanced() {
    const d = $('advanced');
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function wire() {
    bindFields();
    wireChildren();

    $$('#progress [data-goto]').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.goto, true)));
    $('navBack').addEventListener('click', () => goStep(step - 1, true));
    $('navNext').addEventListener('click', () => (step === 6 ? showAll() : goStep(step + 1, true)));
    $('skipAll').addEventListener('click', showAll);
    $('showAll').addEventListener('click', showAll);
    $('answerRow').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-open-advanced')) openAdvanced();
      else if (b.dataset.edit) goStep(+b.dataset.edit, true);
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-advanced]');
      if (b && !$('answerRow').contains(b)) openAdvanced();
    });

    $$('[data-set-salary]').forEach((b) => b.addEventListener('click', () => setState({ salary: +b.dataset.setSalary })));
    $$('[data-jump]').forEach((b) =>
      b.addEventListener('click', () => {
        const at = T.salaryAtANI(state, R.taperStart);
        setState({ salary: b.dataset.jump === 'below' ? Math.ceil(at) - 1 : Math.floor(at) + 1 });
      })
    );
    $$('.nudge').forEach((b) => b.addEventListener('click', () => setState({ salary: Math.max(0, state.salary + +b.dataset.nudge) })));

    $('fixPension').addEventListener('click', () => {
      const a = analyse(state);
      const need = T.pensionPctForANI(state, R.taperStart);
      if (!need.needed) {
        fixNote = 'Your income is already at or below £100,000, so there is nothing to fix.';
        render();
        return;
      }
      if (!need.feasible) {
        const maxPct = Math.floor(Math.min(100, (Math.max(0, a.hh.pensionCap) / Math.max(1, state.salary)) * 100) * 100) / 100;
        setState({ pensionPct: maxPct });
        fixNote = 'The most you can pay in is ' + fmtPct(maxPct) + '%, because of the £60,000 annual allowance. That is not enough to reach £100,000.';
        render();
        return;
      }
      setState({ pensionPct: need.pct });
    });
    $('clearPension').addEventListener('click', () => setState({ pensionPct: 0 }));

    $$('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        state = T.normalise(Object.assign(T.defaultState(), PRESETS[b.dataset.preset]));
        fixNote = '';
        renderChildren();
        if (b.hasAttribute('data-reveal')) {
          mode = 'done';
          applyMode();
          render();
          $('explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          render();
        }
      })
    );

    $('resetAll').addEventListener('click', () => {
      state = T.normalise(T.defaultState());
      period = 'month';
      view = 'income';
      range = 'focus';
      fixNote = '';
      renderChildren();
      goStep(1, true);
    });

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
          const inst = { chartHost: charts.dash, chartHost4: charts.g4, chartHost5: charts.g5 }[key];
          if (inst) inst.resize();
        }
      });
    });
    ['chartHost', 'chartHost4', 'chartHost5'].forEach((id) => ro.observe($(id)));
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
    charts.g4 = C.createChart($('chartHost4'));
    charts.g5 = C.createChart($('chartHost5'));
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
