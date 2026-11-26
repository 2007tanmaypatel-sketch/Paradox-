/**
 * Pure pricing, rate-card lookup, bonus calculation, and reporting helpers
 * for the Dairy Milk Collection web application.
 */

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatStepKey(value) {
  return Number(value).toFixed(1);
}

/**
 * Generates a realistic default Fat x SNF rate chart and bonus slabs.
 */
function createDefaultRateCard() {
  const fatSteps = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0];
  const snfSteps = [7.5, 8.0, 8.5, 9.0, 9.5];
  const rates = {};

  for (const fat of fatSteps) {
    const fatKey = formatStepKey(fat);
    rates[fatKey] = {};
    for (const snf of snfSteps) {
      const snfKey = formatStepKey(snf);
      // Realistic dairy pricing curve (₹/L): base + fat contribution + SNF contribution
      const price = 14 + fat * 4.8 + snf * 1.4;
      rates[fatKey][snfKey] = round2(price);
    }
  }

  return {
    fatSteps,
    snfSteps,
    rates,
    bonusRules: [
      { minQuantity: 20, bonusPerLiter: 2.0, label: 'High Quantity Tier 1 (20+ L)' },
      { minQuantity: 40, bonusPerLiter: 3.5, label: 'High Quantity Tier 2 (40+ L)' }
    ]
  };
}

/**
 * Finds the matching step from a sorted ascending list using exact match
 * or highest slab <= target value (clamped to minimum step if below range).
 */
function matchStep(sortedSteps, target) {
  if (!Array.isArray(sortedSteps) || sortedSteps.length === 0) {
    throw new Error('Rate card steps cannot be empty.');
  }
  const num = Number(target);
  let matched = sortedSteps[0];
  for (const step of sortedSteps) {
    if (Math.abs(step - num) < 1e-6) {
      return step;
    }
    if (step <= num + 1e-9) {
      matched = step;
    } else {
      break;
    }
  }
  return matched;
}

/**
 * Looks up the per-liter rate from the rate card for given fat and SNF %.
 */
function lookupRate(rateCard, fat, snf) {
  const fatSteps = [...rateCard.fatSteps].map(Number).sort((a, b) => a - b);
  const snfSteps = [...rateCard.snfSteps].map(Number).sort((a, b) => a - b);

  const matchedFat = matchStep(fatSteps, fat);
  const matchedSnf = matchStep(snfSteps, snf);

  const fatKey = formatStepKey(matchedFat);
  const snfKey = formatStepKey(matchedSnf);

  const rate = rateCard.rates?.[fatKey]?.[snfKey];
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    throw new Error(`Missing rate for Fat ${fatKey}% and SNF ${snfKey}%`);
  }

  return {
    ratePerLiter: round2(rate),
    matchedFat,
    matchedSnf,
    exactMatch: Math.abs(matchedFat - Number(fat)) < 1e-6 && Math.abs(matchedSnf - Number(snf)) < 1e-6
  };
}

/**
 * Evaluates the highest applicable high-quantity bonus slab.
 */
function calculateBonus(bonusRules, quantity) {
  const qty = Number(quantity);
  if (!Array.isArray(bonusRules) || bonusRules.length === 0 || qty <= 0) {
    return {
      applied: false,
      bonusPerLiter: 0,
      bonusAmount: 0,
      ruleLabel: null,
      minQuantity: null
    };
  }

  const sortedRules = [...bonusRules]
    .map((r) => ({
      minQuantity: Number(r.minQuantity),
      bonusPerLiter: Number(r.bonusPerLiter),
      label: String(r.label || `Bonus (${r.minQuantity}+ L)`)
    }))
    .filter((r) => Number.isFinite(r.minQuantity) && Number.isFinite(r.bonusPerLiter) && r.minQuantity > 0 && r.bonusPerLiter > 0)
    .sort((a, b) => b.minQuantity - a.minQuantity);

  for (const rule of sortedRules) {
    if (qty >= rule.minQuantity) {
      return {
        applied: true,
        bonusPerLiter: round2(rule.bonusPerLiter),
        bonusAmount: round2(qty * rule.bonusPerLiter),
        ruleLabel: rule.label,
        minQuantity: rule.minQuantity
      };
    }
  }

  return {
    applied: false,
    bonusPerLiter: 0,
    bonusAmount: 0,
    ruleLabel: null,
    minQuantity: null
  };
}

/**
 * Computes full pricing breakdown for a milk collection entry.
 */
