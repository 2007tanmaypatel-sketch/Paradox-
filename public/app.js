(function () {
  // ─── State ───
  const state = {
    today: new Date().toISOString().slice(0, 10),
    rateCard: null,
    dirtyCells: new Set(),
    entries: [],
    farmers: [],
    shiftFilter: 'ALL',
    lastAddedId: null,
    kpiPrev: { qty: 0, base: 0, bonus: 0, payable: 0 }
  };

  const $ = (id) => document.getElementById(id);

  function formatINR(value) {
    const num = Number(value) || 0;
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function formatNum(v, d = 2) { return (Number(v) || 0).toFixed(d); }
  function escapeHtml(t) {
    return String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Smooth counter ───
  function countUp(el, from, to, fmt, ms = 500) {
    const start = performance.now();
    const diff = to - from;
    if (Math.abs(diff) < 0.01) { el.textContent = fmt(to); return; }
    const tick = (now) => {
      const t = Math.min((now - start) / ms, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + diff * ease);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(to);
    };
    requestAnimationFrame(tick);
  }

  // ─── Toast ───
  let toastTimer;
  function toast(msg, err = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast show${err ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.className = 'toast', 3400);
  }

  // ─── API ───
  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ─── Particles ───
  function spawnParticles() {
    const container = $('particles');
    if (!container) return;
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.cssText = `
        left: ${Math.random() * 100}%;
        bottom: ${Math.random() * 30}%;
        --pdur: ${5 + Math.random() * 9}s;
        --pdel: ${Math.random() * 8}s;
        opacity: 0;
        background: ${Math.random() > 0.6 ? '#14e87e' : Math.random() > 0.5 ? '#f59e0b' : '#38bdf8'};
        width: ${1.5 + Math.random() * 2.5}px;
        height: ${1.5 + Math.random() * 2.5}px;
      `;
      container.appendChild(p);
    }
  }

  // ─── Tab Navigation ───
  function switchTab(name) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  }
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ─── Shift toggle ───
  document.querySelectorAll('.seg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('entryShift').value = btn.dataset.shift;
    });
  });

  // ─── Shift filter ───
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.shiftFilter = btn.dataset.filterShift;
      renderTable();
    });
  });

  // ─── Init ───
  async function init() {
    spawnParticles();
    try { const h = await api('/api/health'); state.today = h.today; } catch {}

    $('summaryDate').value = state.today;
    $('entryDate').value = state.today;
    $('slipFromDate').value = state.today;
    $('slipToDate').value = state.today;

    await Promise.all([loadRateCard(), loadFarmers(), loadSummary()]);
    updatePreview();
  }

  // ─── Farmers ───
  async function loadFarmers() {
    const d = await api('/api/farmers');
    state.farmers = d.farmers || [];
    $('farmerList').innerHTML = state.farmers.map(f => `<option value="${escapeHtml(f.farmerId)}">${escapeHtml(f.farmerName)}</option>`).join('');
    const sel = $('slipFarmerSelect');
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select farmer...</option>' +
      state.farmers.map(f => `<option value="${escapeHtml(f.farmerId)}">${escapeHtml(f.farmerId)} — ${escapeHtml(f.farmerName)}</option>`).join('');
    if (prev && state.farmers.some(f => f.farmerId === prev)) sel.value = prev;
  }

  // ─── Summary ───
  async function loadSummary() {
    const date = $('summaryDate').value || state.today;
    const d = await api(`/api/summary?date=${encodeURIComponent(date)}`);
    state.entries = d.entries || [];
    renderKPIs(d.summary);
    renderTable();
  }

  function renderKPIs(s) {
    countUp($('kpiTotalQty'), state.kpiPrev.qty, s.totalQuantity, v => `${formatNum(v)} L`);
    countUp($('kpiBaseAmountVal'), state.kpiPrev.base, s.totalBaseAmount, formatINR);
    countUp($('kpiTotalBonus'), state.kpiPrev.bonus, s.totalBonusAmount, formatINR);
    countUp($('kpiTotalPayable'), state.kpiPrev.payable, s.totalPayable, formatINR);

    state.kpiPrev = { qty: s.totalQuantity, base: s.totalBaseAmount, bonus: s.totalBonusAmount, payable: s.totalPayable };

    $('kpiFarmers').textContent = `${s.farmerCount} farmer${s.farmerCount === 1 ? '' : 's'} · ${s.entryCount} entr${s.entryCount === 1 ? 'y' : 'ies'}`;
    $('kpiAvgRate').textContent = `Avg: ${formatINR(s.avgRate)}/L`;
    $('kpiBonusCount').textContent = `${s.bonusEntriesCount} qualifying`;
    $('kpiAvgQuality').textContent = `Avg ${formatNum(s.avgFat, 1)}% Fat · ${formatNum(s.avgSnf, 1)}% SNF`;

    const fill = $('kpiQtyBar');
    if (fill && s.totalQuantity > 0) {
      const pct = Math.min(100, (s.totalQuantity / 500) * 100);
      requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
    }
  }

  function renderTable() {
    const q = ($('farmerSearch').value || '').trim().toLowerCase();
    const date = $('summaryDate').value || state.today;
    $('registerSubtitle').textContent = `Ledger date ${date}`;

    const rows = state.entries.filter(e => {
      if (state.shiftFilter !== 'ALL' && e.shift !== state.shiftFilter) return false;
      if (!q) return true;
      return e.farmerId.toLowerCase().includes(q) || e.farmerName.toLowerCase().includes(q);
    });

    const tbody = $('entriesTableBody');
    const tfoot = $('entriesTableFoot');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No entries found for ${escapeHtml(date)}.</td></tr>`;
      tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = rows.map((e, i) => {
      const cls = e.id === state.lastAddedId ? 'row-flash' : 'row-stagger';
      return `
        <tr class="${cls}" style="--rd:${Math.min(i * 32, 250)}ms">
          <td><div class="farmer-pill"><span class="farmer-code">${escapeHtml(e.farmerId)}</span><span class="farmer-name">${escapeHtml(e.farmerName)}</span></div></td>
          <td><span class="shift-badge">${escapeHtml(e.shift)}</span></td>
          <td class="num">${formatNum(e.quantity)}</td>
          <td class="num">${formatNum(e.fat, 1)}%</td>
          <td class="num">${formatNum(e.snf, 1)}%</td>
          <td class="num">${formatINR(e.ratePerLiter)}</td>
          <td class="num">${e.bonusApplied ? `<span class="bonus-chip" title="${escapeHtml(e.bonusLabel||'')}">+${formatINR(e.bonusAmount)}</span>` : '<span style="color:var(--ink3)">—</span>'}</td>
          <td class="num"><strong style="color:var(--green)">${formatINR(e.totalAmount)}</strong></td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-slip" data-slip-id="${escapeHtml(e.id)}">Slip</button>
              <button type="button" class="btn-trash" data-delete-id="${escapeHtml(e.id)}" aria-label="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    state.lastAddedId = null;

    const tQty = rows.reduce((a, e) => a + e.quantity, 0);
    const tBonus = rows.reduce((a, e) => a + e.bonusAmount, 0);
    const tPay = rows.reduce((a, e) => a + e.totalAmount, 0);

    tfoot.innerHTML = `
      <tr>
        <td colspan="2">Total (${rows.length})</td>
        <td class="num">${formatNum(tQty)} L</td>
        <td colspan="3"></td>
        <td class="num">${formatINR(tBonus)}</td>
        <td class="num" style="color:var(--green)">${formatINR(tPay)}</td>
        <td></td>
      </tr>`;
  }

  $('entriesTableBody').addEventListener('click', async e => {
    const slipBtn = e.target.closest('[data-slip-id]');
    if (slipBtn) { await openSlip(slipBtn.dataset.slipId); return; }
    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      try {
        await api(`/api/entries/${encodeURIComponent(delBtn.dataset.deleteId)}`, { method: 'DELETE' });
        toast('Entry deleted from ledger.');
        await Promise.all([loadSummary(), loadFarmers()]);
      } catch (err) { toast(err.message, true); }
    }
  });

  $('summaryDate').addEventListener('change', loadSummary);
  $('farmerSearch').addEventListener('input', renderTable);

  $('farmerId').addEventListener('input', () => {
    const v = $('farmerId').value.trim().toUpperCase();
    const m = state.farmers.find(f => f.farmerId.toUpperCase() === v);
    if (m) $('farmerName').value = m.farmerName;
  });

  // ─── Live Preview & Gauge ───
  function updateGauge(qty) {
    const rules = [...(state.rateCard?.bonusRules || [])].sort((a, b) => a.minQuantity - b.minQuantity);
    const fill = $('meterFill');
    const lbl = $('meterLabel');
    const glow = $('gaugeGlow');

    const n = Number.isFinite(qty) && qty > 0 ? qty : 0;
    if (!rules.length) {
      fill.style.width = '0%';
      fill.classList.remove('qualified');
      lbl.textContent = 'No bonus tiers';
      if (glow) glow.style.opacity = '0';
      return;
    }

    const next = rules.find(r => n < r.minQuantity) || rules[rules.length - 1];
    const pct = Math.min(100, (n / next.minQuantity) * 100);
    const qualified = n >= rules[0].minQuantity;

    fill.style.width = `${pct}%`;
    fill.classList.toggle('qualified', qualified);
    if (glow) {
      glow.style.opacity = pct > 5 ? '0.9' : '0';
      glow.style.background = qualified ? 'var(--amber)' : 'var(--green)';
      glow.style.boxShadow = qualified ? '0 0 12px var(--amber)' : '0 0 12px var(--green)';
    }

    if (n >= rules[rules.length - 1].minQuantity) lbl.textContent = `${formatNum(n, 1)} L · Max tier 🎉`;
    else if (qualified) lbl.textContent = `${formatNum(n, 1)} / ${next.minQuantity} L (Bonus active ✓)`;
    else lbl.textContent = `${formatNum(n, 1)} / ${next.minQuantity} L`;
  }

  let previewSeq = 0;
  async function updatePreview() {
    const qty = Number($('quantity').value);
    const fat = Number($('fat').value);
    const snf = Number($('snf').value);
    updateGauge(qty);

    const hasInput = Number.isFinite(qty) && qty > 0 && $('fat').value !== '' && $('snf').value !== '' && Number.isFinite(fat) && Number.isFinite(snf);

    if (!hasInput) {
      $('previewMatchedSlab').textContent = 'Awaiting input...';
      $('previewRate').textContent = '₹0.00';
      $('previewBase').textContent = '₹0.00';
      $('previewBonus').textContent = '₹0.00';
      $('previewTotal').textContent = '₹0.00';
      $('previewBonusNote').textContent = nextBonusHint(0);
      return;
    }

    const seq = ++previewSeq;
    try {
      const p = await api('/api/calculate', { method: 'POST', body: JSON.stringify({ quantity: qty, fat, snf }) });
      if (seq !== previewSeq) return;
      $('previewMatchedSlab').textContent = `${p.exactMatch ? 'Exact' : 'Slab'} ${p.matchedFat.toFixed(1)}% / ${p.matchedSnf.toFixed(1)}%`;
      $('previewRate').textContent = `${formatINR(p.ratePerLiter)} / L`;
      $('previewBase').textContent = formatINR(p.baseAmount);
      $('previewBonus').textContent = p.bonusApplied ? `+${formatINR(p.bonusAmount)} (+₹${p.bonusPerLiter.toFixed(2)}/L)` : '₹0.00';
      $('previewTotal').textContent = formatINR(p.totalAmount);
      $('previewBonusNote').textContent = p.bonusApplied ? `🎉 ${p.bonusLabel}` : nextBonusHint(qty);
    } catch (err) {
      $('previewMatchedSlab').textContent = 'Invalid input';
      $('previewBonusNote').textContent = err.message;
    }
  }

  function nextBonusHint(qty) {
    const rules = state.rateCard?.bonusRules || [];
    if (!rules.length) return 'No volume bonus tiers configured.';
    const sorted = [...rules].sort((a, b) => a.minQuantity - b.minQuantity);
    const next = sorted.find(r => qty < r.minQuantity);
    if (!next) return '';
    return `🚀 Tip: ${next.minQuantity}+ L earns +${formatINR(next.bonusPerLiter)}/L bonus!`;
  }

  ['quantity', 'fat', 'snf'].forEach(id => $(id).addEventListener('input', updatePreview));

  // ─── Entry Form Submit ───
  $('entryForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      date: $('entryDate').value, shift: $('entryShift').value,
      farmerId: $('farmerId').value.trim(), farmerName: $('farmerName').value.trim(),
      quantity: Number($('quantity').value), fat: Number($('fat').value), snf: Number($('snf').value)
    };
    try {
      const res = await api('/api/entries', { method: 'POST', body: JSON.stringify(payload) });
      state.lastAddedId = res.entry.id;
      toast(`✓ Saved ${formatNum(res.entry.quantity)} L for ${res.entry.farmerName} · ${formatINR(res.entry.totalAmount)}`);
      $('summaryDate').value = res.entry.date;
      $('quantity').value = ''; $('fat').value = ''; $('snf').value = '';
      updatePreview();
      await Promise.all([loadSummary(), loadFarmers()]);
    } catch (err) { toast(err.message, true); }
  });

  // ─── Payout Slip ───
  async function openSlip(entryId) {
    try {
      const slip = await api(`/api/payout-slip?entryId=${encodeURIComponent(entryId)}`);
      renderSlip(slip);
      switchTab('slip');
    } catch (err) { toast(err.message, true); }
  }

  $('slipFilterForm').addEventListener('submit', async e => {
    e.preventDefault();
    const farmerId = $('slipFarmerSelect').value;
    if (!farmerId) { toast('Select a farmer first.', true); return; }
    const p = new URLSearchParams({ farmerId });
    const from = $('slipFromDate').value; const to = $('slipToDate').value;
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    try {
      const slip = await api(`/api/payout-slip?${p}`);
      renderSlip(slip);
    } catch (err) { toast(err.message, true); }
  });

  function renderSlip(slip) {
    $('printSlipBtn').disabled = false;
    const gen = new Date(slip.generatedAt).toLocaleString();

    const rows = slip.items.map(item => `
      <tr>
        <td class="mono">${escapeHtml(item.date)}</td><td>${escapeHtml(item.shift)}</td>
        <td class="num">${formatNum(item.quantity)}</td>
        <td class="num">${formatNum(item.fat, 1)}%</td><td class="num">${formatNum(item.snf, 1)}%</td>
        <td class="num">${formatINR(item.ratePerLiter)}</td>
        <td class="num">${formatINR(item.baseAmount)}</td>
        <td class="num">${item.bonusApplied ? `+${formatINR(item.bonusAmount)}` : '—'}</td>
        <td class="num"><strong style="color:var(--green)">${formatINR(item.totalAmount)}</strong></td>
      </tr>`).join('');

    $('slipContainer').outerHTML = `
      <div id="slipContainer" class="statement-sheet">
        <div class="stmt-header">
          <div>
            <h2>Paradox Dairy — Payout Statement</h2>
            <p>Collection Center #01 · Farmer Milk Settlement</p>
          </div>
          <div style="text-align:right">
            <strong class="mono" style="color:var(--green)">${escapeHtml(slip.slipNumber)}</strong>
            <p style="font-size:12px;color:var(--ink3)">${escapeHtml(gen)}</p>
          </div>
        </div>

        <div class="stmt-meta">
          <div><span>Farmer Name</span><strong>${escapeHtml(slip.farmerName)}</strong></div>
          <div><span>Farmer Code</span><strong class="mono">${escapeHtml(slip.farmerId)}</strong></div>
          <div><span>Period</span><strong class="mono">${escapeHtml(slip.periodFrom)} → ${escapeHtml(slip.periodTo)}</strong></div>
          <div><span>Avg Quality</span><strong class="mono">${formatNum(slip.summary.avgFat, 1)}% Fat · ${formatNum(slip.summary.avgSnf, 1)}% SNF</strong></div>
        </div>

        <div class="table-scroll">
          <table class="ledger-table">
            <thead><tr>
              <th>Date</th><th>Shift</th><th class="num">Qty</th><th class="num">Fat</th>
              <th class="num">SNF</th><th class="num">Rate/L</th><th class="num">Base</th>
              <th class="num">Bonus</th><th class="num">Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div class="stmt-bottom">
          <svg class="verified-seal" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r="48" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>
            <circle cx="55" cy="55" r="38" fill="none" stroke="currentColor" stroke-width="1.2"/>
            <text x="55" y="50" text-anchor="middle" font-family="Syne,sans-serif" font-size="10" font-weight="800" fill="currentColor">VERIFIED</text>
            <text x="55" y="65" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="7.5" font-weight="600" fill="currentColor">PARADOX DAIRY</text>
          </svg>

          <div class="stmt-totals">
            <div class="stmt-row"><span>Deliveries</span><span class="mono">${slip.summary.entryCount}</span></div>
            <div class="stmt-row"><span>Total Volume</span><span class="mono">${formatNum(slip.summary.totalQuantity)} L</span></div>
            <div class="stmt-row"><span>Gross Base</span><span class="mono">${formatINR(slip.summary.totalBaseAmount)}</span></div>
            <div class="stmt-row"><span>Volume Bonus</span><span class="mono" style="color:var(--amber)">+ ${formatINR(slip.summary.totalBonusAmount)}</span></div>
            <div class="stmt-row net"><span>Net Payable</span><span class="mono">${formatINR(slip.summary.totalPayable)}</span></div>
          </div>
        </div>

        <div class="stmt-sigs">
          <div class="sig-line">Farmer Signature</div>
          <div class="sig-line">Authorized Signatory</div>
        </div>
      </div>`;
  }

  $('printSlipBtn').addEventListener('click', () => window.print());

  // ─── Rate Card ───
  async function loadRateCard() {
    state.rateCard = await api('/api/rate-card');
    state.dirtyCells.clear();
    updateSidebarHint();
    renderBonusSlabs();
    renderMatrix();
  }

  function updateSidebarHint() {
    const rules = state.rateCard?.bonusRules || [];
    if (!rules.length) { $('sidebarBonusHint').textContent = 'No bonus tiers'; return; }
    $('sidebarBonusHint').textContent = [...rules].sort((a, b) => a.minQuantity - b.minQuantity)
      .map(r => `${r.minQuantity}L+ → +₹${r.bonusPerLiter}`).join(' · ');
  }

  function renderBonusSlabs() {
    const list = $('bonusRulesList');
    const rules = state.rateCard.bonusRules || [];
    if (!rules.length) {
      list.innerHTML = `<p class="card-sub">No slabs configured. Add a tier to incentivize bulk deliveries.</p>`;
      return;
    }
    list.innerHTML = rules.map((r, i) => `
      <div class="bonus-row" data-idx="${i}">
        <div class="field">
          <label>Min Qty</label>
          <div class="input-wrap unit-wrap">
            <input type="number" step="0.5" min="1" class="mono bonus-qty" value="${r.minQuantity}" />
            <span class="unit-badge">L</span>
          </div>
        </div>
        <div class="field">
          <label>Bonus Rate</label>
          <div class="input-wrap unit-wrap">
            <input type="number" step="0.25" min="0" class="mono bonus-rate" value="${r.bonusPerLiter}" />
            <span class="unit-badge">₹</span>
          </div>
        </div>
        <div class="field">
          <label>Label</label>
          <input type="text" class="bonus-lbl" value="${escapeHtml(r.label)}" />
        </div>
        <button type="button" class="btn-trash rm-bonus" title="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`).join('');
  }

  $('bonusRulesList').addEventListener('input', e => {
    const row = e.target.closest('.bonus-row');
    if (!row) return;
    const r = state.rateCard.bonusRules[Number(row.dataset.idx)];
    if (!r) return;
    if (e.target.classList.contains('bonus-qty')) r.minQuantity = Number(e.target.value);
    else if (e.target.classList.contains('bonus-rate')) r.bonusPerLiter = Number(e.target.value);
    else if (e.target.classList.contains('bonus-lbl')) r.label = e.target.value;
  });

  $('bonusRulesList').addEventListener('click', e => {
    const btn = e.target.closest('.rm-bonus');
    if (!btn) return;
    state.rateCard.bonusRules.splice(Number(btn.closest('.bonus-row').dataset.idx), 1);
    renderBonusSlabs();
  });

  $('addBonusRuleBtn').addEventListener('click', () => {
    const ex = state.rateCard.bonusRules;
    const nxt = ex.length ? Math.max(...ex.map(r => r.minQuantity)) + 10 : 20;
    ex.push({ minQuantity: nxt, bonusPerLiter: 2.0, label: `Bulk Tier (${nxt}+ L)` });
    renderBonusSlabs();
  });

  function heatRange(fatSteps, snfSteps, rates) {
    let min = Infinity, max = -Infinity;
    for (const f of fatSteps) for (const s of snfSteps) {
      const v = Number(rates[f.toFixed(1)]?.[s.toFixed(1)]);
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    return { min, max: max > min ? max : min + 1 };
  }

  function renderMatrix() {
    const tbl = $('rateMatrixTable');
    const { fatSteps, snfSteps, rates } = state.rateCard;
    const { min, max } = heatRange(fatSteps, snfSteps, rates);

    const hd = snfSteps.map(s => `
      <th><span class="step-hdr mono">
        ${s.toFixed(1)}%
        ${snfSteps.length > 1 ? `<button class="rm-step" data-rm-snf="${s}">×</button>` : ''}
      </span></th>`).join('');

    const body = fatSteps.map(f => {
      const fk = f.toFixed(1);
      const cells = snfSteps.map(s => {
        const sk = s.toFixed(1);
        const v = Number(rates[fk]?.[sk] ?? 0);
        const ratio = Math.max(0, Math.min(1, (v - min) / (max - min)));
        const a = (0.03 + ratio * 0.28).toFixed(3);
        const dirty = state.dirtyCells.has(`${fk}|${sk}`) ? ' dirty' : '';
        return `<td style="background:rgba(20,232,126,${a})">
          <input type="number" step="0.05" min="0" class="rate-input${dirty}" data-fat="${fk}" data-snf="${sk}" value="${v.toFixed(2)}" />
        </td>`;
      }).join('');
      return `<tr>
        <th><span class="step-hdr mono">
          ${fk}%
          ${fatSteps.length > 1 ? `<button class="rm-step" data-rm-fat="${f}">×</button>` : ''}
        </span></th>
        ${cells}
      </tr>`;
    }).join('');

    tbl.innerHTML = `<thead><tr><th class="corner-cell">Fat\\SNF</th>${hd}</tr></thead><tbody>${body}</tbody>`;
  }

  $('rateMatrixTable').addEventListener('input', e => {
    const inp = e.target.closest('.rate-input');
    if (!inp) return;
    const fk = inp.dataset.fat, sk = inp.dataset.snf;
    const v = Number(inp.value);
    if (!state.rateCard.rates[fk]) state.rateCard.rates[fk] = {};
    state.rateCard.rates[fk][sk] = Number.isFinite(v) ? v : 0;
    state.dirtyCells.add(`${fk}|${sk}`);
    inp.classList.add('dirty');
  });

  $('rateMatrixTable').addEventListener('click', e => {
    const rf = e.target.closest('[data-rm-fat]');
    if (rf) {
      const t = Number(rf.dataset.rmFat);
      state.rateCard.fatSteps = state.rateCard.fatSteps.filter(v => Math.abs(v - t) > 1e-6);
      delete state.rateCard.rates[t.toFixed(1)];
      renderMatrix(); return;
    }
    const rs = e.target.closest('[data-rm-snf]');
    if (rs) {
      const t = Number(rs.dataset.rmSnf), sk = t.toFixed(1);
      state.rateCard.snfSteps = state.rateCard.snfSteps.filter(v => Math.abs(v - t) > 1e-6);
      for (const fk of Object.keys(state.rateCard.rates)) delete state.rateCard.rates[fk][sk];
      renderMatrix();
    }
  });

  $('addFatBtn').addEventListener('click', () => {
    const v = Number($('newFatStep').value);
    if (!Number.isFinite(v) || v < 0 || v > 20) { toast('Enter Fat % 0–20.', true); return; }
    const fk = v.toFixed(1);
    if (state.rateCard.fatSteps.some(x => x.toFixed(1) === fk)) { toast(`Fat ${fk}% already exists.`, true); return; }
    const nearest = state.rateCard.fatSteps[state.rateCard.fatSteps.length - 1].toFixed(1);
    state.rateCard.fatSteps = [...state.rateCard.fatSteps, v].sort((a, b) => a - b);
    state.rateCard.rates[fk] = {};
    for (const s of state.rateCard.snfSteps) {
      const sk = s.toFixed(1);
      state.rateCard.rates[fk][sk] = Number(state.rateCard.rates[nearest]?.[sk] ?? 35);
      state.dirtyCells.add(`${fk}|${sk}`);
    }
    $('newFatStep').value = '';
    renderMatrix();
  });

  $('addSnfBtn').addEventListener('click', () => {
    const v = Number($('newSnfStep').value);
    if (!Number.isFinite(v) || v < 0 || v > 20) { toast('Enter SNF % 0–20.', true); return; }
    const sk = v.toFixed(1);
    if (state.rateCard.snfSteps.some(x => x.toFixed(1) === sk)) { toast(`SNF ${sk}% already exists.`, true); return; }
    const nearest = state.rateCard.snfSteps[state.rateCard.snfSteps.length - 1].toFixed(1);
    state.rateCard.snfSteps = [...state.rateCard.snfSteps, v].sort((a, b) => a - b);
    for (const f of state.rateCard.fatSteps) {
      const fk = f.toFixed(1);
      state.rateCard.rates[fk][sk] = Number(state.rateCard.rates[fk]?.[nearest] ?? 35);
      state.dirtyCells.add(`${fk}|${sk}`);
    }
    $('newSnfStep').value = '';
    renderMatrix();
  });

  $('applyBulkDeltaBtn').addEventListener('click', () => {
    const delta = Number($('bulkDelta').value);
    if (!Number.isFinite(delta) || delta === 0) { toast('Enter a non-zero ± amount.', true); return; }
    for (const f of state.rateCard.fatSteps) {
      const fk = f.toFixed(1);
      for (const s of state.rateCard.snfSteps) {
        const sk = s.toFixed(1);
        const nv = Math.max(0, Number(state.rateCard.rates[fk][sk]) + delta);
        state.rateCard.rates[fk][sk] = Math.round(nv * 100) / 100;
        state.dirtyCells.add(`${fk}|${sk}`);
      }
    }
    $('bulkDelta').value = '';
    renderMatrix();
    toast(`${delta > 0 ? '+' : ''}₹${delta.toFixed(2)}/L applied to all cells. Save to confirm.`);
  });

  $('saveRateCardBtn').addEventListener('click', async () => {
    try {
      const updated = await api('/api/rate-card', { method: 'PUT', body: JSON.stringify(state.rateCard) });
      state.rateCard = updated; state.dirtyCells.clear();
      updateSidebarHint(); renderBonusSlabs(); renderMatrix(); updatePreview();
      toast('✓ Rate chart and bonus slabs saved!');
    } catch (err) { toast(err.message, true); }
  });

  $('resetRateCardBtn').addEventListener('click', async () => {
    try {
      const r = await api('/api/rate-card/reset', { method: 'POST' });
      state.rateCard = r; state.dirtyCells.clear();
      updateSidebarHint(); renderBonusSlabs(); renderMatrix(); updatePreview();
      toast('Rate chart reset to defaults.');
    } catch (err) { toast(err.message, true); }
  });

  init().catch(err => toast(err.message, true));
})();
