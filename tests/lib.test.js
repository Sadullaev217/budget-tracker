// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DATA_VERSION, CURRENCIES, toCents, amountError, formatMoney, formatMoneyCompact, localISO, escapeHtml, migrateData, parseBackup, transactionsToCSV, filterTransactions, currentMonthByCategory, sumTotals, sumDay, monthlyExpenseSeries } = require('../lib.js');

test('toCents converts dollar strings to integer cents', () => {
  assert.equal(toCents('12.34'), 1234);
  assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3'));
  assert.equal(toCents('19.99'), 1999);
  assert.ok(Number.isNaN(toCents('')));
  assert.ok(Number.isNaN(toCents('abc')));
});

test('amountError explains empty, zero, negative and sub-cent input', () => {
  assert.equal(amountError(''), 'Enter an amount.');
  assert.equal(amountError('   ', 'Enter a target.'), 'Enter a target.');
  assert.equal(amountError('0'), 'Enter an amount greater than 0.');
  assert.equal(amountError('-5'), 'Enter an amount greater than 0.');
  assert.equal(amountError('0.001'), 'Enter an amount greater than 0.');
  assert.equal(amountError('12.50'), '');
});

test('formatMoney formats cents with sign and currency', () => {
  assert.equal(formatMoney(1230, 'USD', 'en-US'), '$12.30');
  assert.equal(formatMoney(-5, 'USD', 'en-US'), '-$0.05');
  assert.equal(formatMoney(0, 'USD', 'en-US'), '$0.00');
  assert.equal(formatMoney(123456, 'USD', 'en-US'), '$1,234.56');
  assert.equal(formatMoney(1230, 'EUR', 'en-US'), '€12.30');
  assert.equal(formatMoney(1230, 'CAD', 'en-CA'), '$12.30');   // narrow symbol: not "CA$" or "US$"
});

test('formatMoneyCompact shortens large amounts', () => {
  assert.equal(formatMoneyCompact(17500, 'USD', 'en-US'), '$175');
  assert.equal(formatMoneyCompact(215075, 'USD', 'en-US'), '$2.2K');
});

