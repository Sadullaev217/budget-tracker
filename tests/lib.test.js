// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DATA_VERSION, toCents, fmt, localISO, escapeHtml, migrateData, sumTotals, sumDay, monthlyExpenseSeries } = require('../lib.js');

test('toCents converts dollar strings to integer cents', () => {
  assert.equal(toCents('12.34'), 1234);
  assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3'));
  assert.equal(toCents('19.99'), 1999);
  assert.ok(Number.isNaN(toCents('')));
  assert.ok(Number.isNaN(toCents('abc')));
});

test('fmt formats cents as dollars with sign', () => {
  assert.equal(fmt(1230), '$12.30');
  assert.equal(fmt(-5), '-$0.05');
  assert.equal(fmt(0), '$0.00');
});

test('localISO uses the local calendar date, not UTC', () => {
  // 10:30pm local on 27 Oct must stay the 27th in every timezone.
  assert.equal(localISO(new Date(2026, 9, 27, 22, 30)), '2026-10-27');
  assert.equal(localISO(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
});

test('migrateData converts v1 dollars to v2 cents exactly once', () => {
  const v1 = { transactions: [{ id: 'a', type: 'expense', amount: 1240.5 }], goals: [{ id: 'g', target: 5000, saved: 1800.25 }] };
  const first = migrateData(v1);
  assert.equal(first.changed, true);
  assert.equal(first.data.v, DATA_VERSION);
  assert.equal(first.data.transactions[0].amount, 124050);
  assert.deepEqual([first.data.goals[0].target, first.data.goals[0].saved], [500000, 180025]);

  const second = migrateData(first.data);
  assert.equal(second.changed, false);
  assert.equal(second.data.transactions[0].amount, 124050);
});

test('migrateData tolerates missing or bad fields', () => {
  const { data } = migrateData({});
  assert.deepEqual([data.transactions, data.goals], [[], []]);
  assert.equal(migrateData({ transactions: [{ amount: 'oops' }] }).data.transactions[0].amount, 0);
});

const txs = [
  { type: 'income', amount: 30, category: 'Gift', date: '2026-10-20' },
  { type: 'expense', amount: 10, category: 'Food', date: '2026-10-20' },
  { type: 'expense', amount: 20, category: 'Food', date: '2026-10-20' },
  { type: 'expense', amount: 500, category: 'Housing', date: '2026-10-21' }
];

test('sumTotals adds income, expenses and per-category spend', () => {
  assert.deepEqual(sumTotals(txs), { income: 30, expense: 530, balance: -500, byCategory: { Food: 30, Housing: 500 } });
});

test('sumDay nets to exactly zero when income equals expenses', () => {
  assert.deepEqual(sumDay(txs, '2026-10-20'), { income: 30, expense: 30, net: 0 });
  assert.deepEqual(sumDay(txs, '2026-01-01'), { income: 0, expense: 0, net: 0 });
});

test('monthlyExpenseSeries returns 6 consecutive months with zero-filled gaps', () => {
  const data = [
    { type: 'expense', amount: 100, date: '2026-07-04' },
    { type: 'expense', amount: 250, date: '2026-09-12' },
    { type: 'income', amount: 9999, date: '2026-08-01' },
    { type: 'expense', amount: 7, date: '2025-01-01' }
  ];
  const s = monthlyExpenseSeries(data, new Date(2026, 9, 15));
  assert.deepEqual(s.map(m => m.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(s.map(m => m.total), [0, 0, 100, 0, 250, 0]);
});

test('monthlyExpenseSeries labels include the year when the window spans two years', () => {
  const s = monthlyExpenseSeries([], new Date(2027, 1, 10));
  assert.equal(s[0].key, '2026-09');
  assert.equal(s[5].key, '2027-02');
  assert.match(s[0].label, /26/);
});