function calculateEntryPricing(rateCard, { quantity, fat, snf }) {
  const qty = Number(quantity);
  const fatVal = Number(fat);
  const snfVal = Number(snf);

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Quantity must be greater than 0 liters.');
  }
  if (!Number.isFinite(fatVal) || fatVal < 0 || fatVal > 20) {
    throw new Error('Fat % must be between 0 and 20.');
  }
  if (!Number.isFinite(snfVal) || snfVal < 0 || snfVal > 20) {
    throw new Error('SNF % must be between 0 and 20.');
  }

  const rateLookup = lookupRate(rateCard, fatVal, snfVal);
  const baseAmount = round2(qty * rateLookup.ratePerLiter);
  const bonus = calculateBonus(rateCard.bonusRules, qty);
  const totalAmount = round2(baseAmount + bonus.bonusAmount);

  return {
    quantity: round2(qty),
    fat: round2(fatVal),
    snf: round2(snfVal),
    ratePerLiter: rateLookup.ratePerLiter,
    matchedFat: rateLookup.matchedFat,
    matchedSnf: rateLookup.matchedSnf,
    exactMatch: rateLookup.exactMatch,
    baseAmount,
    bonusApplied: bonus.applied,
    bonusPerLiter: bonus.bonusPerLiter,
    bonusAmount: bonus.bonusAmount,
    bonusLabel: bonus.ruleLabel,
    totalAmount
  };
}

/**
 * Aggregates daily totals for a list of entries (typically filtered by date).
 */
function summarizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      entryCount: 0,
      farmerCount: 0,
      totalQuantity: 0,
      totalBaseAmount: 0,
      totalBonusAmount: 0,
      totalPayable: 0,
      avgFat: 0,
      avgSnf: 0,
      avgRate: 0,
      bonusEntriesCount: 0
    };
  }

  let totalQuantity = 0;
  let totalBaseAmount = 0;
  let totalBonusAmount = 0;
  let totalPayable = 0;
  let weightedFat = 0;
  let weightedSnf = 0;
  let bonusEntriesCount = 0;
  const farmers = new Set();

  for (const entry of entries) {
    const qty = Number(entry.quantity) || 0;
    totalQuantity += qty;
    totalBaseAmount += Number(entry.baseAmount) || 0;
    totalBonusAmount += Number(entry.bonusAmount) || 0;
    totalPayable += Number(entry.totalAmount) || 0;
    weightedFat += (Number(entry.fat) || 0) * qty;
    weightedSnf += (Number(entry.snf) || 0) * qty;
    if (entry.bonusApplied) {
      bonusEntriesCount += 1;
    }
    if (entry.farmerId) {
      farmers.add(String(entry.farmerId).toUpperCase());
    }
  }

  return {
    entryCount: entries.length,
    farmerCount: farmers.size,
    totalQuantity: round2(totalQuantity),
    totalBaseAmount: round2(totalBaseAmount),
    totalBonusAmount: round2(totalBonusAmount),
    totalPayable: round2(totalPayable),
    avgFat: totalQuantity > 0 ? round2(weightedFat / totalQuantity) : 0,
    avgSnf: totalQuantity > 0 ? round2(weightedSnf / totalQuantity) : 0,
    avgRate: totalQuantity > 0 ? round2(totalBaseAmount / totalQuantity) : 0,
    bonusEntriesCount
  };
}

/**
 * Validates and normalizes an updated rate card payload.
 */
function normalizeRateCard(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid rate card payload.');
  }

  const fatSteps = [...new Set((payload.fatSteps || []).map((v) => round2(Number(v))))]
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 20)
    .sort((a, b) => a - b);

  const snfSteps = [...new Set((payload.snfSteps || []).map((v) => round2(Number(v))))]
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 20)
    .sort((a, b) => a - b);

  if (fatSteps.length === 0 || snfSteps.length === 0) {
    throw new Error('Rate card must have at least one Fat % row and one SNF % column.');
  }

  const rates = {};
  for (const fat of fatSteps) {
    const fKey = formatStepKey(fat);
    rates[fKey] = {};
    for (const snf of snfSteps) {
      const sKey = formatStepKey(snf);
      const rawRate = payload.rates?.[fKey]?.[sKey];
      const numRate = Number(rawRate);
      if (!Number.isFinite(numRate) || numRate < 0) {
        throw new Error(`Invalid rate at Fat ${fKey}% / SNF ${sKey}%.`);
      }
      rates[fKey][sKey] = round2(numRate);
    }
  }

  const bonusRules = Array.isArray(payload.bonusRules)
    ? payload.bonusRules
        .map((rule) => ({
          minQuantity: round2(Number(rule.minQuantity)),
          bonusPerLiter: round2(Number(rule.bonusPerLiter)),
          label: String(rule.label || '').trim() || `High Quantity (${Number(rule.minQuantity)}+ L)`
        }))
        .filter((rule) => Number.isFinite(rule.minQuantity) && rule.minQuantity > 0 && Number.isFinite(rule.bonusPerLiter) && rule.bonusPerLiter >= 0)
        .sort((a, b) => a.minQuantity - b.minQuantity)
    : [];

  return { fatSteps, snfSteps, rates, bonusRules };
}

module.exports = {
  round2,
  formatStepKey,
  createDefaultRateCard,
  lookupRate,
  calculateBonus,
  calculateEntryPricing,
  summarizeEntries,
  normalizeRateCard
};