test('every offered currency formats with exactly 2 decimals', () => {
  for (const c of CURRENCIES) assert.match(formatMoney(1999, c, 'en-US'), /19\.99/, c);
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

test('parseBackup accepts a valid v2 backup and normalises fields', () => {
  const { data, error } = parseBackup({ v: 2, transactions: [{ id: 'a', type: 'expense', amount: 1999, category: 'Food', date: '2026-10-01', note: 'Lunch' }], goals: [{ id: 'g', name: 'Car', target: 10000, saved: 500 }] });
  assert.equal(error, undefined);
  assert.equal(data.v, DATA_VERSION);
  assert.equal(data.transactions[0].amount, 1999);
  assert.equal(data.goals[0].name, 'Car');
});

test('parseBackup migrates a v1 (dollar) backup', () => {
  const { data } = parseBackup({ transactions: [{ type: 'income', amount: 12.5, category: 'Gift', date: '2026-01-02' }], goals: [] });
  assert.equal(data.transactions[0].amount, 1250);
});

test('parseBackup rejects files that are not backups', () => {
  assert.match(parseBackup(null).error, /not a Ledger backup/);
  assert.match(parseBackup([]).error, /not a Ledger backup/);
  assert.match(parseBackup({ foo: 1 }).error, /no transactions or goals/);
  assert.match(parseBackup({ v: 99, transactions: [], goals: [] }).error, /newer version/);
  assert.match(parseBackup({ transactions: [{ type: 'expense', amount: 5, date: 'yesterday' }], goals: [] }).error, /Transaction 1/);
  assert.match(parseBackup({ transactions: [], goals: [{ name: 'x', target: 'lots', saved: 0 }] }).error, /Goal 1/);
});

test('transactionsToCSV quotes fields, sorts by date and defuses formulas', () => {
  const csv = transactionsToCSV([
    { date: '2026-10-02', type: 'expense', category: 'Food', amount: 1999, note: 'Lunch, "big"' },
    { date: '2026-10-01', type: 'income', category: 'Gift', amount: 5000, note: '=HYPERLINK("x")' }
  ]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], '"date","type","category","amount","note"');
  assert.equal(lines[1], '"2026-10-01","income","Gift","50.00","\'=HYPERLINK(""x"")"');
  assert.equal(lines[2], '"2026-10-02","expense","Food","19.99","Lunch, ""big"""');
});

test('parseBackup keeps a valid currency setting and drops an unknown one', () => {
  assert.equal(parseBackup({ transactions: [], goals: [], settings: { currency: 'EUR' } }).data.settings.currency, 'EUR');
  assert.equal(parseBackup({ transactions: [], goals: [], settings: { currency: 'BTC' } }).data.settings.currency, undefined);
});

test('filterTransactions matches note/category text and type/category filters', () => {
  const data = [
    { id: 1, type: 'expense', category: 'Food', note: 'Groceries at Metro' },
    { id: 2, type: 'expense', category: 'Transport', note: '' },
    { id: 3, type: 'income', category: 'Salary', note: 'Paycheck' },
    { id: 4, type: 'expense', category: 'Food', note: 'Lunch' }
  ];
  const ids = f => filterTransactions(data, f).map(t => t.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4]);
  assert.deepEqual(ids({ query: 'metro' }), [1]);
  assert.deepEqual(ids({ query: '  FOOD ' }), [1, 4]);          // category text, trimmed, case-insensitive
  assert.deepEqual(ids({ type: 'income' }), [3]);
  assert.deepEqual(ids({ category: 'Food', query: 'lunch' }), [4]);
  assert.deepEqual(ids({ type: 'income', category: 'Food' }), []);
});

test('currentMonthByCategory sums only current-month expenses per category', () => {
  const data = [
    { type: 'expense', amount: 1000, category: 'Food', date: '2026-10-05' },
    { type: 'expense', amount: 2000, category: 'Food', date: '2026-10-18' },
    { type: 'expense', amount: 500, category: 'Transport', date: '2026-10-10' },
    { type: 'expense', amount: 9999, category: 'Food', date: '2026-09-30' },   // previous month
    { type: 'income', amount: 5000, category: 'Salary', date: '2026-10-01' }   // income ignored
  ];
  const result = currentMonthByCategory(data, new Date(2026, 9, 20));   // Oct 2026
  assert.deepEqual(result, { Food: 3000, Transport: 500 });
});

test('parseBackup round-trip preserves recurring, budgets, and custom categories', () => {
  const backup = {
    v: DATA_VERSION,
    transactions: [{ id: 't1', type: 'expense', amount: 500, category: 'Food', date: '2026-10-01', note: '' }],
    goals: [{ id: 'g1', name: 'Car', target: 100000, saved: 5000 }],
    recurring: [{ id: 'r1', type: 'expense', amount: 2000, category: 'Rent', day: 1, note: 'Monthly rent' }],
    recurringGenerated: { '2026-10': true },
    settings: {
      currency: 'EUR',
      budgets: { Food: 50000, Transport: 20000 },
      customExpenseCats: ['Pets', 'Gym'],
      customIncomeCats: ['Freelance']
    }
  };
  const { data, error } = parseBackup(backup);
  assert.equal(error, undefined);
  assert.deepEqual(data.recurring, backup.recurring);
  assert.deepEqual(data.recurringGenerated, backup.recurringGenerated);
  assert.equal(data.settings.currency, 'EUR');
  assert.deepEqual(data.settings.budgets, { Food: 50000, Transport: 20000 });
  assert.deepEqual(data.settings.customExpenseCats, ['Pets', 'Gym']);
  assert.deepEqual(data.settings.customIncomeCats, ['Freelance']);
});
