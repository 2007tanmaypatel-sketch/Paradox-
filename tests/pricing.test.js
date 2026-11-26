const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  createDefaultRateCard,
  lookupRate,
  calculateBonus,
  calculateEntryPricing,
  summarizeEntries,
  normalizeRateCard
} = require('../src/pricing');
const { DairyStore } = require('../src/store');
const { createServer } = require('../server');

test('lookupRate returns exact match and floor-bracket match', () => {
  const card = createDefaultRateCard();
  const exact = lookupRate(card, 4.5, 8.5);
  assert.equal(exact.exactMatch, true);
  assert.equal(exact.matchedFat, 4.5);
  assert.equal(exact.matchedSnf, 8.5);
  assert.equal(exact.ratePerLiter, card.rates['4.5']['8.5']);

  const bracket = lookupRate(card, 4.8, 8.7);
  assert.equal(bracket.exactMatch, false);
  assert.equal(bracket.matchedFat, 4.5);
  assert.equal(bracket.matchedSnf, 8.5);
  assert.equal(bracket.ratePerLiter, card.rates['4.5']['8.5']);
});

test('calculateBonus applies highest qualifying slab for high quantity', () => {
  const card = createDefaultRateCard();

  const none = calculateBonus(card.bonusRules, 15);
  assert.equal(none.applied, false);
  assert.equal(none.bonusAmount, 0);

  const tier1 = calculateBonus(card.bonusRules, 25);
  assert.equal(tier1.applied, true);
  assert.equal(tier1.bonusPerLiter, 2.0);
  assert.equal(tier1.bonusAmount, 50.0);

  const tier2 = calculateBonus(card.bonusRules, 40);
  assert.equal(tier2.applied, true);
  assert.equal(tier2.bonusPerLiter, 3.5);
  assert.equal(tier2.bonusAmount, 140.0);
});

test('calculateEntryPricing and summarizeEntries compute accurate totals', () => {
  const card = createDefaultRateCard();
  const p1 = calculateEntryPricing(card, { quantity: 10, fat: 4.0, snf: 8.5 });
  const p2 = calculateEntryPricing(card, { quantity: 20, fat: 5.0, snf: 9.0 });

  assert.equal(p1.bonusApplied, false);
  assert.equal(p2.bonusApplied, true);
  assert.equal(p2.bonusAmount, 40);

  const summary = summarizeEntries([
    { farmerId: 'F-1', ...p1 },
    { farmerId: 'F-2', ...p2 }
  ]);

  assert.equal(summary.entryCount, 2);
  assert.equal(summary.farmerCount, 2);
  assert.equal(summary.totalQuantity, 30);
  assert.equal(summary.totalBonusAmount, 40);
  assert.equal(summary.totalPayable, Number((p1.totalAmount + p2.totalAmount).toFixed(2)));
});

test('normalizeRateCard validates and sorts steps and bonus rules', () => {
  const updated = normalizeRateCard({
    fatSteps: [5.0, 4.0],
    snfSteps: [8.5, 8.0],
    rates: {
      '4.0': { '8.0': 41.25, '8.5': 42.5 },
      '5.0': { '8.0': 46.0, '8.5': 47.75 }
    },
    bonusRules: [{ minQuantity: 30, bonusPerLiter: 2.5, label: 'Bulk 30+' }]
  });

  assert.deepEqual(updated.fatSteps, [4.0, 5.0]);
  assert.deepEqual(updated.snfSteps, [8.0, 8.5]);
  assert.equal(updated.rates['4.0']['8.5'], 42.5);
  assert.equal(updated.bonusRules[0].minQuantity, 30);
});

test('HTTP API end-to-end flow: log entry, daily summary, rate card update, payout slip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dairy-test-'));
  const store = new DairyStore(path.join(tmpDir, 'store.json'));
  const server = createServer(store);

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Add a high-quantity entry
    const createRes = await fetch(`${baseUrl}/api/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmerId: 'F-999',
        farmerName: 'Kiran Desai',
        date: '2026-11-26',
        shift: 'Morning',
        quantity: 25,
        fat: 5.0,
        snf: 8.5
      })
    });
    assert.equal(createRes.status, 201);
    const createdJson = await createRes.json();
    assert.equal(createdJson.entry.bonusApplied, true);
    assert.equal(createdJson.entry.bonusAmount, 50);

    // 2. Check daily summary for 2026-11-26
    const sumRes = await fetch(`${baseUrl}/api/summary?date=2026-11-26`);
    assert.equal(sumRes.status, 200);
    const sumJson = await sumRes.json();
    assert.ok(sumJson.summary.totalQuantity >= 25);

    // 3. Generate payout slip for F-999
    const slipRes = await fetch(`${baseUrl}/api/payout-slip?farmerId=F-999&from=2026-11-26&to=2026-11-26`);
    assert.equal(slipRes.status, 200);
    const slipJson = await slipRes.json();
    assert.equal(slipJson.farmerId, 'F-999');
    assert.equal(slipJson.summary.totalBonusAmount, 50);

    // 4. Edit rate card and verify new calculation
    const cardRes = await fetch(`${baseUrl}/api/rate-card`);
    const card = await cardRes.json();
    card.rates['5.0']['8.5'] = 99.0;
    const putRes = await fetch(`${baseUrl}/api/rate-card`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });
    assert.equal(putRes.status, 200);

    const calcRes = await fetch(`${baseUrl}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 10, fat: 5.0, snf: 8.5 })
    });
    const calcJson = await calcRes.json();
    assert.equal(calcJson.ratePerLiter, 99.0);
    assert.equal(calcJson.baseAmount, 990.0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
