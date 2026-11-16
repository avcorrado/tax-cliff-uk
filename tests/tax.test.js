'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tax.js');

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} to be within ${tol} of ${expected}`);

const base = (over) => T.normalise(Object.assign({ children: [], salary: 100000 }, over));
const pct = (amount, salary) => (amount / salary) * 100;

test('income tax at the key England thresholds', () => {
  near(T.incomeTax(50270, 'england'), 7540);
  near(T.incomeTax(100000, 'england'), 27432);
  near(T.incomeTax(110000, 'england'), 33432);
  near(T.incomeTax(125140, 'england'), 42516);
});

test('Scottish tax at £100,000', () => {
  near(T.incomeTax(100000, 'scotland'), 30732.05);
});

test('employee National Insurance', () => {
  near(T.employeeNI(100000), 4010.6);
  near(T.employeeNI(10000), 0);
});

test('Personal Allowance taper disappears at £125,140', () => {
  assert.equal(T.personalAllowance(100000), 12570);
  assert.equal(T.personalAllowance(112570), 6285);
  assert.equal(T.personalAllowance(125140), 0);
  assert.equal(T.personalAllowance(200000), 0);
});

test('effective marginal rate in the taper is 62% in England and 69.5% in Scotland', () => {
  near(T.marginalRate(base(), 110000, 1000), 0.62, 0.001);
  near(T.marginalRate(base({ region: 'scotland' }), 110000, 1000), 0.695, 0.001);
});

test('Plan 2 student loan adds 9 points to the marginal rate', () => {
  near(T.studentLoanRepayment(110000, 'plan2', false), 7255.35);
  near(T.marginalRate(base({ plan: 'plan2' }), 110000, 1000), 0.71, 0.001);
});

test('High Income Child Benefit Charge', () => {
  const two = (ani) =>
    T.calcHousehold(base({ salary: ani, children: [{ band: 'school', hours: 0 }, { band: 'school', hours: 0 }] }));
  near(two(60199).hicbc, 0);
  assert.equal(two(60200).hicbcPct, 1);
  assert.equal(two(70000).hicbc, 1168);
  assert.equal(two(80000).hicbc, 2337);
  near(two(90000).benefitGross, 2337.4);
});

test('crossing £100,000 removes childcare support worth thousands', () => {
  const s = T.normalise({ salary: 100000 });
  const before = T.calcHousehold(s);
  const after = T.calcHousehold(Object.assign({}, s, { salary: 100001 }));
  assert.ok(before.supportOK);
  assert.ok(!after.supportOK);
  near(before.spendable - after.spendable, 15404.62, 0.01);
});

test('nursery cost is estimated monthly and can be overridden', () => {
  assert.equal(T.estimateMonthly(40, 50), 1250);
  const est = T.calcHousehold(T.normalise({ salary: 90000, children: [{ band: 'toddler', hours: 40 }] }));
  assert.equal(est.perChild[0].monthly, 1250);
  assert.equal(est.perChild[0].gross, 15000);
  const own = T.calcHousehold(T.normalise({ salary: 90000, children: [{ band: 'toddler', hours: 40, monthly: 2000 }] }));
  assert.equal(own.perChild[0].gross, 24000);
  assert.equal(own.perChild[0].funded, 30 * 38 * (24000 / (40 * 50)));
});

test('preschool children keep 15 universal hours in England after the cliff', () => {
  const s = T.normalise({ salary: 101000, children: [{ band: 'preschool', hours: 40 }] });
  const r = T.calcHousehold(s);
  assert.equal(r.perChild[0].funded, 15 * 38 * 7.5);
  assert.equal(r.perChild[0].tfc, 0);
});

test('Scotland funds preschool hours without an income test', () => {
  const s = T.normalise({ salary: 130000, region: 'scotland', children: [{ band: 'preschool', hours: 40 }] });
  assert.equal(T.calcHousehold(s).perChild[0].funded, 30 * 38 * 7.5);
});

test('Tax Free Childcare is 20% of the bill and capped at £2,000', () => {
  const big = T.normalise({ salary: 60000, children: [{ band: 'school', hours: 60, monthly: 5000 }] });
  assert.equal(T.calcHousehold(big).perChild[0].tfc, 2000);
  const small = T.normalise({ salary: 60000, children: [{ band: 'school', hours: 10, monthly: 400 }] });
  near(T.calcHousehold(small).perChild[0].tfc, 960);
});

test('either parent over £100,000 removes support for the whole household', () => {
  const s = T.normalise({ salary: 60000, partnerOn: true, partnerSalary: 101000 });
  assert.ok(!T.calcHousehold(s).supportOK);
  const ok = T.normalise({ salary: 99000, partnerOn: true, partnerSalary: 99000 });
  assert.ok(T.calcHousehold(ok).supportOK);
});

test('pension is a percentage of gross salary', () => {
  const r = T.calcHousehold(T.normalise({ salary: 110000, children: [], pensionPct: 10 }));
  near(r.pensionSaved, 11000);
  near(r.you.ani, 99000);
  const doubled = T.calcHousehold(T.normalise({ salary: 220000, children: [], pensionPct: 10 }));
  near(doubled.pensionSaved, 22000);
});

test('the cliff moves right as the pension percentage rises', () => {
  const s = T.normalise({ children: [], pensionPct: 10 });
  const at = T.salaryAtANI(s, 100000);
  near(at, 111111.11, 0.01);
  near(T.calcPerson({ salary: at, sacrifice: at * 0.1, region: 'england' }).ani, 100000, 0.001);
  assert.equal(T.salaryAtANI(T.normalise({ children: [] }), 100000), 100000);
});

test('pension percentage above the annual allowance is capped', () => {
  const r = T.calcHousehold(T.normalise({ salary: 150000, children: [], pensionPct: 50 }));
  assert.equal(r.pensionSaved, 60000);
  assert.ok(r.pensionCapped);
  const withEmployer = T.calcHousehold(T.normalise({ salary: 150000, children: [], pensionPct: 50, employerPct: 10 }));
  near(withEmployer.pensionSaved, 45000);
});

test('pension contributions that cut income to £100,000 raise take home pay', () => {
  const s = T.normalise({ salary: 105000 });
  const withPension = Object.assign({}, s, { pensionPct: pct(5000, 105000) });
  const a = T.calcHousehold(s);
  const b = T.calcHousehold(withPension);
  assert.ok(b.supportOK, 'childcare help comes back');
  assert.ok(b.spendable > a.spendable, 'cash in hand should rise even though 5,000 went into a pension');
  near(b.you.ani, 100000, 0.001);
});

test('salary sacrifice saves National Insurance compared with a personal pension', () => {
  const s = T.normalise({ salary: 110000, children: [], pensionPct: pct(10000, 110000) });
  const sac = T.calcHousehold(Object.assign({}, s, { method: 'sacrifice' }));
  const personal = T.calcHousehold(Object.assign({}, s, { method: 'personal' }));
  near(sac.spendable - personal.spendable, 200, 0.5);
});

test('Gift Aid and a pension of the same gross size reduce tax identically', () => {
  const s = T.normalise({ salary: 110000, children: [] });
  const pension = T.calcHousehold(Object.assign({}, s, { method: 'personal', pensionPct: pct(10000, 110000) }));
  const gift = T.calcHousehold(Object.assign({}, s, { gift: 8000 }));
  near(pension.spendable, gift.spendable, 0.01);
});

test('pension in the trap zone costs about 40p per pound for a childless taxpayer', () => {
  const s = T.normalise({ salary: 110000, children: [] });
  const personal = T.strategies(s).rows.find((r) => r.id === 'hundred-personal');
  near(personal.costPerPound, 0.4, 0.002);
  assert.ok(personal.pct > 9.09 && personal.pct < 9.11);
  assert.ok(personal.ani <= 100000);
});

test('pensionPctForANI rounds up so income lands at or below the line', () => {
  const s = T.normalise({ salary: 108000, children: [] });
  const need = T.pensionPctForANI(s, 100000);
  assert.ok(need.pct >= need.exactPct && need.pct - need.exactPct < 0.01);
  const r = T.calcHousehold(Object.assign({}, s, { pensionPct: need.pct }));
  assert.ok(r.you.ani <= 100000);
});

test('dead zone finds the salary needed to recover', () => {
  const dz = T.deadZone(T.normalise({}));
  assert.equal(dz.cliffSalary, 100000);
  assert.ok(dz.drop > 15000);
  assert.ok(dz.breakEven > 125000 && dz.breakEven < 160000, 'break even was ' + dz.breakEven);
  const noKids = T.deadZone(T.normalise({ children: [] }));
  assert.equal(noKids.breakEven, null);
});

test('cliff cost splits into allowance and childcare effects', () => {
  const c = T.cliffCost(T.normalise({ salary: 130000 }));
  near(c.allowance, 5271);
  assert.ok(c.childcare > 15000);
  near(c.total, c.allowance + c.childcare);
});

test('next slice components add up to the delta, with pension counted as saved', () => {
  const s = T.normalise({ salary: 110000, plan: 'plan2', pensionPct: 10 });
  const n = T.nextSlice(s, 1000);
  near(n.kept + n.pension + n.tax + n.ni + n.studentLoan + n.hicbc + n.childcare, 1000);
  near(n.pension, 100);
  near(n.retained, n.kept + n.pension);
  near(T.marginalRate(s, 110000, 1000), n.rate, 0.0001);
});

test('normalise clamps hostile input', () => {
  const s = T.normalise({
    salary: 'abc',
    pensionPct: 900,
    children: new Array(9).fill({ band: 'zzz', hours: 999, monthly: 'x' }),
    region: 'mars',
    weeks: 99,
  });
  assert.equal(s.children.length, 4);
  assert.equal(s.children[0].band, 'preschool');
  assert.equal(s.children[0].hours, 70);
  assert.equal(s.children[0].monthly, null);
  assert.equal(s.pensionPct, 100);
  assert.equal(s.region, 'england');
  assert.equal(s.weeks, 52);
  assert.equal(s.salary, 0);
});
