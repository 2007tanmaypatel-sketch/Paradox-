(function () {
  const state = {
    today: new Date().toISOString().slice(0, 10),
    rateCard: null,
    dirtyCells: new Set(),
    entries: [],
    farmers: [],
    activeSlip: null
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  function formatINR(value) {
    const num = Number(value) || 0;
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatNum(value, decimals = 2) {
    return (Number(value) || 0).toFixed(decimals);
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer;
  function showToast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 3200);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  // Tab Navigation
  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Load initial health/today + data
  async function init() {
    try {
      const health = await api('/api/health');
      state.today = health.today;
    } catch {
      // Fallback to local date if health check lags
    }

    $('summaryDate').value = state.today;
    $('entryDate').value = state.today;
    $('slipFromDate').value = state.today;
    $('slipToDate').value = state.today;

    await Promise.all([loadRateCard(), loadFarmers(), loadDailySummary()]);
    updateLivePreview();
  }

  async function loadFarmers() {
    const data = await api('/api/farmers');
    state.farmers = data.farmers || [];

    const datalist = $('farmerList');
    datalist.innerHTML = state.farmers
      .map((f) => `<option value="${escapeHtml(f.farmerId)}">${escapeHtml(f.farmerName)}</option>`)
      .join('');

    const select = $('slipFarmerSelect');
    const prev = select.value;
    select.innerHTML = '<option value="">Select a farmer...</option>' +
      state.farmers
        .map((f) => `<option value="${escapeHtml(f.farmerId)}">${escapeHtml(f.farmerId)} — ${escapeHtml(f.farmerName)}</option>`)
        .join('');
    if (prev && state.farmers.some((f) => f.farmerId === prev)) {
      select.value = prev;
    }
  }

  async function loadDailySummary() {
    const date = $('summaryDate').value || state.today;
    const data = await api(`/api/summary?date=${encodeURIComponent(date)}`);
    state.entries = data.entries || [];
    renderKpis(data.summary);
    renderEntriesTable();
  }

  function renderKpis(summary) {
    $('kpiTotalQty').textContent = `${formatNum(summary.totalQuantity)} L`;
    $('kpiFarmers').textContent = `${summary.farmerCount} farmer${summary.farmerCount === 1 ? '' : 's'} · ${summary.entryCount} entr${summary.entryCount === 1 ? 'y' : 'ies'}`;
    $('kpiTotalPayable').textContent = formatINR(summary.totalPayable);
    $('kpiBaseAmount').textContent = `Base: ${formatINR(summary.totalBaseAmount)}`;
    $('kpiTotalBonus').textContent = formatINR(summary.totalBonusAmount);
    $('kpiBonusCount').textContent = `${summary.bonusEntriesCount} qualifying entr${summary.bonusEntriesCount === 1 ? 'y' : 'ies'}`;
    $('kpiAvgQuality').textContent = `${formatNum(summary.avgFat, 1)}% / ${formatNum(summary.avgSnf, 1)}%`;
    $('kpiAvgRate').textContent = `Avg Rate: ${formatINR(summary.avgRate)}/L`;
  }

  function renderEntriesTable() {
    const query = ($('farmerSearch').value || '').trim().toLowerCase();
    const date = $('summaryDate').value || state.today;
    $('registerSubtitle').textContent = `Collection date: ${date}`;

    const filtered = state.entries.filter((e) => {
      if (!query) return true;
      return (
        e.farmerId.toLowerCase().includes(query) ||
        e.farmerName.toLowerCase().includes(query)
      );
    });

    const tbody = $('entriesTableBody');
    const tfoot = $('entriesTableFoot');

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">No milk collection entries found for ${escapeHtml(date)}.</td></tr>`;
      tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = filtered
      .map((e) => {
        const bonusCell = e.bonusApplied
          ? `<span class="badge badge-bonus" title="${escapeHtml(e.bonusLabel || '')}">+${formatINR(e.bonusAmount)}</span>`
          : `<span class="muted">—</span>`;
        return `
          <tr>
            <td class="farmer-cell">
              <strong>${escapeHtml(e.farmerName)}</strong>
              <span>${escapeHtml(e.farmerId)}</span>
            </td>
            <td><span class="badge badge-shift">${escapeHtml(e.shift)}</span></td>
            <td class="num">${formatNum(e.quantity)}</td>
            <td class="num">${formatNum(e.fat, 1)}</td>
            <td class="num">${formatNum(e.snf, 1)}</td>
            <td class="num">${formatINR(e.ratePerLiter)}</td>
            <td class="num">${bonusCell}</td>
            <td class="num"><strong>${formatINR(e.totalAmount)}</strong></td>
            <td class="actions-col">
              <div class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-slip-id="${escapeHtml(e.id)}">Slip</button>
                <button type="button" class="btn btn-danger-ghost" data-delete-id="${escapeHtml(e.id)}" title="Delete entry">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    const totalQty = filtered.reduce((acc, e) => acc + e.quantity, 0);
    const totalBonus = filtered.reduce((acc, e) => acc + e.bonusAmount, 0);
    const totalPay = filtered.reduce((acc, e) => acc + e.totalAmount, 0);

    tfoot.innerHTML = `
      <tr>
        <td colspan="2">Filtered Total (${filtered.length})</td>
        <td class="num">${formatNum(totalQty)} L</td>
        <td colspan="3"></td>
        <td class="num">${formatINR(totalBonus)}</td>
        <td class="num">${formatINR(totalPay)}</td>
        <td></td>
      </tr>
    `;
  }

  // Event delegation for entry table actions
  $('entriesTableBody').addEventListener('click', async (event) => {
    const slipBtn = event.target.closest('[data-slip-id]');
    if (slipBtn) {
      const entryId = slipBtn.dataset.slipId;
      await openSlipByEntry(entryId);
      return;
    }

    const delBtn = event.target.closest('[data-delete-id]');
    if (delBtn) {
      const id = delBtn.dataset.deleteId;
      try {
        await api(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('Entry deleted.');
        await Promise.all([loadDailySummary(), loadFarmers()]);
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  $('summaryDate').addEventListener('change', loadDailySummary);
  $('farmerSearch').addEventListener('input', renderEntriesTable);

  // Auto-fill farmer name when existing ID is entered
  $('farmerId').addEventListener('input', () => {
    const val = $('farmerId').value.trim().toUpperCase();
    const match = state.farmers.find((f) => f.farmerId.toUpperCase() === val);
    if (match) {
      $('farmerName').value = match.farmerName;
    }
  });

  // Live pricing preview
  let previewSeq = 0;
  async function updateLivePreview() {
    const qty = Number($('quantity').value);
    const fat = Number($('fat').value);
    const snf = Number($('snf').value);

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(fat) || $('fat').value === '' || !Number.isFinite(snf) || $('snf').value === '') {
      $('previewMatchedSlab').textContent = 'Enter Qty, Fat & SNF';
      $('previewRate').textContent = '₹0.00';
      $('previewBase').textContent = '₹0.00';
      $('previewBonus').textContent = '₹0.00';
      $('previewTotal').textContent = '₹0.00';
      $('previewBonusNote').textContent = getNextBonusHint(0);
      return;
    }

    const seq = ++previewSeq;
    try {
      const pricing = await api('/api/calculate', {
        method: 'POST',
        body: JSON.stringify({ quantity: qty, fat, snf })
      });
      if (seq !== previewSeq) return;

      const matchType = pricing.exactMatch ? 'Exact' : 'Slab';
      $('previewMatchedSlab').textContent = `${matchType}: Fat ${pricing.matchedFat.toFixed(1)}% × SNF ${pricing.matchedSnf.toFixed(1)}%`;
      $('previewRate').textContent = `${formatINR(pricing.ratePerLiter)}/L`;
      $('previewBase').textContent = formatINR(pricing.baseAmount);
      $('previewBonus').textContent = pricing.bonusApplied
        ? `+${formatINR(pricing.bonusAmount)} (+₹${pricing.bonusPerLiter.toFixed(2)}/L)`
        : '₹0.00';
      $('previewTotal').textContent = formatINR(pricing.totalAmount);
      $('previewBonusNote').textContent = pricing.bonusApplied
        ? `Bonus applied: ${pricing.bonusLabel}`
        : getNextBonusHint(qty);
    } catch (err) {
      $('previewMatchedSlab').textContent = 'Check input';
      $('previewBonusNote').textContent = err.message;
    }
  }

  function getNextBonusHint(qty) {
    const rules = state.rateCard?.bonusRules || [];
    if (rules.length === 0) return 'No high-quantity bonus rules configured.';
    const sorted = [...rules].sort((a, b) => a.minQuantity - b.minQuantity);
    const next = sorted.find((r) => qty < r.minQuantity);
    if (!next) return '';
    return `Tip: Log ${next.minQuantity}+ L to earn +${formatINR(next.bonusPerLiter)}/L high-quantity bonus.`;
  }

  ['quantity', 'fat', 'snf'].forEach((id) => {
    $(id).addEventListener('input', updateLivePreview);
  });

  // Log Entry Submit
  $('entryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      date: $('entryDate').value,
      shift: $('entryShift').value,
      farmerId: $('farmerId').value.trim(),
      farmerName: $('farmerName').value.trim(),
      quantity: Number($('quantity').value),
      fat: Number($('fat').value),
      snf: Number($('snf').value)
    };

    try {
      const res = await api('/api/entries', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(`Logged ${formatNum(res.entry.quantity)} L for ${res.entry.farmerName} (${formatINR(res.entry.totalAmount)})`);

      // Sync daily view to the logged entry date so the user immediately sees the updated daily total
      $('summaryDate').value = res.entry.date;
      $('quantity').value = '';
      $('fat').value = '';
      $('snf').value = '';
      updateLivePreview();
      await Promise.all([loadDailySummary(), loadFarmers()]);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Payout Slip Generation
  async function openSlipByEntry(entryId) {
    try {
      const slip = await api(`/api/payout-slip?entryId=${encodeURIComponent(entryId)}`);
      renderPayoutSlip(slip);
      switchTab('slip');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  $('slipFilterForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const farmerId = $('slipFarmerSelect').value;
    const from = $('slipFromDate').value;
    const to = $('slipToDate').value;

    if (!farmerId) {
      showToast('Please select a farmer.', true);
      return;
    }

    const params = new URLSearchParams({ farmerId });
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
      const slip = await api(`/api/payout-slip?${params.toString()}`);
      renderPayoutSlip(slip);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  function renderPayoutSlip(slip) {
    state.activeSlip = slip;
    $('printSlipBtn').disabled = false;

    const generatedLocal = new Date(slip.generatedAt).toLocaleString();
    const rowsHtml = slip.items
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.shift)}</td>
          <td class="num">${formatNum(item.quantity)}</td>
          <td class="num">${formatNum(item.fat, 1)}</td>
          <td class="num">${formatNum(item.snf, 1)}</td>
          <td class="num">${formatINR(item.ratePerLiter)}</td>
          <td class="num">${formatINR(item.baseAmount)}</td>
          <td class="num">${item.bonusApplied ? `+${formatINR(item.bonusAmount)}` : '—'}</td>
          <td class="num"><strong>${formatINR(item.totalAmount)}</strong></td>
        </tr>
      `)
      .join('');

    const container = $('slipContainer');
    container.className = 'slip-sheet';
    container.innerHTML = `
      <div class="slip-top">
        <div>
          <h2>PARADOX DAIRY COLLECTION CENTER</h2>
          <p class="muted">Official Farmer Milk Payout Slip</p>
        </div>
        <div style="text-align:right">
          <strong>${escapeHtml(slip.slipNumber)}</strong>
          <p class="muted small">Generated: ${escapeHtml(generatedLocal)}</p>
        </div>
      </div>

      <div class="slip-meta-grid">
        <div>
          <span>Farmer Name</span>
          <strong>${escapeHtml(slip.farmerName)}</strong>
        </div>
        <div>
          <span>Farmer ID</span>
          <strong>${escapeHtml(slip.farmerId)}</strong>
        </div>
        <div>
          <span>Period</span>
          <strong>${escapeHtml(slip.periodFrom)} to ${escapeHtml(slip.periodTo)}</strong>
        </div>
        <div>
          <span>Avg Quality (Fat / SNF)</span>
          <strong>${formatNum(slip.summary.avgFat, 1)}% / ${formatNum(slip.summary.avgSnf, 1)}%</strong>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Shift</th>
              <th class="num">Qty (L)</th>
              <th class="num">Fat %</th>
              <th class="num">SNF %</th>
              <th class="num">Rate/L</th>
              <th class="num">Base</th>
              <th class="num">Bonus</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div class="slip-summary-box">
        <div class="slip-summary-row">
          <span>Total Entries</span>
          <strong>${slip.summary.entryCount}</strong>
        </div>
        <div class="slip-summary-row">
          <span>Total Milk Supplied</span>
          <strong>${formatNum(slip.summary.totalQuantity)} L</strong>
        </div>
        <div class="slip-summary-row">
          <span>Gross Base Amount</span>
          <strong>${formatINR(slip.summary.totalBaseAmount)}</strong>
        </div>
        <div class="slip-summary-row">
          <span>High-Quantity Bonus</span>
          <strong class="bonus-text">+ ${formatINR(slip.summary.totalBonusAmount)}</strong>
        </div>
        <div class="slip-summary-row grand">
          <span>Net Payable</span>
          <span>${formatINR(slip.summary.totalPayable)}</span>
        </div>
      </div>

      <div class="slip-signatures">
        <div class="sig-line">Farmer Signature</div>
        <div class="sig-line">Collection Center Manager</div>
      </div>
    `;
  }

  $('printSlipBtn').addEventListener('click', () => {
    window.print();
  });

  // Rate Card & Bonus Editor
  async function loadRateCard() {
    state.rateCard = await api('/api/rate-card');
    state.dirtyCells.clear();
    renderBonusRules();
    renderRateMatrix();
  }

  function renderBonusRules() {
    const list = $('bonusRulesList');
    const rules = state.rateCard.bonusRules || [];

    if (rules.length === 0) {
      list.innerHTML = `<p class="muted small">No bonus tiers configured. Click "+ Add Tier" to create one.</p>`;
      return;
    }

    list.innerHTML = rules
      .map((rule, idx) => `
        <div class="bonus-rule-row" data-rule-idx="${idx}">
          <div class="field">
            <label>Min Quantity (L)</label>
            <input type="number" step="0.5" min="1" class="bonus-min-qty" value="${rule.minQuantity}" />
          </div>
          <div class="field">
            <label>Bonus (₹ / Liter)</label>
            <input type="number" step="0.25" min="0" class="bonus-per-liter" value="${rule.bonusPerLiter}" />
          </div>
          <div class="field">
            <label>Tier Label</label>
            <input type="text" class="bonus-label" value="${escapeHtml(rule.label)}" />
          </div>
          <button type="button" class="btn btn-danger-ghost remove-bonus-btn">Remove</button>
        </div>
      `)
      .join('');
  }

  $('bonusRulesList').addEventListener('input', (event) => {
    const row = event.target.closest('.bonus-rule-row');
    if (!row) return;
    const idx = Number(row.dataset.ruleIdx);
    const rule = state.rateCard.bonusRules[idx];
    if (!rule) return;

    if (event.target.classList.contains('bonus-min-qty')) {
      rule.minQuantity = Number(event.target.value);
    } else if (event.target.classList.contains('bonus-per-liter')) {
      rule.bonusPerLiter = Number(event.target.value);
    } else if (event.target.classList.contains('bonus-label')) {
      rule.label = event.target.value;
    }
  });

  $('bonusRulesList').addEventListener('click', (event) => {
    const btn = event.target.closest('.remove-bonus-btn');
    if (!btn) return;
    const idx = Number(btn.closest('.bonus-rule-row').dataset.ruleIdx);
    state.rateCard.bonusRules.splice(idx, 1);
    renderBonusRules();
  });

  $('addBonusRuleBtn').addEventListener('click', () => {
    const existing = state.rateCard.bonusRules;
    const nextQty = existing.length > 0 ? Math.max(...existing.map((r) => r.minQuantity)) + 10 : 20;
    existing.push({
      minQuantity: nextQty,
      bonusPerLiter: 2.0,
      label: `Bulk Tier (${nextQty}+ L)`
    });
    renderBonusRules();
  });

  function renderRateMatrix() {
    const table = $('rateMatrixTable');
    const { fatSteps, snfSteps, rates } = state.rateCard;

    const headerCols = snfSteps
      .map((snf) => {
        const sKey = snf.toFixed(1);
        return `
          <th>
            <span class="step-header">
              SNF ${sKey}%
              ${snfSteps.length > 1 ? `<button type="button" class="remove-step-btn" data-remove-snf="${snf}" title="Remove SNF column">×</button>` : ''}
            </span>
          </th>
        `;
      })
      .join('');

    const bodyRows = fatSteps
      .map((fat) => {
        const fKey = fat.toFixed(1);
        const cells = snfSteps
          .map((snf) => {
            const sKey = snf.toFixed(1);
            const cellKey = `${fKey}|${sKey}`;
            const val = rates[fKey]?.[sKey] ?? 0;
            const dirtyClass = state.dirtyCells.has(cellKey) ? ' dirty' : '';
            return `
              <td>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  class="rate-cell-input${dirtyClass}"
                  data-fat="${fKey}"
                  data-snf="${sKey}"
                  value="${Number(val).toFixed(2)}"
                />
              </td>
            `;
          })
          .join('');

        return `
          <tr>
            <th>
              <span class="step-header">
                Fat ${fKey}%
                ${fatSteps.length > 1 ? `<button type="button" class="remove-step-btn" data-remove-fat="${fat}" title="Remove Fat row">×</button>` : ''}
              </span>
            </th>
            ${cells}
          </tr>
        `;
      })
      .join('');

    table.innerHTML = `
      <thead>
        <tr>
          <th class="corner-cell">Fat \\ SNF</th>
          ${headerCols}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    `;
  }

  $('rateMatrixTable').addEventListener('input', (event) => {
    const input = event.target.closest('.rate-cell-input');
    if (!input) return;
    const fKey = input.dataset.fat;
    const sKey = input.dataset.snf;
    const val = Number(input.value);
    if (!state.rateCard.rates[fKey]) state.rateCard.rates[fKey] = {};
    state.rateCard.rates[fKey][sKey] = Number.isFinite(val) ? val : 0;
    state.dirtyCells.add(`${fKey}|${sKey}`);
    input.classList.add('dirty');
  });

  $('rateMatrixTable').addEventListener('click', (event) => {
    const remFat = event.target.closest('[data-remove-fat]');
    if (remFat) {
      const target = Number(remFat.dataset.removeFat);
      state.rateCard.fatSteps = state.rateCard.fatSteps.filter((v) => Math.abs(v - target) > 1e-6);
      delete state.rateCard.rates[target.toFixed(1)];
      renderRateMatrix();
      return;
    }

    const remSnf = event.target.closest('[data-remove-snf]');
    if (remSnf) {
      const target = Number(remSnf.dataset.removeSnf);
      const sKey = target.toFixed(1);
      state.rateCard.snfSteps = state.rateCard.snfSteps.filter((v) => Math.abs(v - target) > 1e-6);
      for (const fKey of Object.keys(state.rateCard.rates)) {
        delete state.rateCard.rates[fKey][sKey];
      }
      renderRateMatrix();
    }
  });

  $('addFatBtn').addEventListener('click', () => {
    const val = Number($('newFatStep').value);
    if (!Number.isFinite(val) || val < 0 || val > 20) {
      showToast('Enter a valid Fat % between 0 and 20.', true);
      return;
    }
    const fKey = val.toFixed(1);
    if (state.rateCard.fatSteps.some((v) => v.toFixed(1) === fKey)) {
      showToast(`Fat ${fKey}% row already exists.`, true);
      return;
    }
    const nearestFat = state.rateCard.fatSteps[state.rateCard.fatSteps.length - 1].toFixed(1);
    state.rateCard.fatSteps = [...state.rateCard.fatSteps, Number(fKey)].sort((a, b) => a - b);
    state.rateCard.rates[fKey] = {};
    for (const snf of state.rateCard.snfSteps) {
      const sKey = snf.toFixed(1);
      state.rateCard.rates[fKey][sKey] = Number(state.rateCard.rates[nearestFat]?.[sKey] ?? 35);
      state.dirtyCells.add(`${fKey}|${sKey}`);
    }
    $('newFatStep').value = '';
    renderRateMatrix();
  });

  $('addSnfBtn').addEventListener('click', () => {
    const val = Number($('newSnfStep').value);
    if (!Number.isFinite(val) || val < 0 || val > 20) {
      showToast('Enter a valid SNF % between 0 and 20.', true);
      return;
    }
    const sKey = val.toFixed(1);
    if (state.rateCard.snfSteps.some((v) => v.toFixed(1) === sKey)) {
      showToast(`SNF ${sKey}% column already exists.`, true);
      return;
    }
    const nearestSnf = state.rateCard.snfSteps[state.rateCard.snfSteps.length - 1].toFixed(1);
    state.rateCard.snfSteps = [...state.rateCard.snfSteps, Number(sKey)].sort((a, b) => a - b);
    for (const fat of state.rateCard.fatSteps) {
      const fKey = fat.toFixed(1);
      state.rateCard.rates[fKey][sKey] = Number(state.rateCard.rates[fKey]?.[nearestSnf] ?? 35);
      state.dirtyCells.add(`${fKey}|${sKey}`);
    }
    $('newSnfStep').value = '';
    renderRateMatrix();
  });

  $('applyBulkDeltaBtn').addEventListener('click', () => {
    const delta = Number($('bulkDelta').value);
    if (!Number.isFinite(delta) || delta === 0) {
      showToast('Enter a non-zero ₹/L amount to adjust all cells.', true);
      return;
    }
    for (const fat of state.rateCard.fatSteps) {
      const fKey = fat.toFixed(1);
      for (const snf of state.rateCard.snfSteps) {
        const sKey = snf.toFixed(1);
        const nextVal = Math.max(0, Number(state.rateCard.rates[fKey][sKey]) + delta);
        state.rateCard.rates[fKey][sKey] = Math.round(nextVal * 100) / 100;
        state.dirtyCells.add(`${fKey}|${sKey}`);
      }
    }
    $('bulkDelta').value = '';
    renderRateMatrix();
    showToast(`Adjusted all rates by ${delta > 0 ? '+' : ''}₹${delta.toFixed(2)}/L. Click Save Changes to persist.`);
  });

  $('saveRateCardBtn').addEventListener('click', async () => {
    try {
      const updated = await api('/api/rate-card', {
        method: 'PUT',
        body: JSON.stringify(state.rateCard)
      });
      state.rateCard = updated;
      state.dirtyCells.clear();
      renderBonusRules();
      renderRateMatrix();
      updateLivePreview();
      showToast('Rate chart and bonus rules saved!');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('resetRateCardBtn').addEventListener('click', async () => {
    try {
      const reset = await api('/api/rate-card/reset', { method: 'POST' });
      state.rateCard = reset;
      state.dirtyCells.clear();
      renderBonusRules();
      renderRateMatrix();
      updateLivePreview();
      showToast('Rate chart reset to defaults.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  init().catch((err) => showToast(err.message, true));
})();
