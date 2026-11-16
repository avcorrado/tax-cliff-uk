/*
 * Tax engine for the UK £100,000 cliff explorer (tax year 2026/27).
 * Pure functions only, so it runs in the browser (window.TaxCliff) and in Node tests.
 * All money values are annual pounds unless a name says otherwise.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaxCliff = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = Object.freeze({
    taxYear: '2026/27',
    personalAllowance: 12570,
    taperStart: 100000,
    taperEnd: 125140,
    // Upper limits are measured on taxable income (income after the Personal Allowance).
    bands: {
      uk: [[37700, 0.2], [125140, 0.4], [Infinity, 0.45]],
      scotland: [
        [3967, 0.19],
        [16956, 0.2],
        [31092, 0.21],
        [62430, 0.42],
        [125140, 0.45],
        [Infinity, 0.48],
      ],
    },
    ni: { threshold: 12570, upper: 50270, main: 0.08, above: 0.02 },
    studentLoan: {
      plans: { plan1: 26900, plan2: 29385, plan4: 33795, plan5: 25000 },
      rate: 0.09,
      postgrad: { threshold: 21000, rate: 0.06 },
    },
    childBenefit: { first: 27.05, other: 17.9, weeks: 52, chargeStart: 60000, chargeEnd: 80000, step: 200 },
    childcare: {
      tfcRate: 0.2,
      tfcCap: 2000,
      incomeLimit: 100000,
      fundedHours: 30,
      universalHours: 15,
      fundedWeeks: 38,
      // Average England nursery price per hour (Coram 2026 gives about £7.44), used to estimate a monthly bill.
      defaultHourly: 7.5,
      // 16 hours a week at the National Living Wage (£12.71) over 52 weeks.
      minEarnings: 10575,
    },
    annualAllowance: 60000,
    giftAidGrossUp: 1.25,
  });

  const BANDS = ['baby', 'toddler', 'preschool', 'school', 'teen'];
  const PLANS = ['none', 'plan1', 'plan2', 'plan4', 'plan5'];
  const REGIONS = ['england', 'scotland', 'wales_ni'];

  const BAND_INFO = {
    baby: { label: 'Baby (under 9 months)', hours: 40 },
    toddler: { label: 'Toddler (9 months to 2)', hours: 40 },
    preschool: { label: 'Preschool (3 to 4)', hours: 40 },
    school: { label: 'School age (5 to 11)', hours: 15 },
    teen: { label: 'Older child (12 to 15)', hours: 0 },
  };

  function defaultState() {
    return {
      salary: 105000,
      region: 'england',
      method: 'sacrifice',
      pensionPct: 0,
      employerPct: 0,
      gift: 0,
      plan: 'none',
      postgrad: false,
      children: [
        { band: 'toddler', hours: 40 },
        { band: 'preschool', hours: 40 },
      ],
      partnerOn: false,
      partnerSalary: 40000,
      weeks: 50,
    };
  }

  const EPS = 0.005;
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Monthly nursery bill estimated from hours a week at the average hourly price.
  function estimateMonthly(hours, weeks) {
    return Math.round((hours * RULES.childcare.defaultHourly * (weeks == null ? 50 : weeks)) / 12 / 10) * 10;
  }

  function normalise(raw) {
    const s = Object.assign(defaultState(), raw || {});
    s.salary = clamp(num(s.salary), 0, 5e6);
    s.pensionPct = clamp(num(s.pensionPct), 0, 100);
    s.employerPct = clamp(num(s.employerPct), 0, 100);
    s.gift = clamp(num(s.gift), 0, 5e6);
    s.region = REGIONS.includes(s.region) ? s.region : 'england';
    s.method = s.method === 'personal' ? 'personal' : 'sacrifice';
    s.plan = PLANS.includes(s.plan) ? s.plan : 'none';
    s.postgrad = !!s.postgrad;
    s.children = (Array.isArray(s.children) ? s.children : []).slice(0, 4).map((c) => {
      const band = BANDS.includes(c && c.band) ? c.band : 'preschool';
      const hours = band === 'teen' ? 0 : clamp(num(c && c.hours, BAND_INFO[band].hours), 0, 70);
      const hasMonthly = band !== 'teen' && c && c.monthly != null && c.monthly !== '' && Number.isFinite(+c.monthly);
      return { band, hours, monthly: hasMonthly ? clamp(+c.monthly, 0, 20000) : null };
    });
    s.partnerOn = !!s.partnerOn;
    s.partnerSalary = clamp(num(s.partnerSalary), 0, 5e6);
    s.weeks = clamp(Math.round(num(s.weeks, 50)), 1, 52);
    return s;
  }

  function personalAllowance(ani, opts) {
    const pa = RULES.personalAllowance;
    if (opts && opts.noTaper) return pa;
    return Math.max(0, pa - Math.max(0, ani - RULES.taperStart) / 2);
  }

  function incomeTax(ani, region, opts) {
    const table = RULES.bands[region === 'scotland' ? 'scotland' : 'uk'];
    const taxable = Math.max(0, ani - personalAllowance(ani, opts));
    let tax = 0;
    let lower = 0;
    for (const [upper, rate] of table) {
      if (taxable <= lower) break;
      tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  function employeeNI(pay) {
    const { threshold, upper, main, above } = RULES.ni;
    if (pay <= threshold) return 0;
    return (Math.min(pay, upper) - threshold) * main + Math.max(0, pay - upper) * above;
  }

  function studentLoanRepayment(pay, plan, postgrad) {
    const sl = RULES.studentLoan;
    let total = 0;
    if (plan && plan !== 'none') total += Math.max(0, pay - sl.plans[plan]) * sl.rate;
    if (postgrad) total += Math.max(0, pay - sl.postgrad.threshold) * sl.postgrad.rate;
    return total;
  }

  function calcPerson(p, opts) {
    const salary = Math.max(0, p.salary || 0);
    const sacrifice = Math.min(Math.max(0, p.sacrifice || 0), salary);
    const pay = salary - sacrifice;
    const personal = Math.min(Math.max(0, p.personal || 0), pay);
    const giftGross = Math.min(Math.max(0, p.giftNet || 0) * RULES.giftAidGrossUp, pay - personal);
    const ani = pay - personal - giftGross;
    const allowance = personalAllowance(ani, opts);
    const tax = incomeTax(ani, p.region, opts);
    const ni = employeeNI(pay);
    const studentLoan = studentLoanRepayment(pay, p.plan, p.postgrad);
    const takeHome = pay - personal - giftGross - tax - ni - studentLoan;
    return { salary, sacrifice, pay, personal, giftGross, ani, allowance, tax, ni, studentLoan, takeHome };
  }

  function fundedHoursPerWeek(band, region, supportOK) {
    if (region === 'england') {
      if (band === 'toddler') return supportOK ? RULES.childcare.fundedHours : 0;
      if (band === 'preschool') return supportOK ? RULES.childcare.fundedHours : RULES.childcare.universalHours;
      return 0;
    }
    // Scotland funds 1,140 hours a year for 3 and 4 year olds without an income test.
    if (region === 'scotland' && band === 'preschool') return RULES.childcare.fundedHours;
    return 0;
  }

  function pensionAmounts(s, salary) {
    const employer = (salary * s.employerPct) / 100;
    const cap = Math.max(0, RULES.annualAllowance - employer);
    const wanted = (salary * s.pensionPct) / 100;
    return { employer, cap, wanted, amount: Math.min(wanted, cap) };
  }

  function youInput(s, salary) {
    const p = pensionAmounts(s, salary);
    const sacrifice = s.method === 'sacrifice';
    return {
      salary,
      sacrifice: sacrifice ? p.amount : 0,
      personal: sacrifice ? 0 : p.amount,
      giftNet: s.gift,
      region: s.region,
      plan: s.plan,
      postgrad: s.postgrad,
    };
  }

  function calcHousehold(s, opts) {
    opts = opts || {};
    const pa = pensionAmounts(s, s.salary);
    const you = calcPerson(youInput(s, s.salary), opts);
    const partner = s.partnerOn ? calcPerson({ salary: s.partnerSalary, region: s.region, plan: 'none' }, opts) : null;

    const kids = s.children.length;
    const cb = RULES.childBenefit;
    const benefitGross = kids ? Math.round((cb.first + cb.other * (kids - 1)) * cb.weeks * 100) / 100 : 0;
    const topAni = Math.max(you.ani, partner ? partner.ani : 0);
    let hicbcPct = 0;
    if (benefitGross && topAni > cb.chargeStart + EPS) {
      hicbcPct = Math.min(100, Math.floor((topAni - cb.chargeStart) / cb.step));
    }
    const hicbc = Math.floor((benefitGross * hicbcPct) / 100);

    const cc = RULES.childcare;
    const earnsEnough = you.salary >= cc.minEarnings && (!partner || partner.salary >= cc.minEarnings);
    const underLimit = you.ani <= cc.incomeLimit + EPS && (!partner || partner.ani <= cc.incomeLimit + EPS);
    const supportOK = earnsEnough && (opts.noTest || underLimit);

    const perChild = s.children.map((c) => {
      const hours = c.band === 'teen' ? 0 : c.hours;
      const monthly = c.band === 'teen' ? 0 : c.monthly != null ? c.monthly : estimateMonthly(hours, s.weeks);
      const gross = monthly * 12;
      const hourly = hours > 0 ? gross / (hours * s.weeks) : 0;
      const fundedWeekly = fundedHoursPerWeek(c.band, s.region, supportOK);
      const funded = Math.min(hours, fundedWeekly) * Math.min(s.weeks, cc.fundedWeeks) * hourly;
      const bill = gross - funded;
      const tfc = supportOK && c.band !== 'teen' ? Math.min(cc.tfcCap, cc.tfcRate * bill) : 0;
      return { band: c.band, hours, monthly, hourly, gross, funded, bill, tfc, net: bill - tfc };
    });
    const childcare = perChild.reduce(
      (a, c) => ({
        gross: a.gross + c.gross,
        funded: a.funded + c.funded,
        tfc: a.tfc + c.tfc,
        net: a.net + c.net,
      }),
      { gross: 0, funded: 0, tfc: 0, net: 0 }
    );

    const spendable =
      you.takeHome + (partner ? partner.takeHome : 0) + (benefitGross - hicbc) - childcare.net;

    return {
      you,
      partner,
      kids,
      benefitGross,
      hicbc,
      hicbcPct,
      topAni,
      supportOK,
      earnsEnough,
      perChild,
      childcare,
      spendable,
      pensionSaved: you.sacrifice + you.personal,
      employerAmount: pa.employer,
      pensionCap: pa.cap,
      pensionCapped: pa.wanted > pa.cap + EPS,
    };
  }

  const withSalary = (s, salary) => Object.assign({}, s, { salary });
  const spendableAt = (s, salary, opts) => calcHousehold(withSalary(s, salary), opts).spendable;

  function marginalRate(s, salary, delta) {
    delta = delta || 1000;
    const at = (x) => {
      const h = calcHousehold(withSalary(s, x));
      return h.spendable + h.pensionSaved;
    };
    return 1 - (at(salary + delta) - at(salary)) / delta;
  }

  // Salary at which your adjusted net income equals the target, given your pension percentage and donations.
  function salaryAtANI(s, target) {
    const aniAt = (sal) => calcPerson(youInput(s, sal)).ani;
    let lo = 0;
    let hi = target + RULES.annualAllowance + s.gift * RULES.giftAidGrossUp + 1000;
    while (aniAt(hi) < target && hi < 1e8) hi *= 2;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (aniAt(mid) < target) lo = mid;
      else hi = mid;
    }
    return Math.round(hi * 1e4) / 1e4;
  }

  function zoneFor(ani) {
    if (ani <= RULES.personalAllowance) return 'allowance';
    if (ani <= 50270) return 'basic';
    if (ani <= RULES.taperStart + EPS) return 'higher';
    if (ani <= RULES.taperEnd) return 'trap';
    return 'top';
  }

  function cliffCost(s) {
    const actual = calcHousehold(s).spendable;
    const allowance = calcHousehold(s, { noTaper: true }).spendable - actual;
    const childcare = calcHousehold(s, { noTest: true }).spendable - actual;
    return { allowance, childcare, total: allowance + childcare };
  }

  function deadZone(s) {
    const sRef = salaryAtANI(s, RULES.taperStart);
    const ref = spendableAt(s, sRef);
    const drop = ref - spendableAt(s, sRef + 1);
    let breakEven = null;
    if (drop > 100) {
      for (let sal = sRef + 1; sal <= sRef + 600000; sal += 50) {
        if (spendableAt(s, sal) > ref) {
          breakEven = sal;
          break;
        }
      }
    }
    return { cliffSalary: sRef, reference: ref, drop, breakEven, extraNeeded: breakEven ? breakEven - sRef : null };
  }

  function nextSlice(s, delta) {
    delta = delta || 1000;
    const a = calcHousehold(s);
    const b = calcHousehold(withSalary(s, s.salary + delta));
    const rows = {
      tax: b.you.tax - a.you.tax,
      ni: b.you.ni - a.you.ni,
      studentLoan: b.you.studentLoan - a.you.studentLoan,
      hicbc: b.hicbc - a.hicbc,
      childcare: b.childcare.net - a.childcare.net,
    };
    const lost = rows.tax + rows.ni + rows.studentLoan + rows.hicbc + rows.childcare;
    const pension = b.pensionSaved - a.pensionSaved;
    return Object.assign(rows, {
      delta,
      pension,
      retained: delta - lost,
      kept: delta - lost - pension,
      rate: lost / delta,
    });
  }

  // Pension percentage (to two decimals, rounded up) that brings adjusted net income down to the target.
  function pensionPctForANI(s, target) {
    const base = calcHousehold(Object.assign({}, s, { pensionPct: 0 }));
    const needed = Math.max(0, base.you.ani - target);
    if (!needed) return { needed: 0, exactPct: 0, pct: 0, feasible: true };
    const exactPct = (needed / Math.max(1, s.salary)) * 100;
    const pct = Math.ceil(exactPct * 100 - 1e-9) / 100;
    const cap = pensionAmounts(Object.assign({}, s, { pensionPct: pct }), s.salary).cap;
    return { needed, exactPct, pct, feasible: pct <= 100 && needed <= cap + 1e-6 && needed <= base.you.pay + 1e-6 };
  }

  function strategies(s) {
    const base = calcHousehold(s);
    const out = [];
    const targets = [{ id: 'hundred', target: RULES.taperStart, label: 'Reach £100,000' }];
    if (base.hicbc > 0 && base.topAni === base.you.ani && base.you.ani <= RULES.taperStart) {
      targets.push({ id: 'sixty', target: RULES.childBenefit.chargeStart, label: 'Reach £60,000' });
    }
    for (const t of targets) {
      if (base.you.ani <= t.target + EPS) continue;
      const need = pensionPctForANI(s, t.target);
      const gap = base.you.ani - t.target;
      const variants = [
        { key: 'sacrifice', label: 'Pension by salary sacrifice', overrides: { method: 'sacrifice', pensionPct: need.pct } },
        { key: 'personal', label: 'Personal pension or net pay', overrides: { method: 'personal', pensionPct: need.pct } },
      ];
      if (t.id === 'hundred') {
        variants.push({ key: 'gift', label: 'Gift Aid donation', overrides: { gift: s.gift + gap / RULES.giftAidGrossUp } });
      }
      for (const v of variants) {
        const r = calcHousehold(Object.assign({}, s, v.overrides));
        const isGift = v.key === 'gift';
        const extra = isGift ? gap : r.pensionSaved - base.pensionSaved;
        out.push({
          id: t.id + '-' + v.key,
          target: t.target,
          targetLabel: t.label,
          label: v.label,
          pct: isGift ? null : need.pct,
          total: r.pensionSaved,
          extra,
          feasible: isGift ? true : need.feasible,
          spendable: r.spendable,
          change: r.spendable - base.spendable,
          cost: base.spendable - r.spendable,
          costPerPound: extra > 0 ? (base.spendable - r.spendable) / extra : 0,
          ani: r.you.ani,
          supportOK: r.supportOK,
        });
      }
    }
    return { base, rows: out };
  }

  return {
    RULES,
    BANDS,
    PLANS,
    REGIONS,
    BAND_INFO,
    defaultState,
    normalise,
    estimateMonthly,
    personalAllowance,
    incomeTax,
    employeeNI,
    studentLoanRepayment,
    calcPerson,
    calcHousehold,
    spendableAt,
    marginalRate,
    salaryAtANI,
    zoneFor,
    cliffCost,
    deadZone,
    nextSlice,
    pensionPctForANI,
    strategies,
  };
});
