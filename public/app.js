(function () {
  const state = {
    today: new Date().toISOString().slice(0, 10),
    rateCard: null,
    dirtyCells: new Set(),
    entries: [],
    farmers: [],
    shiftFilter: 'ALL',
    activeSlip: null
  };

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

  // Sidebar Navigation
  function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Shift Segmented Toggle in Entry Form
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $('entryShift').value = btn.dataset.shift;
    });
  });

  // Shift Filter in Register
  document.querySelectorAll('.shift-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shift-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.shiftFilter = btn.dataset.filterShift;
      renderEntriesTable();
    });
  });

  async function init() {
    try {
      const health = await api('/api/health');
      state.today = health.today;
    } catch {
      // Fallback to local date
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

    $('farmerList').innerHTML = state.farmers
      .map((f) => `<option value="${escapeHtml(f.farmerId)}">${escapeHtml(f.farmerName)}</option>`)
      .join('');

    const select = $('slipFarmerSelect');
    const prev = select.value;
    select.innerHTML =
      '<option value="">Select farmer...</option>' +
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
    $('kpiBaseAmountVal').textContent = formatINR(summary.totalBaseAmount);
    $('kpiAvgRate').textContent = `Avg rate: ${formatINR(summary.avgRate)}/L`;
    $('kpiTotalBonus').textContent = formatINR(summary.totalBonusAmount);
    $('kpiBonusCount').textContent = `${summary.bonusEntriesCount} qualifying entr${summary.bonusEntriesCount === 1 ? 'y' : 'ies'}`;
    $('kpiTotalPayable').textContent = formatINR(summary.totalPayable);
    $('kpiAvgQuality').textContent = `Weighted Avg: ${formatNum(summary.avgFat, 1)}% Fat · ${formatNum(summary.avgSnf, 1)}% SNF`;
  }

  function renderEntriesTable() {
    const query = ($('farmerSearch').value || '').trim().toLowerCase();
    const date = $('summaryDate').value || state.today;
    $('registerSubtitle').textContent = `Ledger date ${date}`;

    const filtered = state.entries.filter((e) => {
      if (state.shiftFilter !== 'ALL' && e.shift !== state.shiftFilter) {
        return false;
      }
      if (!query) return true;
      return (
        e.farmerId.toLowerCase().includes(query) ||
        e.farmerName.toLowerCase().includes(query)
      );
    });

    const tbody = $('entriesTableBody');
    const tfoot = $('entriesTableFoot');

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No collection entries match the selected filter for ${escapeHtml(date)}.</td></tr>`;
      tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = filtered
      .map((e) => {
        const bonusCell = e.bonusApplied
          ? `<span class="bonus-pill" title="${escapeHtml(e.bonusLabel || '')}">+${formatINR(e.bonusAmount)}</span>`
          : `<span style="color:var(--ink-muted)">—</span>`;
        return `
          <tr>
            <td>
              <div class="farmer-cell">
                <span class="farmer-code-pill">${escapeHtml(e.farmerId)}</span>
                <span class="farmer-name-text">${escapeHtml(e.farmerName)}</span>
              </div>
            </td>
            <td><span class="shift-tag">${escapeHtml(e.shift)}</span></td>
            <td class="num">${formatNum(e.quantity)}</td>
            <td class="num">${formatNum(e.fat, 1)}%</td>
            <td class="num">${formatNum(e.snf, 1)}%</td>
            <td class="num">${formatINR(e.ratePerLiter)}</td>
            <td class="num">${bonusCell}</td>
            <td class="num"><strong>${formatINR(e.totalAmount)}</strong></td>
            <td class="actions-col">
              <div class="row-actions">
                <button type="button" class="btn btn-outline btn-sm" data-slip-id="${escapeHtml(e.id)}">Slip</button>
                <button type="button" class="btn-icon-danger" data-delete-id="${escapeHtml(e.id)}" title="Delete entry" aria-label="Delete entry">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
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
        <td colspan="2">Total (${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'})</td>
        <td class="num">${formatNum(totalQty)} L</td>
        <td colspan="3"></td>
        <td class="num">${formatINR(totalBonus)}</td>
        <td class="num">${formatINR(totalPay)}</td>
        <td></td>
      </tr>
    `;
  }

  $('entriesTableBody').addEventListener('click', async (event) => {
    const slipBtn = event.target.closest('[data-slip-id]');
    if (slipBtn) {
      await openSlipByEntry(slipBtn.dataset.slipId);
      return;
    }

    const delBtn = event.target.closest('[data-delete-id]');
    if (delBtn) {
      const id = delBtn.dataset.deleteId;
      try {
        await api(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('Entry removed from ledger.');
        await Promise.all([loadDailySummary(), loadFarmers()]);
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  $('summaryDate').addEventListener('change', loadDailySummary);
  $('farmerSearch').addEventListener('input', renderEntriesTable);

  $('farmerId').addEventListener('input', () => {
    const val = $('farmerId').value.trim().toUpperCase();
    const match = state.farmers.find((f) => f.farmerId.toUpperCase() === val);
    if (match) {
      $('farmerName').value = match.farmerName;
    }
  });

  let previewSeq = 0;
  async function updateLivePreview() {
    const qty = Number($('quantity').value);
    const fat = Number($('fat').value);
    const snf = Number($('snf').value);

    if (!Number.isFinite(qty) || qty <= 0 || $('fat').value === '' || $('snf').value === '' || !Number.isFinite(fat) || !Number.isFinite(snf)) {
      $('previewMatchedSlab').textContent = '—';
      $('previewRate').textContent = '₹0.00 / L';
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

      const matchKind = pricing.exactMatch ? 'Exact' : 'Slab';
      $('previewMatchedSlab').textContent = `${matchKind} ${pricing.matchedFat.toFixed(1)}% / ${pricing.matchedSnf.toFixed(1)}%`;
      $('previewRate').textContent = `${formatINR(pricing.ratePerLiter)} / L`;
      $('previewBase').textContent = formatINR(pricing.baseAmount);
      $('previewBonus').textContent = pricing.bonusApplied
        ? `+${formatINR(pricing.bonusAmount)} (+₹${pricing.bonusPerLiter.toFixed(2)}/L)`
        : '₹0.00';
      $('previewTotal').textContent = formatINR(pricing.totalAmount);
      $('previewBonusNote').textContent = pricing.bonusApplied
        ? `Applied: ${pricing.bonusLabel}`
        : getNextBonusHint(qty);
    } catch (err) {
      $('previewMatchedSlab').textContent = 'Invalid';
      $('previewBonusNote').textContent = err.message;
    }
  }

  function getNextBonusHint(qty) {
    const rules = state.rateCard?.bonusRules || [];
    if (rules.length === 0) return 'No volume bonus tiers configured.';
    const sorted = [...rules].sort((a, b) => a.minQuantity - b.minQuantity);
    const next = sorted.find((r) => qty < r.minQuantity);
    if (!next) return '';
    return `Volume incentive: ${next.minQuantity}+ L earns +${formatINR(next.bonusPerLiter)}/L.`;
  }

  ['quantity', 'fat', 'snf'].forEach((id) => {
    $(id).addEventListener('input', updateLivePreview);
  });

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
      showToast(`Saved ${formatNum(res.entry.quantity)} L for ${res.entry.farmerName} (${formatINR(res.entry.totalAmount)})`);
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

  async function openSlipByEntry(entryId) {
    try {
      const slip = await api(`/api/payout-slip?entryId=${encodeURIComponent(entryId)}`);
      if ($('slipFarmerSelect').querySelector(`option[value="${CSS.escape(slip.farmerId)}"]`)) {
        $('slipFarmerSelect').value = slip.farmerId;
      }
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
      showToast('Select a farmer first.', true);
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
          <td class="mono">${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.shift)}</td>
          <td class="num">${formatNum(item.quantity)}</td>
          <td class="num">${formatNum(item.fat, 1)}%</td>
          <td class="num">${formatNum(item.snf, 1)}%</td>
          <td class="num">${formatINR(item.ratePerLiter)}</td>
          <td class="num">${formatINR(item.baseAmount)}</td>
          <td class="num">${item.bonusApplied ? `+${formatINR(item.bonusAmount)}` : '—'}</td>
          <td class="num"><strong>${formatINR(item.totalAmount)}</strong></td>
        </tr>
      `)
      .join('');

    const container = $('slipContainer');
    container.className = 'statement-paper';
    container.innerHTML = `
      <div class="statement-header">
        <div>
          <h2>PARADOX DAIRY — PAYOUT STATEMENT</h2>
          <p>Collection Center #01 · Farmer Milk Settlement</p>
        </div>
        <div style="text-align:right">
          <strong class="mono">${escapeHtml(slip.slipNumber)}</strong>
          <p>${escapeHtml(generatedLocal)}</p>
        </div>
      </div>

      <div class="statement-meta">
        <div>
          <span>Farmer Name</span>
          <strong>${escapeHtml(slip.farmerName)}</strong>
        </div>
        <div>
          <span>Farmer Code</span>
          <strong class="mono">${escapeHtml(slip.farmerId)}</strong>
        </div>
        <div>
          <span>Settlement Period</span>
          <strong class="mono">${escapeHtml(slip.periodFrom)} → ${escapeHtml(slip.periodTo)}</strong>
        </div>
        <div>
          <span>Weighted Avg Quality</span>
          <strong class="mono">${formatNum(slip.summary.avgFat, 1)}% Fat · ${formatNum(slip.summary.avgSnf, 1)}% SNF</strong>
        </div>
      </div>

      <div class="table-scroll">
        <table class="ledger-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Shift</th>
              <th class="num">Qty (L)</th>
              <th class="num">Fat</th>
              <th class="num">SNF</th>
              <th class="num">Rate/L</th>
              <th class="num">Base</th>
              <th class="num">Bonus</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <div class="statement-totals">
        <div class="statement-total-row">
          <span>Deliveries</span>
          <span class="mono">${slip.summary.entryCount}</span>
        </div>
        <div class="statement-total-row">
          <span>Total Volume</span>
          <span class="mono">${formatNum(slip.summary.totalQuantity)} L</span>
        </div>
        <div class="statement-total-row">
          <span>Gross Base Amount</span>
          <span class="mono">${formatINR(slip.summary.totalBaseAmount)}</span>
        </div>
        <div class="statement-total-row">
          <span>High-Quantity Bonus</span>
          <span class="mono amber-text">+ ${formatINR(slip.summary.totalBonusAmount)}</span>
        </div>
        <div class="statement-total-row net">
          <span>Net Payable</span>
          <span class="mono emerald-text">${formatINR(slip.summary.totalPayable)}</span>
        </div>
      </div>

      <div class="statement-sigs">
        <div class="sig-box">Farmer Signature</div>
        <div class="sig-box">Authorized Signatory</div>
      </div>
    `;
  }

  $('printSlipBtn').addEventListener('click', () => window.print());

  async function loadRateCard() {
    state.rateCard = await api('/api/rate-card');
    state.dirtyCells.clear();
    updateSidebarBonusHint();
    renderBonusRules();
    renderRateMatrix();
  }

  function updateSidebarBonusHint() {
    const rules = state.rateCard?.bonusRules || [];
    if (rules.length === 0) {
      $('sidebarBonusHint').textContent = 'No active bonus tiers';
      return;
    }
    const summary = [...rules]
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .map((r) => `${r.minQuantity}L+: +₹${r.bonusPerLiter}`)
      .join(' · ');
    $('sidebarBonusHint').textContent = summary;
  }

  function renderBonusRules() {
    const list = $('bonusRulesList');
    const rules = state.rateCard.bonusRules || [];

    if (rules.length === 0) {
      list.innerHTML = `<p class="panel-sub">No bonus slabs configured. Add a tier to reward high-volume deliveries.</p>`;
      return;
    }

    list.innerHTML = rules
      .map((rule, idx) => `
        <div class="bonus-slab-row" data-rule-idx="${idx}">
          <div class="field">
            <label>Min Quantity</label>
            <div class="input-unit">
              <input type="number" step="0.5" min="1" class="mono bonus-min-qty" value="${rule.minQuantity}" />
              <span>L</span>
            </div>
          </div>
          <div class="field">
            <label>Bonus Rate</label>
            <div class="input-unit">
              <input type="number" step="0.25" min="0" class="mono bonus-per-liter" value="${rule.bonusPerLiter}" />
              <span>₹</span>
            </div>
          </div>
          <div class="field">
            <label>Tier Label</label>
            <input type="text" class="bonus-label" value="${escapeHtml(rule.label)}" />
          </div>
          <button type="button" class="btn-icon-danger remove-bonus-btn" title="Remove tier" aria-label="Remove tier">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      `)
      .join('');
  }

  $('bonusRulesList').addEventListener('input', (event) => {
    const row = event.target.closest('.bonus-slab-row');
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
    const idx = Number(btn.closest('.bonus-slab-row').dataset.ruleIdx);
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
            <span class="step-header mono">
              ${sKey}%
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
              <span class="step-header mono">
                ${fKey}%
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
      <tbody>${bodyRows}</tbody>
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
      showToast('Enter a Fat % between 0 and 20.', true);
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
      showToast('Enter an SNF % between 0 and 20.', true);
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
      showToast('Enter a non-zero ₹/L adjustment.', true);
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
    showToast(`Adjusted all rates by ${delta > 0 ? '+' : ''}₹${delta.toFixed(2)}/L. Save Rate Card to apply.`);
  });

  $('saveRateCardBtn').addEventListener('click', async () => {
    try {
      const updated = await api('/api/rate-card', {
        method: 'PUT',
        body: JSON.stringify(state.rateCard)
      });
      state.rateCard = updated;
      state.dirtyCells.clear();
      updateSidebarBonusHint();
      renderBonusRules();
      renderRateMatrix();
      updateLivePreview();
      showToast('Rate chart and bonus slabs saved.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('resetRateCardBtn').addEventListener('click', async () => {
    try {
      const reset = await api('/api/rate-card/reset', { method: 'POST' });
      state.rateCard = reset;
      state.dirtyCells.clear();
      updateSidebarBonusHint();
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
