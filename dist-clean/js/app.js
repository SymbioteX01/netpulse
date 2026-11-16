(function () {
  'use strict';

  let lastResult = null;
  let simMode = 'wifi';
  let simSelected = null;

  const $ = (id) => document.getElementById(id);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ---------------- Tabs ---------------- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'report') loadSurveyReportData();
    });
  });

  /* ---------------- Home dashboard quick-actions + stats ---------------- */
  document.querySelectorAll('.js-goto[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
      $('tab-' + t).classList.add('active');
    });
  });

  function renderHomeStats() {
    const total = $('homeTotalScans'), last = $('homeLastScan'), health = $('homeInternet');
    if (!total || !last || !health) return;
    fetch('/api/history').then(r => r.json()).then(j => {
      const list = (j.list || []).filter(h => h && h.data);
      total.textContent = list.length;
      const top = list[0];
      if (top) {
        last.textContent = top.timestamp ? new Date(top.timestamp).toLocaleString() : '—';
        health.textContent = top.data.connectivity && top.data.connectivity.internetReachable ? 'Internet reachable' : 'Internet not reachable';
        health.className = top.data.connectivity && top.data.connectivity.internetReachable ? 'stat-val ok' : 'stat-val warn';
      } else {
        last.textContent = 'No scans yet';
        health.textContent = '—';
      }
    }).catch(() => {
      last.textContent = 'Server offline - run node server.js';
      health.textContent = '—';
    });
  }

  /* ---------------- Theme toggle ---------------- */
  const I18N = {
    'tab-live': 'Live Scan', 'tab-sim': 'Simulation Lab', 'tab-survey': 'Survey & Mapping', 'tab-report': 'Report', 'tab-history': 'History',
    'tab-troubleshoot': 'Troubleshoot',
    'btn-scan': 'Run Full Diagnostics', 'btn-cancel': 'Cancel Scan', 'btn-save-report': 'Save Report', 'btn-copy-evidence': 'Copy Evidence', 'btn-evidence-txt': 'Evidence .txt', 'btn-topo-png': 'Topology PNG', 'btn-save-pdf': 'PDF Report', 'btn-print': 'Print Report',
    'fix-actions': 'Fix Actions', 'btn-dhcp': 'Renew DHCP (release/renew)', 'btn-flush': 'Flush DNS Cache', 'fix-note': 'Runs real Windows commands on this PC — requires Administrator rights for some actions.',
    'scan-history': 'All Saved Scans', 'fault-stats': 'Fault Statistics (all saved scans)',
    'btn-hist-compare': 'Compare Selected', 'btn-hist-clear': 'Clear History', 'btn-hist-refresh': 'Refresh', 'act-load': 'Load',
    'h-time': 'Time', 'h-mode': 'Mode', 'h-ssid': 'SSID / Signal', 'h-gateway': 'Gateway', 'h-internet': 'Internet', 'h-rtt': 'Avg RTT', 'h-actions': 'Actions',
    'hist-empty': 'No saved scans yet - run a full scan and it will appear here.', 'hist-count': 'saved scans',
    'reachable': 'Reachable', 'not-reachable': 'NOT reachable',
    'btn-survey-scan': 'Scan & Measure', 'btn-survey-save': 'Save Survey Point',
    's-wifi': 'Wi-Fi Details', 's-speed': 'Internet Performance', 's-gps': 'GPS Location', 's-quality': 'Signal Quality', 's-history': 'Survey History', 's-map': 'Survey Map', 's-heat': 'Signal Heatmap', 's-export': 'Export Survey Data', 's-floor': 'Floor Plan Background', 's-timeline': 'Signal Timeline (all points over time)', 'btn-survey-report': 'Generate HTML Report', 'btn-floor-clear': 'Remove Floor Plan',
    'tab-home': 'Home',
    'home-title': 'Welcome to NetPulse',
    'home-tagline': 'Evidence-backed network fault diagnosis. Scan, diagnose with raw evidence, fix, verify — then export a full report.',
    'home-cta-scan': 'Start Troubleshooting',
    'home-cta-sim': 'Try a Simulation',
    'home-stats-title': 'At a glance',
    'home-stat-scans': 'Saved scans',
    'home-stat-last': 'Last scan',
    'home-stat-net': 'Internet',
    'home-steps-title': 'How it works',
    'home-step1-t': '1. Scan',
    'home-step1-d': 'Run real diagnostics - ping, DNS, traceroute and more via the Windows command line.',
    'home-step2-t': '2. Diagnose',
    'home-step2-d': 'The engine maps every fault to its OSI layer root cause with confidence scores and raw evidence.',
    'home-step3-t': '3. Fix & Verify',
    'home-step3-d': 'Apply guided fixes, re-scan to verify the fix worked, then export an evidence report.',
    'home-explore-title': 'Explore the tools',
    'home-feat-live-d': 'Real network scan with topology, signal, root-cause and history.',
    'home-feat-sim-d': '15 guided scenarios across WiFi, LAN and mobile faults.',
    'home-feat-survey-d': 'Measure, map and export site survey data with heatmaps.',
    'home-feat-history-d': 'Browse all previous scans, compare results and view fault statistics.',
    /* Preflight / data-quality strings */
    'preflight-unsupported': 'Live diagnostics require Windows. Use Simulation Lab on this platform.',
    'preflight-location-blocked': 'Location permission blocked',
    'preflight-location-path': 'Settings > Privacy & Security > Location > Allow apps to access your location',
    'preflight-not-admin': 'Not running as Administrator — fix actions (DHCP renew, restore-dns-dhcp) require elevation.',
    'preflight-wlan-missing': 'WLAN service unavailable — WiFi diagnostics will be limited.',
    'insufficient-data-title': 'Insufficient data to diagnose',
    'insufficient-data-body': 'One or more core diagnostic commands failed. Fix the environment issue (see warnings) and re-scan.',
    /* Verify step */
    'verify-resolved': 'Issue resolved',
    'verify-improved': 'Improved',
    'verify-unchanged': 'Unchanged',
    'verify-worse': 'Worse after fix',
    'verify-inconclusive': 'Inconclusive',
    /* Source badges */
    'badge-live': 'LIVE',
    'badge-sim': 'SIMULATED',
    'badge-replay': 'REPLAY'
    /* TODO Hindi (hi) translations: all keys above need hi variants.
       Not adding Hindi strings here to avoid guessing — mark as TODO for native speaker review.
       Keys needing Hindi: tab-troubleshoot, preflight-*, insufficient-data-*, verify-*, badge-* */
  };
  const t = (k) => (I18N[k] != null ? I18N[k] : k);
  function applyTheme() {
    const th = localStorage.getItem('npa-theme') || 'light';
    document.body.classList.toggle('light', th === 'light');
    document.body.classList.toggle('dark', th === 'dark');
    $('btnTheme').textContent = th === 'light' ? '☀️' : '🌙';
  }
  $('btnTheme').addEventListener('click', () => { const th = (localStorage.getItem('npa-theme') || 'light') === 'light' ? 'dark' : 'light'; localStorage.setItem('npa-theme', th); applyTheme(); });
  applyTheme(); renderHomeStats();

  /* ---------------- Modal helpers ---------------- */
  function openModal(title, bodyHtml, actions) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    const wrap = $('modalActions');
    wrap.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : 'btn-ghost';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      wrap.appendChild(b);
    });
    $('modalOverlay').style.display = 'flex';
  }
  function closeAppModal() { $('modalOverlay').style.display = 'none'; }
  $('modalClose').addEventListener('click', closeAppModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeAppModal(); });

  /* ---------------- PDF report ---------------- */
  function saveReportPdf() {
    if (!lastResult) { $('scanStatus').textContent = 'Run a scan first'; return; }
    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', json: { data: lastResult.data, analysis: lastResult.analysis } })
    }).then(r => r.json()).then(j => {
      const msg = j.ok ? 'PDF saved: ' + j.path : 'PDF error: ' + j.error;
      $('scanStatus').textContent = msg;
      $('reportSource').textContent = msg;
    }).catch(e => { $('scanStatus').textContent = 'PDF error: ' + e.message; });
  }
  $('btnSavePdfReport').addEventListener('click', saveReportPdf);
  $('btnSavePdfReport2').addEventListener('click', saveReportPdf);

  /* ---------------- Copy evidence + topology PNG ---------------- */
  $('btnCopyEvidence').addEventListener('click', () => {
    if (!lastResult) { $('scanStatus').textContent = 'Run a scan first'; return; }
    navigator.clipboard.writeText(buildEvidence(lastResult.data)).then(() => {
      $('scanStatus').textContent = 'Evidence copied to clipboard';
    }).catch(() => { $('scanStatus').textContent = 'Copy failed - select the evidence text manually'; });
  });
  $('btnEvidenceTxt').addEventListener('click', () => {
    if (!lastResult) { $('scanStatus').textContent = 'Run a scan first'; return; }
    const blob = new Blob([buildEvidence(lastResult.data)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'evidence_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    $('scanStatus').textContent = 'Evidence downloaded as .txt';
  });
  $('btnTopoPng').addEventListener('click', () => {
    const c = $('topologyCanvas');
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'topology_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
    a.click();
    $('scanStatus').textContent = 'Topology image downloaded';
  });

  /* ---------------- Fix actions (with confirm:true per contract) ---------------- */
  function runFixAction(action, adapter) {
    const body = { action, confirm: true };
    if (adapter) body.adapter = adapter;
    return fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()).then(j => {
      if (!j.ok) {
        if (j.code === 'ADMIN_REQUIRED') {
          openModal('Administrator Rights Required',
            '<p>' + esc(j.error) + '</p><p style="margin-top:8px;color:var(--muted)">' + esc(j.hint || 'Restart the terminal as Administrator and try again.') + '</p>',
            [{ label: 'Close', primary: true, onClick: closeAppModal }]);
        } else {
          openModal('Action Failed', '<p>' + esc(j.error || 'The action failed') + '</p>' + (j.hint ? '<p style="margin-top:8px;color:var(--muted)">' + esc(j.hint) + '</p>' : ''),
            [{ label: 'Close', primary: true, onClick: closeAppModal }]);
        }
        return { ok: false, error: j.error };
      }
      const rows = (j.outputs || []).map(o =>
        '<div style="margin:8px 0"><b>' + esc(o.cmd) + '</b><pre style="background:var(--surface-2);padding:8px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto">' + esc(o.out || '(no output)') + '</pre></div>'
      ).join('');
      openModal(j.label || 'Action Complete', rows, [{ label: 'Close', primary: true, onClick: closeAppModal }]);
      return { ok: true };
    }).catch(e => {
      openModal('Action Error', esc(e.message), [{ label: 'Close', primary: true, onClick: closeAppModal }]);
      return { ok: false, error: e.message };
    });
  }

  function showFixConfirmModal(opts, onConfirm) {
    // opts: { title, body, confirmLabel }
    const overlay = $('fixModalOverlay');
    const bodyEl = $('fixModalBody');
    const actEl = $('fixModalActions');
    $('fixModalTitle').textContent = opts.title;
    bodyEl.innerHTML = opts.body; // body is pre-built safe HTML from callers using esc()
    actEl.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-ghost';
    cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-primary';
    confirmBtn.textContent = opts.confirmLabel || 'Confirm';
    const closeFixModal = () => {
      overlay.style.display = 'none';
      $('btnScan').focus();
    };
    cancelBtn.addEventListener('click', closeFixModal);
    $('fixModalClose').addEventListener('click', closeFixModal, { once: true });
    confirmBtn.addEventListener('click', () => { closeFixModal(); onConfirm(); });
    actEl.appendChild(cancelBtn);
    actEl.appendChild(confirmBtn);
    overlay.style.display = 'flex';
    // Focus trap: Escape closes, Tab cycles within modal
    overlay.addEventListener('keydown', function trapKey(e) {
      if (e.key === 'Escape') { closeFixModal(); overlay.removeEventListener('keydown', trapKey); }
      if (e.key === 'Tab') {
        const focusable = overlay.querySelectorAll('button, input, [tabindex]');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    setTimeout(() => confirmBtn.focus(), 50);
  }

  $('btnDhcpRenew').addEventListener('click', () => {
    showFixConfirmModal({
      title: 'Confirm: Renew DHCP',
      body: '<p><strong>What this does:</strong> Runs <code>ipconfig /release</code> then <code>ipconfig /renew</code>.</p>' +
            '<p style="margin-top:8px;color:var(--warn)"><strong>⚠ Warning:</strong> Your network connection will drop briefly (usually 5–30 seconds) while the IP is renewed.</p>' +
            '<p style="margin-top:8px"><strong>How to undo:</strong> If the connection does not return, reboot the PC or manually re-enter your static IP settings.</p>' +
            '<p style="margin-top:8px;color:var(--muted)">Requires Administrator rights.</p>',
      confirmLabel: 'Run DHCP Renew'
    }, () => runFixAction('dhcp-renew'));
  });

  $('btnFlushDns').addEventListener('click', () => {
    showFixConfirmModal({
      title: 'Confirm: Flush DNS Cache',
      body: '<p><strong>What this does:</strong> Runs <code>ipconfig /flushdns</code> to clear the DNS resolver cache.</p>' +
            '<p style="margin-top:8px"><strong>Effect:</strong> The next DNS lookup for each hostname will go to your DNS server. No connection drop expected.</p>' +
            '<p style="margin-top:8px"><strong>How to undo:</strong> The cache rebuilds automatically with use. There is nothing to undo.</p>',
      confirmLabel: 'Flush DNS'
    }, () => runFixAction('flush-dns'));
  });

  // Also ensure modal Escape key works on the original modal overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('modalOverlay').style.display !== 'none') closeAppModal();
  });

  /* ---------------- History tab ---------------- */
  const PIE_COLORS = ['#f87171', '#fbbf24', '#fb923c', '#34d399', '#22d3ee', '#b39dfa', '#f472b6', '#67e8f9', '#94a3b8'];
  let histList = [];
  let histSelected = new Set();
  let histSortKey = 'timestamp';
  let histSortDir = -1;
  let histSearchText = '';

  function loadHistory() {
    return fetch('/api/history').then(r => r.json()).then(j => {
      if (!j.ok) return;
      histList = j.list || [];
      histSelected = new Set();
      renderHistoryTableLive();
      renderStatsPieLive();
      renderRecentOnLive();
    }).catch(() => {});
  }

  function filteredHistList() {
    let list = histList.slice();
    if (histSearchText) {
      const q = histSearchText.toLowerCase();
      list = list.filter(h => [h.ssid, h.gateway, h.mode, h.id].join(' ').toLowerCase().indexOf(q) !== -1);
    }
    list.sort((a, b) => {
      let va, vb;
      if (histSortKey === 'timestamp') { va = new Date(a.timestamp || 0).getTime(); vb = new Date(b.timestamp || 0).getTime(); }
      else if (histSortKey === 'inetAvg') { va = a.inetAvg != null ? a.inetAvg : Infinity; vb = b.inetAvg != null ? b.inetAvg : Infinity; }
      else if (histSortKey === 'signalPct') { va = a.signalPct != null ? a.signalPct : -1; vb = b.signalPct != null ? b.signalPct : -1; }
      else { va = String(a[histSortKey] || '').toLowerCase(); vb = String(b[histSortKey] || '').toLowerCase(); }
      if (va < vb) return -histSortDir;
      if (va > vb) return histSortDir;
      return 0;
    });
    return list;
  }

  function renderHistoryTableLive() {
    const tb = $('historyBodyLive');
    if (!tb) return;
    const list = filteredHistList();
    tb.innerHTML = list.length ? list.map(h =>
      '<tr data-id="' + esc(h.id) + '">' +
      '<td><input type="checkbox" class="hist-cb" data-id="' + esc(h.id) + '"' + (histSelected.has(h.id) ? ' checked' : '') + '></td>' +
      '<td class="row-sub">' + (h.timestamp ? new Date(h.timestamp).toLocaleString() : '--') + '</td>' +
      '<td>' + esc(h.mode || 'wifi') + '</td>' +
      '<td>' + esc(h.ssid || '--') + ' / ' + (h.signalPct != null ? h.signalPct + '%' : '--') + '</td>' +
      '<td>' + esc(h.gateway || '--') + '</td>' +
      '<td>' + (h.internetReachable ? '<span style="color:var(--success)">' + t('reachable') + '</span>' : '<span style="color:var(--danger)">' + t('not-reachable') + '</span>') + '</td>' +
      '<td>' + (h.inetAvg != null ? h.inetAvg + ' ms' : '--') + '</td>' +
      '<td class="row-sub">' + esc(h.topFault || '--') + '</td>' +
      '<td class="row-actions">' +
      '<button class="act-btn" data-act="load">' + t('act-load') + '</button> ' +
      '<button class="act-btn danger-btn" data-act="del">Del</button>' +
      '</td></tr>'
    ).join('') : '<tr><td colspan="9" style="text-align:center;color:#7d93ad;padding:16px">' + t('hist-empty') + '</td></tr>';
    const countEl = $('histCountLive');
    if (countEl) countEl.textContent = list.length + ' of ' + histList.length + ' ' + t('hist-count');
    const histCountChip = $('histCount');
    if (histCountChip) histCountChip.textContent = histList.length + ' saved scans';
  }

  function renderRecentOnLive() {
    const box = $('liveRecentBox');
    if (!box) return;
    if (!histList.length) { box.className = 'placeholder'; box.textContent = 'No scans yet. Run a scan to see it appear here.'; return; }
    const recent = histList.slice(0, 5);
    box.className = '';
    box.innerHTML = '<table class="mini-table"><thead><tr><th>Time</th><th>Mode</th><th>SSID / Signal</th><th>Internet</th><th>Top Fault</th></tr></thead><tbody>' +
      recent.map(h =>
        '<tr><td class="row-sub">' + (h.timestamp ? new Date(h.timestamp).toLocaleString() : '--') + '</td>' +
        '<td>' + esc(h.mode || 'wifi') + '</td>' +
        '<td>' + esc(h.ssid || '--') + ' / ' + (h.signalPct != null ? h.signalPct + '%' : '--') + '</td>' +
        '<td>' + (h.internetReachable ? '<span style="color:var(--success)">OK</span>' : '<span style="color:var(--danger)">Down</span>') + '</td>' +
        '<td class="row-sub">' + esc(h.topFault || '--') + '</td></tr>'
      ).join('') +
      '</tbody></table><div class="row-sub" style="margin-top:8px"><a href="#" data-nav-tab="history" style="color:var(--accent)">View all ' + histList.length + ' scans in History tab &rarr;</a></div>';
  }

  // Delegated handler for data-nav-tab links (replaces inline onclick — CSP safe)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-nav-tab]');
    if (!a) return;
    e.preventDefault();
    const tabBtn = document.querySelector('[data-tab="' + a.dataset.navTab + '"]');
    if (tabBtn) tabBtn.click();
  });

  function renderStatsPieLive() {
    const canvas = $('statsCanvasLive');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!histList.length) {
      ctx.fillStyle = '#7d93ad'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('No data yet - run scans first', W / 2, H / 2);
      const leg = $('statsLegendLive'); if (leg) leg.textContent = '';
      return;
    }
    const counts = {};
    Promise.all(histList.map(h =>
      fetch('/api/history/' + encodeURIComponent(h.id)).then(r => r.json()).then(j => {
        if (!j.ok) return;
        const a = NetFaultAnalyzer.analyze(j.data);
        const top = a.findings[0];
        const key = (top && top.severity !== 'Healthy') ? top.title : 'Healthy';
        counts[key] = (counts[key] || 0) + 1;
      })
    )).then(() => drawPieLive(counts));
  }

  function drawPieLive(counts) {
    const canvas = $('statsCanvasLive');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);
    if (!total) { ctx.fillStyle = '#7d93ad'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('No faults recorded yet', W / 2, H / 2); const leg = $('statsLegendLive'); if (leg) leg.textContent = ''; return; }
    const cx = 130, cy = H / 2, r = 105;
    let ang = -Math.PI / 2;
    const legend = [];
    entries.forEach((e, i) => {
      const frac = e[1] / total;
      const col = PIE_COLORS[i % PIE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, ang, ang + frac * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = '#0a0f1e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ang += frac * Math.PI * 2;
      legend.push('<span style="color:' + col + '">&#9632;</span> ' + esc(e[0]) + ' - <b>' + e[1] + '</b> (' + Math.round(frac * 100) + '%)');
    });
    const leg = $('statsLegendLive'); if (leg) leg.innerHTML = legend.join('<br>');
  }

  function loadHistoryScan(id) {
    fetch('/api/history/' + encodeURIComponent(id)).then(r => r.json()).then(j => {
      if (!j.ok) { $('scanStatus').textContent = 'History load failed'; return; }
      const data = j.data;
      const analysis = NetFaultAnalyzer.analyze(data);
      lastResult = { data, analysis, source: 'history', ts: new Date(), historyId: id };
      renderLive(data, analysis);
      $('scanStatus').textContent = 'Loaded scan from history: ' + new Date(data.timestamp || Date.now()).toLocaleString();
      const w = data.wifi && data.wifi.data;
      drawGauge($('signalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : 'No WiFi');
      renderSignalMeta($('signalMeta'), data);
      drawTrace($('traceCanvas'), data, 'Traceroute to 8.8.8.8 - from history');
      document.querySelector('[data-tab="live"]').click();
      showHistDetail(data, analysis);
    }).catch(e => { $('scanStatus').textContent = 'History load error: ' + e.message; });
  }

  function showHistDetail(data, analysis) {
    const box = $('histDetailBox');
    if (!box) return;
    const conn = data.connectivity || {};
    const w = data.wifi && data.wifi.data;
    const active = conn.activeIface || null;
    box.className = '';
    box.innerHTML = '<table class="kv-table"><tbody>' +
      '<tr><td>Scan Time</td><td>' + (data.timestamp ? new Date(data.timestamp).toLocaleString() : '--') + '</td></tr>' +
      '<tr><td>Mode</td><td>' + esc(data.mode || 'wifi') + '</td></tr>' +
      '<tr><td>Interface</td><td>' + (active ? esc(active.name) + ' (' + esc(active.ipv4) + ')' : 'none') + '</td></tr>' +
      '<tr><td>Gateway</td><td>' + esc(conn.gateway || 'none') + '</td></tr>' +
      '<tr><td>WiFi SSID</td><td>' + (w ? esc(w.ssid) + ' (' + w.signalPct + '%)' : 'n/a') + '</td></tr>' +
      '<tr><td>Internet</td><td>' + (conn.internetReachable ? '<span style="color:var(--success)">Reachable</span>' : '<span style="color:var(--danger)">NOT reachable</span>') + '</td></tr>' +
      '<tr><td>DNS</td><td>' + (data.dns && data.dns.server ? esc(data.dns.server) + ' (' + data.dns.lookupMs + 'ms)' : 'FAILED') + '</td></tr>' +
      '<tr><td>Health Score</td><td>' + analysis.healthScore + '%</td></tr>' +
      '<tr><td>Status</td><td>' + analysis.status + '</td></tr>' +
      '<tr><td>Top Fault</td><td>' + esc((analysis.findings[0] || {}).title || 'None') + '</td></tr>' +
      '<tr><td>Scan Duration</td><td>' + (data.scanDurationMs ? (data.scanDurationMs / 1000).toFixed(1) + 's' : '--') + '</td></tr>' +
      '</tbody></table>';
  }

  function deleteHistoryScan(id) {
    fetch('/api/history/' + encodeURIComponent(id), { method: 'DELETE' }).then(r => r.json()).then(j => {
      if (j.ok) { loadHistory(); $('scanStatus').textContent = 'Scan deleted from history'; }
    });
  }

  function enrichHistWithFaults() {
    return Promise.all(histList.map(h =>
      fetch('/api/history/' + encodeURIComponent(h.id)).then(r => r.json()).then(j => {
        if (!j.ok) return;
        const a = NetFaultAnalyzer.analyze(j.data);
        const top = a.findings[0];
        h.topFault = (top && top.severity !== 'Healthy') ? top.title : 'Healthy';
      }).catch(() => { h.topFault = '--'; })
    ));
  }

  const origLoadHistory = loadHistory;
  loadHistory = function() {
    return fetch('/api/history').then(r => r.json()).then(j => {
      if (!j.ok) return;
      histList = j.list || [];
      histSelected = new Set();
      return enrichHistWithFaults();
    }).then(() => {
      renderHistoryTableLive();
      renderStatsPieLive();
      renderRecentOnLive();
    }).catch(() => {});
  };

  if ($('historyTableLive')) {
    $('historyTableLive').addEventListener('click', (ev) => {
      const cb = ev.target.closest('.hist-cb');
      if (cb) {
        const id = cb.dataset.id;
        if (cb.checked) {
          if (histSelected.size >= 2) { cb.checked = false; $('scanStatus').textContent = 'Select max 2 scans for comparison'; return; }
          histSelected.add(id);
        } else { histSelected.delete(id); }
        renderHistoryTableLive();
        return;
      }
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const tr = ev.target.closest('tr');
      if (tr && tr.dataset.id) {
        if (btn.dataset.act === 'load') loadHistoryScan(tr.dataset.id);
        else if (btn.dataset.act === 'del') deleteHistoryScan(tr.dataset.id);
      }
    });
  }

  if ($('btnHistCompare')) {
    $('btnHistCompare').addEventListener('click', () => {
      if (histSelected.size !== 2) { $('scanStatus').textContent = 'Select exactly 2 scans to compare'; return; }
      const ids = Array.from(histSelected);
      Promise.all(ids.map(id => fetch('/api/history/' + encodeURIComponent(id)).then(r => r.json())))
        .then(res => {
          if (!res[0].ok || !res[1].ok) { $('scanStatus').textContent = 'Compare failed'; return; }
          const a = res[0].data, b = res[1].data;
          const pa = a.connectivity && a.connectivity.pings, pb = b.connectivity && b.connectivity.pings;
          const wa = a.wifi && a.wifi.data, wb = b.wifi && b.wifi.data;
          const rows = [
            ['Timestamp', a.timestamp ? new Date(a.timestamp).toLocaleString() : '-', b.timestamp ? new Date(b.timestamp).toLocaleString() : '-', 0],
            ['Signal %', wa ? wa.signalPct : '--', wb ? wb.signalPct : '--', 1],
            ['Gateway RTT (ms)', pa && pa.gateway ? pa.gateway.avg : '--', pb && pb.gateway ? pb.gateway.avg : '--', 2],
            ['Internet RTT (ms)', pa && pa.internet ? pa.internet.avg : '--', pb && pb.internet ? pb.internet.avg : '--', 2],
            ['Internet loss %', pa && pa.internet ? pa.internet.lossPct : '--', pb && pb.internet ? pb.internet.lossPct : '--', 2],
            ['DNS time (ms)', a.dns && a.dns.lookupMs, b.dns && b.dns.lookupMs, 2],
            ['Scan duration (s)', a.scanDurationMs ? (a.scanDurationMs / 1000).toFixed(1) : '-', b.scanDurationMs ? (b.scanDurationMs / 1000).toFixed(1) : '-', 2],
            ['Top fault', (NetFaultAnalyzer.analyze(a).findings[0] || {}).title, (NetFaultAnalyzer.analyze(b).findings[0] || {}).title, 0]
          ];
          $('histCompareBoxLive').innerHTML = '<div class="row-sub" style="margin:10px 0 6px">Comparison - scan 1 vs scan 2 (green = improved, red = worse)</div>' +
            '<table class="mini-table"><thead><tr><th>Metric</th><th>Scan 1</th><th>Scan 2</th><th>Delta</th></tr></thead><tbody>' +
            rows.map(r => {
              const va = r[1], vb = r[2];
              let delta = '--', cls = 'delta-same';
              if (typeof va === 'number' && typeof vb === 'number') {
                const d = Math.round((vb - va) * 10) / 10;
                if (r[3] === 1) { delta = d + ' pts'; cls = d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : 'delta-same'; }
                else if (r[3] === 2) { delta = d; cls = d < 0 ? 'delta-up' : d > 0 ? 'delta-down' : 'delta-same'; }
              }
              return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1])) + '</td><td>' + esc(String(r[2])) + '</td><td class="' + cls + '">' + delta + '</td></tr>';
            }).join('') + '</tbody></table>';
          $('histCompareBoxLive').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });
  }

  if ($('btnHistClear')) {
    $('btnHistClear').addEventListener('click', () => {
      fetch('/api/history', { method: 'DELETE' }).then(r => r.json()).then(j => {
        if (j.ok) { histList = []; histSelected = new Set(); renderHistoryTableLive(); renderStatsPieLive(); renderRecentOnLive(); $('scanStatus').textContent = 'Scan history cleared'; }
      });
    });
  }

  if ($('btnHistRefresh')) {
    $('btnHistRefresh').addEventListener('click', () => { loadHistory(); });
  }

  if ($('histSearchLive')) {
    $('histSearchLive').addEventListener('input', (e) => { histSearchText = e.target.value; renderHistoryTableLive(); });
  }

  document.querySelectorAll('#historyTableLive th.sortable-hist').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (!k) return;
      if (histSortKey === k) histSortDir *= -1;
      else { histSortKey = k; histSortDir = -1; }
      renderHistoryTableLive();
    });
  });

  /* ---------------- Preflight + banners ---------------- */
  let _preflightResult = null;

  function showPreflightBanners(pf) {
    const container = $('preflightBanners');
    if (!container) return;
    container.innerHTML = '';
    if (!pf || !pf.ok) return;
    function addBanner(type, icon, title, detail, pathStr) {
      const b = document.createElement('div');
      b.className = 'preflight-banner preflight-banner--' + type;
      b.setAttribute('role', 'status');
      b.innerHTML = '<span class="preflight-banner__icon" aria-hidden="true">' + icon + '</span>' +
        '<div class="preflight-banner__body">' +
        '<span class="preflight-banner__title">' + esc(title) + '</span>' +
        (detail ? ' — ' + esc(detail) : '') +
        (pathStr ? '<div class="preflight-banner__path">' + esc(pathStr) + '</div>' : '') +
        '</div>';
      container.appendChild(b);
    }
    if (pf.platform && pf.platform !== 'win32') {
      addBanner('error', '🚫', 'Unsupported platform', pf.platform + ' — live scans require Windows. Use Simulation Lab.', null);
    }
    if (pf.locationPermission === 'blocked') {
      addBanner('warn', '📍', t('preflight-location-blocked'), 'WiFi neighbor scan will be empty.',
        t('preflight-location-path'));
    }
    if (pf.isAdmin === false) {
      addBanner('info', 'ℹ️', t('preflight-not-admin'), null, null);
    }
    if (pf.wlanAvailable === false) {
      addBanner('warn', '📶', t('preflight-wlan-missing'), null, null);
    }
  }

  async function runPreflight() {
    try {
      const r = await fetch('/api/preflight');
      const pf = await r.json();
      _preflightResult = pf;
      showPreflightBanners(pf);
      return pf;
    } catch (e) {
      _preflightResult = null;
      return null;
    }
  }

  /* ---------------- Server check + preflight on load ---------------- */
  (async function init() {
    const chip = $('connChip');
    try {
      const r = await fetch('/api/health');
      if (r.ok) { chip.textContent = 'Server Online'; chip.classList.add('ok'); }
      else throw new Error('bad');
    } catch (e) {
      chip.textContent = 'Server Offline - run node server.js';
      chip.classList.add('err');
      return; // skip preflight if server offline
    }
    await runPreflight();
  })();

  /* ---------------- Live Scan (POST + UNSUPPORTED_PLATFORM handling) ---------------- */
  const SCAN_STEPS = [
    'Reading WiFi adapter (netsh wlan)...',
    'Scanning neighbor networks...',
    'Reading interfaces + IP config...',
    'Pinging gateway...',
    'Pinging 8.8.8.8 / 1.1.1.1...',
    'DNS lookup (nslookup)...',
    'Traceroute to 8.8.8.8...',
    'Analyzing root cause...'
  ];

  let scanAbort = null;

  function showDataQualityWarnings(dq, containerEl) {
    if (!containerEl || !dq) return;
    const warns = dq.warnings || [];
    const failed = dq.coreCommandsFailed || [];
    if (!warns.length && !failed.length) { containerEl.innerHTML = ''; return; }
    let html = '';
    warns.forEach(w => {
      html += '<div class="preflight-banner preflight-banner--warn" role="status">' +
        '<span class="preflight-banner__icon" aria-hidden="true">⚠️</span>' +
        '<div class="preflight-banner__body"><span class="preflight-banner__title">Data quality warning</span> — ' + esc(w) + '</div></div>';
    });
    if (failed.length) {
      html += '<div class="preflight-banner preflight-banner--error" role="status">' +
        '<span class="preflight-banner__icon" aria-hidden="true">❌</span>' +
        '<div class="preflight-banner__body"><span class="preflight-banner__title">Core commands failed</span> — ' + esc(failed.join(', ')) + '. Results may be incomplete.</div></div>';
    }
    containerEl.innerHTML = html;
  }

  async function runLiveScan(statusEl, progEl, onComplete) {
    const btn = $('btnScan');
    const cancelBtn = $('btnScanCancel');
    const prog = progEl || $('scanProgress');
    const status = statusEl || $('scanStatus');
    if (scanAbort) { status.textContent = 'A scan is already running'; return null; }

    // Run preflight check first
    const pf = await runPreflight();
    if (pf && pf.ok && pf.platform && pf.platform !== 'win32') {
      status.textContent = 'Live scan not available on this platform. Use Simulation Lab.';
      return null;
    }

    scanAbort = new AbortController();
    if (btn) btn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    if ($('btnSaveReport')) $('btnSaveReport').disabled = true;
    if (prog) {
      prog.className = 'scan-progress';
      prog.innerHTML = '<div class="fill"></div>';
    }
    const fill = prog ? prog.querySelector('.fill') : null;
    const timer = setInterval(() => {
      if (!fill) return;
      const p = Math.min(88, (fill.style.width ? parseFloat(fill.style.width) : 0) + 2 + Math.random() * 4);
      fill.style.width = p + '%';
      status.textContent = SCAN_STEPS[Math.min(SCAN_STEPS.length - 1, Math.floor(p / 88 * SCAN_STEPS.length))];
    }, 320);

    let resultData = null;
    try {
      // Use POST /api/scan per contract (preferred over GET)
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: scanAbort.signal
      });
      const json = await res.json();
      clearInterval(timer);

      // Handle UNSUPPORTED_PLATFORM (501)
      if (!json.ok && json.code === 'UNSUPPORTED_PLATFORM') {
        if (fill) fill.style.width = '100%';
        if (prog) prog.classList.add('fail');
        status.textContent = json.hint || json.error || 'Unsupported platform';
        showPreflightBanners({ ok: true, platform: 'unsupported' });
        return null;
      }

      if (!json.ok) throw new Error(json.error || 'scan failed');
      if (fill) fill.style.width = '100%';
      if (prog) prog.classList.add('done');
      const dur = json.data.scanDurationMs ? (json.data.scanDurationMs / 1000).toFixed(1) + 's' : '?s';
      status.textContent = 'Scan complete in ' + dur;
      const analysis = NetFaultAnalyzer.analyze(json.data);
      lastResult = { data: json.data, analysis, source: 'live', ts: new Date(), scanId: json.data.id };
      renderLive(json.data, analysis);
      loadHistory();
      if ($('btnSaveReport')) $('btnSaveReport').disabled = false;
      $('connChip').textContent = 'Server Online'; $('connChip').className = 'status-chip ok';
      // Show data quality warnings
      showDataQualityWarnings(json.data.dataQuality, $('tsDataQualityWarnings'));
      resultData = json.data;
      if (onComplete) onComplete(json.data, analysis);
    } catch (e) {
      clearInterval(timer);
      if (scanAbort && scanAbort.signal.aborted) {
        if (prog) prog.classList.add('fail');
        if (fill) fill.style.width = '100%';
        status.textContent = 'Scan cancelled - nothing saved to history';
      } else {
        if (prog) prog.classList.add('fail');
        if (fill) fill.style.width = '100%';
        status.textContent = 'Error: ' + e.message;
        $('connChip').textContent = 'Server Offline - run node server.js';
        $('connChip').className = 'status-chip err';
      }
    } finally {
      if (btn) btn.disabled = false;
      if (cancelBtn) cancelBtn.style.display = 'none';
      scanAbort = null;
    }
    return resultData;
  }
  $('btnScan').addEventListener('click', () => runLiveScan());
  $('btnScanCancel').addEventListener('click', () => { if (scanAbort) scanAbort.abort(); });

  /* ---------------- Simulation ---------------- */
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simMode = btn.dataset.mode;
      simSelected = null;
      renderScenarioList();
    });
  });

  function renderScenarioList() {
    const list = $('scenarioList');
    list.innerHTML = '';
    NetFaultScenarios.getScenarios(simMode).forEach(s => {
      const card = document.createElement('div');
      card.className = 'scenario-card' + (simSelected === s.id ? ' active' : '');
      card.innerHTML = '<div class="sc-name">' + esc(s.name) + '</div>' +
        '<div class="sc-desc">' + esc(s.desc) + '</div>' +
        '<span class="sc-tag">' + esc(s.tag) + '</span>';
      card.addEventListener('click', () => {
        simSelected = s.id;
        renderScenarioList();
      });
      list.appendChild(card);
    });
  }
  renderScenarioList();

  function runSimulation() {
    if (!simSelected) {
      $('simFaultPanel').innerHTML = '<div class="placeholder">Please select a scenario first.</div>';
      return;
    }
    const sc = NetFaultScenarios.getScenario(simMode, simSelected);
    const data = sc.generate();
    const analysis = NetFaultAnalyzer.analyze(data);
    lastResult = { data, analysis, source: 'sim', ts: new Date(), scenario: sc.name };
    renderSim(data, analysis);
    $('scanStatus').textContent = 'Simulation: ' + sc.name + ' (' + sc.tag + ')';
  }
  $('btnSimRun').addEventListener('click', runSimulation);

  /* ---------------- Shared renderers ---------------- */
  function statusColor(status) {
    return { 'Critical': '#f85149', 'High': '#f85149', 'Medium': '#d29922', 'Low': '#d29922', 'Healthy': '#3fb950' }[status] || '#8b98a9';
  }

  function renderFaults(panelEl, osiEl, analysis, data) {
    if (analysis.insufficientData) {
      osiEl.textContent = 'Insufficient Data';
      osiEl.className = 'osi-indicator sev-Healthy';
      panelEl.innerHTML = '<div class="placeholder"><strong>Insufficient data to diagnose.</strong><p style="margin:8px 0 0">' + esc(analysis.headline || '') + '</p></div>';
      return;
    }
    osiEl.textContent = 'OSI Layer: ' + (analysis.osiLayer ? analysis.osiLayer.label : '--') +
      '  |  Health: ' + (analysis.healthScore != null ? analysis.healthScore + '%' : '--') + '  |  Status: ' + analysis.status;
    osiEl.className = 'osi-indicator sev-' + analysis.status;
    panelEl.innerHTML = '';
    if (!analysis.findings.length) {
      panelEl.innerHTML = '<div class="placeholder">No faults detected.</div>';
      return;
    }
    analysis.findings.forEach(f => {
      const card = document.createElement('div');
      card.className = 'fault-card sev-' + f.severity;
      // Build evidence refs chips
      const refsHtml = (f.evidenceRefs || []).map(r =>
        '<span class="evidence-panel__ref-chip">' + esc(r.source) + '.' + esc(r.key) + ' = ' + esc(String(r.value)) + '</span>'
      ).join('');
      // Build raw evidence snippet from scan data (only fields present in contract)
      const rawSnippetId = 'raw-ev-' + esc(f.id) + '-' + Math.random().toString(36).slice(2, 7);
      card.innerHTML =
        '<div class="fc-head"><span class="fc-title">' + esc(f.title) + '</span>' +
        '<span class="fc-sev">' + esc(f.severity) + '</span></div>' +
        '<div class="fc-cause"><b>Root Cause:</b> ' + esc(f.rootCause) + '</div>' +
        '<div class="fc-conf">Confidence: <b>' + Math.round(f.confidence) + '%</b>' +
        '<div class="conf-bar"><i style="width:' + Math.round(f.confidence) + '%"></i></div></div>' +
        '<div class="fc-fix">&#128296; ' + esc(f.fix) + '</div>' +
        '<div class="fc-layer">' + esc(f.layer ? f.layer.label : '') + '</div>' +
        // Evidence panel
        '<div class="evidence-panel">' +
        '<p class="evidence-panel__heading">Evidence</p>' +
        '<p class="evidence-panel__text">' + esc(f.evidence) + '</p>' +
        (refsHtml ? '<div class="evidence-panel__refs">' + refsHtml + '</div>' : '') +
        (f.disproveIf ? '<div class="evidence-panel__disprove"><b>What would disprove this:</b> ' + esc(f.disproveIf) + '</div>' : '') +
        '<button class="evidence-raw-toggle" data-target="' + rawSnippetId + '" type="button">&#9660; Show raw evidence</button>' +
        '<pre id="' + rawSnippetId + '" class="evidence-raw-pre" style="display:none"></pre>' +
        '</div>';
      panelEl.appendChild(card);
      // Populate raw evidence pre element lazily on toggle
      const rawBtn = card.querySelector('.evidence-raw-toggle');
      const rawPre = card.querySelector('#' + rawSnippetId);
      if (rawBtn && rawPre) {
        rawBtn.addEventListener('click', () => {
          const isOpen = rawPre.style.display !== 'none';
          rawPre.style.display = isOpen ? 'none' : 'block';
          rawBtn.textContent = (isOpen ? '\u25BC Show raw evidence' : '\u25B2 Hide raw evidence');
          if (!isOpen && data) {
            // Build raw evidence from scan data referenced by evidenceRefs
            const rawLines = [];
            (f.evidenceRefs || []).forEach(r => {
              const parts = r.source.split('.');
              let val = data;
              for (const p of parts) { if (val && typeof val === 'object') val = val[p]; else { val = undefined; break; } }
              rawLines.push(r.source + '.' + r.key + ' = ' + JSON.stringify(val !== undefined ? (typeof val === 'object' ? (val[r.key] !== undefined ? val[r.key] : val) : val) : r.value));
            });
            rawPre.textContent = rawLines.length ? rawLines.join('\n') : JSON.stringify({ finding: f.id }, null, 2);
          }
        });
      }
    });
  }

  function buildTopoNodes(data) {
    const conn = data.connectivity || {};
    const trace = data.trace || { hops: [] };
    const active = conn.activeIface || null;
    const modeLabel = { wifi: 'PC', lan: 'PC', mobile: 'Phone' }[data.mode || 'wifi'] || 'PC';
    const modeType = { wifi: 'pc', lan: 'pc', mobile: 'phone' }[data.mode || 'wifi'] || 'pc';
    const nodes = [];
    nodes.push({ label: modeLabel, sub: active ? active.ipv4 : 'no IP', color: active && active.ipv4 ? 'good' : 'bad', type: modeType });
    const gwCol = conn.gatewayReachable === false ? 'bad' : (conn.hasGateway ? 'good' : 'bad');
    nodes.push({ label: 'Gateway', sub: conn.gateway || 'none', color: gwCol, type: 'router' });
    const hops = trace.hops.slice(0, 5);
    hops.forEach(h => {
      const col = h.lossPct === 100 ? 'bad' : (h.lossPct > 0 ? 'warn' : 'good');
      nodes.push({ label: 'H' + h.hop, sub: h.ip, color: col, loss: h.lossPct, type: 'hop' });
    });
    nodes.push({ label: 'Internet', sub: '8.8.8.8', color: conn.internetReachable === false ? 'bad' : 'good', type: 'internet' });
    return nodes;
  }

  function drawNodeIcon(ctx, type, x, y, r, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (type === 'pc' || type === 'phone') {
      const w = r * 1.1, h = r * 0.85;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(x - w / 2.6, y + h / 2 + 3);
      ctx.lineTo(x + w / 2.6, y + h / 2 + 3);
      ctx.stroke();
      if (type === 'phone') {
        ctx.fillStyle = color;
        ctx.fillRect(x - 1.5, y - h / 4, 3, 6);
      }
    } else if (type === 'router') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r * 0.6, y + Math.sin(ang) * r * 0.6);
        ctx.lineTo(x + Math.cos(ang) * r * 0.9, y + Math.sin(ang) * r * 0.9);
        ctx.stroke();
      }
    } else if (type === 'internet') {
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y, r * 0.5, 0, Math.PI * 2);
      ctx.arc(x + r * 0.2, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
      ctx.arc(x + r * 0.35, y + r * 0.1, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTopology(canvas, data) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const nodes = buildTopoNodes(data);
    const colors = { good: '#34d399', warn: '#fbbf24', bad: '#f87171', unknown: '#8b98a9' };
    const N = nodes.length;
    const startX = 58, endX = W - 58;
    const spacing = N > 1 ? (endX - startX) / (N - 1) : 0;
    const r = N > 1 ? Math.max(13, Math.min(30, spacing * 0.36)) : 30;
    const labelSize = Math.max(10, Math.min(12, spacing * 0.2));
    const showSub = spacing >= 54;
    const showLoss = spacing >= 52;
    const xPos = [];
    for (let i = 0; i < N; i++) {
      xPos.push(N === 1 ? W / 2 : startX + spacing * i);
    }
    const yMid = H / 2;
    for (let i = 0; i < N - 1; i++) {
      const c = nodes[i + 1].color;
      ctx.beginPath();
      ctx.moveTo(xPos[i] + r + 4, yMid);
      ctx.lineTo(xPos[i + 1] - r - 4, yMid);
      ctx.strokeStyle = c === 'bad' ? 'rgba(248,113,113,0.9)' : (c === 'warn' ? 'rgba(251,191,36,0.6)' : 'rgba(34,211,238,0.55)');
      ctx.lineWidth = c === 'bad' ? 3 : 2;
      ctx.setLineDash(c === 'bad' ? [7, 5] : []);
      ctx.shadowColor = c === 'bad' ? '#f87171' : 'transparent';
      ctx.shadowBlur = c === 'bad' ? 10 : 0;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }
    nodes.forEach((n, i) => {
      const x = xPos[i];
      const isEnd = i === 0 || i === N - 1;
      const nr = isEnd ? r + 6 : r;
      const color = colors[n.color] || colors.unknown;
      ctx.beginPath();
      ctx.arc(x, yMid, nr, 0, Math.PI * 2);
      const grd = ctx.createRadialGradient(x, yMid, 2, x, yMid, nr);
      grd.addColorStop(0, color + '33');
      grd.addColorStop(1, color + '0d');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = n.color === 'bad' ? 16 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      drawNodeIcon(ctx, n.type, x, yMid, nr - 7, color);
      ctx.fillStyle = '#e8eef7';
      ctx.font = 'bold ' + labelSize + 'px Segoe UI';
      ctx.textAlign = 'center';
      const label = (n.label.length > 9 && spacing < 70) ? n.label.slice(0, 8) + '..' : n.label;
      ctx.fillText(label, x, yMid - nr - 8);
      if (showSub) {
        ctx.font = (spacing < 70 ? 9 : 10) + 'px Consolas';
        ctx.fillStyle = '#8b98a9';
        ctx.fillText(shortIp(n.sub), x, yMid + nr + 16);
      }
      if (n.loss && showLoss) {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 10px Consolas';
        ctx.fillText('loss ' + n.loss + '%', x, yMid + nr + 30);
      }
    });
  }

  function shortIp(ip) {
    if (!ip) return '--';
    if (ip.length > 13) return ip.slice(0, 12) + '..';
    return ip;
  }

  function drawGauge(canvas, pct, metaText) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H - 34, r = Math.min(W / 2 - 40, 88);
    if (pct === null || typeof pct !== 'number') {
      ctx.fillStyle = '#8b98a9';
      ctx.font = 'bold 16px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('Wired Connection - Signal N/A', cx, cy - r / 2);
      if (metaText) {
        ctx.font = '12px Consolas';
        ctx.fillText(metaText, cx, cy - r / 2 + 24);
      }
      return;
    }
    const color = pct >= 75 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.strokeStyle = 'rgba(10,14,23,0.95)';
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI * (1 - pct / 100));
    ctx.strokeStyle = color;
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let t = 0; t <= 10; t++) {
      const ang = Math.PI + Math.PI * t / 10;
      const r1 = r + 13, r2 = t % 5 === 0 ? r + 19 : r + 16;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy - Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy - Math.sin(ang) * r2);
      ctx.strokeStyle = t % 5 === 0 ? '#4b5a75' : '#33415e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const angN = Math.PI + Math.PI * pct / 100;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angN) * (r - 26), cy - Math.sin(angN) * (r - 26));
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#e8eef7';
    ctx.font = 'bold 36px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(pct + '%', cx, cy - 20);
    ctx.fillStyle = color;
    ctx.font = 'bold 12px Segoe UI';
    ctx.fillText('SIGNAL STRENGTH', cx, cy + 14);
    if (metaText) {
      ctx.fillStyle = '#8b98a9';
      ctx.font = '11.5px Consolas';
      ctx.fillText(metaText, cx, cy + 28);
    }
    ctx.fillStyle = '#4b5a75';
    ctx.font = '10px Consolas';
    ctx.textAlign = 'left';
    ctx.fillText('0%', cx - r - 12, cy + 4);
    ctx.textAlign = 'right';
    ctx.fillText('100%', cx + r + 12, cy + 4);
  }

  function drawTrace(canvas, data, title) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const hops = (data.trace && data.trace.hops) || [];
    ctx.fillStyle = '#8b98a9';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText(title || 'Traceroute - latency per hop (ms)', 10, 18);
    if (!hops.length) {
      ctx.fillStyle = '#8b98a9';
      ctx.textAlign = 'center';
      ctx.font = '13px Segoe UI';
      ctx.fillText('No route available', W / 2, H / 2);
      return;
    }
    const padL = 44, padB = 30, padT = 34;
    const chartW = W - padL - 14;
    const chartH = H - padT - padB;
    const maxV = Math.max(100, ...hops.map(h => Math.max(...h.times.filter(t => t !== null), 0)));
    const barW = Math.min(42, (chartW / hops.length) * 0.55);
    const gap = hops.length > 1 ? (chartW - barW) / (hops.length - 1) : 0;
    const maxY = Math.ceil(maxV / 50) * 50;
    ctx.strokeStyle = '#26334d';
    ctx.setLineDash([4, 5]);
    for (let g = 0; g <= 4; g++) {
      const y = padT + chartH - (chartH * g / 4);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - 10, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Consolas';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxY * g / 4)), padL - 6, y + 3);
    }
    ctx.setLineDash([]);
    hops.forEach((h, i) => {
      const x = padL + i * gap;
      const samples = h.times.filter(t => t !== null);
      if (samples.length) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const bh = Math.max(5, chartH * avg / maxY);
        const base = padT + chartH - bh;
        const col = h.lossPct >= 100 ? '#f87171' : h.lossPct > 0 ? '#fbbf24' : '#22d3ee';
        const grd = ctx.createLinearGradient(0, base, 0, padT + chartH);
        grd.addColorStop(0, col);
        grd.addColorStop(1, col + '55');
        ctx.fillStyle = grd;
        ctx.beginPath();
        const rad = Math.min(6, barW / 2);
        roundRectPath(ctx, x, base, barW, bh, rad);
        ctx.fill();
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        ctx.fillStyle = col;
        ctx.fillRect(x, base, barW, 2);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e8eef7';
        ctx.font = 'bold 11px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(avg)), x + barW / 2, base - 6);
      } else {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 15px Segoe UI';
        ctx.textAlign = 'center';
        ctx.fillText('X', x + barW / 2, padT + chartH / 2);
      }
      ctx.fillStyle = h.lossPct >= 100 ? '#f87171' : h.lossPct > 0 ? '#fbbf24' : '#8b98a9';
      ctx.font = 'bold 10px Consolas';
      ctx.fillText(h.lossPct + '%', x + barW / 2, padT + chartH + 12);
      ctx.fillStyle = '#8b98a9';
      ctx.font = '10px Consolas';
      ctx.fillText('h' + h.hop, x + barW / 2, padT + chartH + 24);
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderNeighbors(tableEl, data) {
    const tbody = tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    const list = (data.neighbors || []).slice(0, 8);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#8b98a9">No neighboring networks found</td></tr>';
      return;
    }
    list.forEach(n => {
      const cls = n.signalPct >= 50 ? 'sig-good' : n.signalPct >= 25 ? 'sig-mid' : 'sig-bad';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(n.ssid || 'hidden') + '</td>' +
        '<td>' + esc(n.channel) + '</td>' +
        '<td>' + n.signalPct + '%<span class="sig-bar ' + cls + '"><i style="width:' + n.signalPct + '%"></i></span></td>' +
        '<td>' + esc(n.auth || '-') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function buildEvidence(data) {
    const conn = data.connectivity || {};
    const active = conn.activeIface || null;
    const w = data.wifi && data.wifi.data;
    const lines = [];
    lines.push('Scan time : ' + (data.timestamp ? new Date(data.timestamp).toLocaleString() : '-'));
    lines.push('Mode      : ' + (data.mode || 'wifi'));
    lines.push('');
    lines.push('-- ACTIVE INTERFACE --');
    lines.push('Interface : ' + (active ? active.name : 'none') + (active ? ' (' + active.ipv4 + ')' : ''));
    lines.push('Subnet    : ' + (active ? active.subnet || '-' : 'n/a'));
    lines.push('Gateway   : ' + (conn.gateway || 'none') + (conn.gatewayArp ? ' [ARP ' + conn.gatewayArp.mac + (conn.gatewayArp.vendor ? ' | ' + conn.gatewayArp.vendor + ']' : ']') : ''));
    lines.push('DHCP      : ' + (active ? (active.dhcp ? 'Enabled, server ' + (active.dhcpServer || '-') : 'Disabled') : 'n/a') + (active && active.apipa ? ' -> APIPA 169.254!' : ''));
    lines.push('MAC       : ' + (active ? active.mac || '-' : 'n/a'));
    lines.push('');
    lines.push('-- WIFI --');
    lines.push('WiFi      : ' + (w ? w.ssid + ' | signal ' + (w.signalPct == null ? '-' : w.signalPct + '%') + ' | ch ' + (w.channel || '-') + ' | ' + (w.radioType || '-') + ' | ' + (w.auth || '-') + ' | Rx ' + (w.rxRate || '-') + ' / Tx ' + (w.txRate || '-') + ' Mbps' : 'not connected / not available'));
    const pgs = ['gateway', 'internet', 'alt'];
    const pgNames = { gateway: 'gateway', internet: '8.8.8.8', alt: '1.1.1.1' };
    lines.push('');
    lines.push('-- PING RESULTS --');
    pgs.forEach(k => {
      const p = conn.pings && conn.pings[k];
      if (!p) { lines.push('Ping ' + pgNames[k] + ' : n/a'); return; }
      lines.push('Ping ' + pgNames[k] + ' : sent ' + p.sent + ' | recv ' + p.received + ' | loss ' + p.lossPct + '% | min ' + (p.min === null ? '-' : p.min + 'ms') + ' | avg ' + (p.avg === null ? '-' : p.avg + 'ms') + ' | max ' + (p.max === null ? '-' : p.max + 'ms') + ' | jitter ' + p.jitter + 'ms');
    });
    lines.push('');
    lines.push('-- DNS --');
    lines.push('DNS       : ' + (data.dns && data.dns.server ? data.dns.server + ' (' + data.dns.address + ') in ' + data.dns.lookupMs + 'ms' : 'FAILED'));
    if (data.dns && Array.isArray(data.dns.tests)) {
      data.dns.tests.forEach(t => lines.push('DNS test  : ' + t.server + ' = ' + t.ms + 'ms ' + (t.ok ? 'OK' : 'FAIL')));
    }
    lines.push('-- MTU / IPv6 --');
    lines.push('MTU       : ' + (data.mtu && data.mtu.mtu ? data.mtu.mtu + ' bytes (payload ' + data.mtu.payload + ')' : 'n/a'));
    lines.push('IPv6      : ' + (data.ipv6 ? ((data.ipv6.enabled ? 'Enabled' : 'Disabled') + ', loopback ' + (data.ipv6.loopbackOk ? 'OK' : 'FAIL') + ', internet ' + (data.ipv6.internetOk ? 'OK' : 'n/a')) : 'n/a'));
    lines.push('');
    lines.push('-- INTERFACES --');
    (data.interfaces || []).forEach(i => lines.push('  ' + i.name + ' : admin=' + i.adminState + ', state=' + i.state));
    if (!(data.interfaces || []).length) lines.push('  (none reported)');
    lines.push('');
    lines.push('-- ARP TABLE (' + ((data.arp || []).length) + ' entries) --');
    (data.arp || []).slice(0, 10).forEach(e => lines.push('  ' + e.ip + '  ' + e.mac + '  ' + e.type));
    if (!(data.arp || []).length) lines.push('  (empty)');
    lines.push('');
    lines.push('-- NEIGHBOR NETWORKS (' + ((data.neighbors || []).length) + ') --');
    (data.neighbors || []).slice(0, 10).forEach(n => lines.push('  ' + n.ssid + ' | ch ' + n.channel + ' | ' + n.signalPct + '% | ' + n.radioType + ' | ' + n.auth));
    lines.push('');
    lines.push('-- TRACEROUTE (' + ((data.trace && data.trace.hops) || []).length + ' hops) --');
    ((data.trace && data.trace.hops) || []).forEach(h => lines.push('  hop ' + h.hop + ' : ' + h.ip + ' | times ' + (h.times || []).map(t => t === null ? '*' : t + 'ms').join(', ') + ' | loss ' + h.lossPct + '%'));
    return lines.join('\n');
  }

  function renderSignalMeta(el, data) {
    const w = data.wifi && data.wifi.data;
    if (!w) {
      el.textContent = 'WiFi not connected (wired/cellular mode)';
      return;
    }
    const dbm = typeof w.signalPct === 'number' ? NetFaultAnalyzer.pctToDbm(w.signalPct) : 'n/a';
    // Label dBm as an estimate per contract (pctToDbmNumber is a linear approximation)
    el.textContent = (w.ssid || '-') + ' | RSSI ' + dbm + ' (estimated from signal %) | Channel ' + (w.channel || '-') + ' | ' + (w.radioType || '-') + ' | ' + (w.auth || '-');
  }

  function renderLive(data, analysis) {
    renderFaults($('faultPanel'), $('osiIndicator'), analysis, data);
    drawTopology($('topologyCanvas'), data);
    const w = data.wifi && data.wifi.data;
    drawGauge($('signalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : (data.mode === 'lan' ? 'Wired link' : 'No WiFi'));
    renderSignalMeta($('signalMeta'), data);
    renderNeighbors($('neighborTable'), data);
    drawTrace($('traceCanvas'), data, 'Traceroute to 8.8.8.8 - real');
    $('evidenceBox').textContent = buildEvidence(data);
    updateReportTab();
  }

  function renderSim(data, analysis) {
    renderFaults($('simFaultPanel'), $('simOsiIndicator'), analysis, data);
    drawTopology($('simTopoCanvas'), data);
    const w = data.wifi && data.wifi.data;
    const label = data.meta && data.meta.signalLabel;
    drawGauge($('simSignalCanvas'), w ? w.signalPct : null, w ? ('SSID: ' + w.ssid) : 'No wireless');
    $('simSignalMeta').textContent = label || (w ? 'Simulated signal: ' + w.signalPct + '%' : 'Wireless not connected');
    drawTrace($('simTraceCanvas'), data, 'Traceroute - simulated');
    updateReportTab();
  }

  /* ---------------- Redaction helper ---------------- */
  function redactReportHtml(html) {
    // Redact SSID-like strings (quoted strings near "SSID"), BSSIDs (MAC-like XX:XX:XX:XX:XX:XX),
    // MACs, and GPS coordinates (decimal lat/lng patterns).
    // NOTE: This is browser-side best-effort redaction. Warn user to review output.
    return html
      // Redact MAC / BSSID patterns (XX:XX:XX:XX:XX:XX)
      .replace(/\b([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g, '[MAC REDACTED]')
      // Redact GPS decimal coordinates (e.g. 28.6139, 77.2090)
      .replace(/\b-?\d{1,3}\.\d{4,7},?\s*-?\d{1,3}\.\d{4,7}\b/g, '[GPS REDACTED]')
      // Redact SSID values after "SSID:" patterns in evidence
      .replace(/(SSID\s*[:=]\s*)([^\n<|,]{1,64})/gi, '$1[SSID REDACTED]');
  }

  /* ---------------- Report source badge HTML ---------------- */
  function sourceBadgeHtml(source) {
    const map = { live: ['LIVE', '#b91c1c', '#fef2f2'], sim: ['SIMULATED', '#15803d', '#f0fdf4'], history: ['REPLAY', '#1d4ed8', '#eff6ff'] };
    const [label, color, bg] = map[source] || ['UNKNOWN', '#6b7280', '#f3f4f6'];
    return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.7px;text-transform:uppercase;background:' + bg + ';color:' + color + ';border:1.5px solid ' + color + '22">' + label + '</span>';
  }

  function reportSourceLabel() {
    if (lastResult.source === 'live') return 'LIVE SCAN (real network diagnostics)';
    if (lastResult.source === 'history') return 'REPLAY (saved scan' + (lastResult.historyId ? ' — ' + lastResult.historyId : '') + ')';
    return 'SIMULATED' + (lastResult.scenario ? ' — ' + lastResult.scenario : '');
  }

  function buildReportHtml(data, analysis, opts) {
    // opts: { redact: bool, verifyResult: object|null }
    opts = opts || {};
    const redact = opts.redact !== false; // default ON
    const source = reportSourceLabel();
    const badgeHtml = sourceBadgeHtml(lastResult ? lastResult.source : 'live');
    const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const findingsHtml = analysis.insufficientData
      ? '<div style="padding:16px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b"><strong>Insufficient data to diagnose</strong><p style="margin:6px 0 0">' + escHtml(analysis.headline || '') + '</p></div>'
      : analysis.findings.map(f => {
          const refsHtml = (f.evidenceRefs || []).map(r =>
            '<code style="font-size:11px;background:#f6f8fa;padding:2px 6px;border-radius:4px;margin:2px">' + escHtml(r.source + '.' + r.key + ' = ' + r.value) + '</code>'
          ).join(' ');
          return '<div style="border-left:4px solid ' + statusColor(f.severity) + ';padding:10px 14px;margin:10px 0;background:#f6f8fa;border-radius:6px">' +
            '<div style="font-weight:700;font-size:15px">' + escHtml(f.title) + ' <span style="color:' + statusColor(f.severity) + '">[' + escHtml(f.severity) + ']</span></div>' +
            '<div style="margin-top:4px"><b>Root Cause:</b> ' + escHtml(f.rootCause) + '</div>' +
            '<div style="color:#57606a;margin-top:6px"><b>Evidence:</b> ' + escHtml(f.evidence) + '</div>' +
            (refsHtml ? '<div style="margin-top:4px">' + refsHtml + '</div>' : '') +
            (f.disproveIf ? '<div style="color:#6e40c9;margin-top:6px;font-style:italic"><b>What would disprove this:</b> ' + escHtml(f.disproveIf) + '</div>' : '') +
            '<div style="color:#1a7f37;margin-top:6px">&#128296; Fix: ' + escHtml(f.fix) + '</div>' +
            '<div style="color:#8250df;margin-top:4px">' + escHtml(f.layer ? f.layer.label : '') + ' &bull; Confidence ' + Math.round(f.confidence) + '%</div>' +
            '</div>';
        }).join('');

    const gw = data.connectivity && data.connectivity.gateway;
    const active = data.connectivity && data.connectivity.activeIface;
    const w = data.wifi && data.wifi.data;
    const summary = '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>Status</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + escHtml(analysis.status) + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>Health Score</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + (analysis.healthScore != null ? analysis.healthScore + '%' : 'N/A') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>OSI Layer</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + escHtml(analysis.osiLayer ? analysis.osiLayer.label : '-') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>Interface</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + (active ? escHtml(active.name) + ' (' + escHtml(active.ipv4) + ')' : 'none') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>Gateway</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + escHtml(gw || 'none') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>WiFi Signal</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + (w ? w.signalPct + '% (' + escHtml(w.ssid) + ')' : 'n/a') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>Internet</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + (data.connectivity && data.connectivity.internetReachable ? 'Reachable' : 'NOT reachable') + '</td></tr>' +
      '<tr><td style="padding:5px 8px;border:1px solid #d0d7de;background:#f6f8fa"><b>DNS</b></td><td style="padding:5px 8px;border:1px solid #d0d7de">' + (data.dns && data.dns.server ? escHtml(data.dns.server) + ' (' + data.dns.lookupMs + 'ms)' : 'FAILED') + '</td></tr>' +
      '</table>';

    // Before/after verification table
    let verifyHtml = '';
    if (opts.verifyResult && opts.verifyResult.verdict) {
      const vr = opts.verifyResult;
      const vColor = { resolved: '#15803d', improved: '#1d4ed8', unchanged: '#854d0e', worse: '#991b1b', inconclusive: '#6b7280' }[vr.verdict] || '#6b7280';
      const vIcon = { resolved: '✅', improved: '📈', unchanged: '➡️', worse: '📉', inconclusive: '❓' }[vr.verdict] || '❓';
      verifyHtml = '<h2>Before/After Verification</h2>' +
        '<div style="padding:12px;border-radius:8px;border:1.5px solid ' + vColor + '22;background:' + vColor + '0d;color:' + vColor + ';font-weight:700;font-size:15px;margin-bottom:12px">' +
        vIcon + ' Verdict: ' + escHtml(vr.verdict.charAt(0).toUpperCase() + vr.verdict.slice(1)) + (vr.reasons && vr.reasons.length ? ' — ' + escHtml(vr.reasons.join('; ')) : '') + '</div>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="border:1px solid #d0d7de;padding:5px 8px;background:#f6f8fa">Metric</th><th style="border:1px solid #d0d7de;padding:5px 8px;background:#f6f8fa">Before</th><th style="border:1px solid #d0d7de;padding:5px 8px;background:#f6f8fa">After</th><th style="border:1px solid #d0d7de;padding:5px 8px;background:#f6f8fa">Unit</th><th style="border:1px solid #d0d7de;padding:5px 8px;background:#f6f8fa">Direction</th></tr>' +
        (vr.metrics || []).map(m => {
          const dirIcon = m.direction === 'better' ? '&#8593; better' : m.direction === 'worse' ? '&#8595; worse' : '— same';
          const dirColor = m.direction === 'better' ? '#15803d' : m.direction === 'worse' ? '#991b1b' : '#6b7280';
          return '<tr><td style="border:1px solid #d0d7de;padding:5px 8px">' + escHtml(m.label) + '</td><td style="border:1px solid #d0d7de;padding:5px 8px">' + escHtml(String(m.before != null ? m.before : '—')) + '</td><td style="border:1px solid #d0d7de;padding:5px 8px">' + escHtml(String(m.after != null ? m.after : '—')) + '</td><td style="border:1px solid #d0d7de;padding:5px 8px">' + escHtml(m.unit) + '</td><td style="border:1px solid #d0d7de;padding:5px 8px;color:' + dirColor + ';font-weight:600">' + dirIcon + '</td></tr>';
        }).join('') + '</table>' +
        (vr.resolvedFindingIds && vr.resolvedFindingIds.length ? '<p style="color:#15803d;margin-top:8px"><b>Resolved:</b> ' + vr.resolvedFindingIds.map(escHtml).join(', ') + '</p>' : '') +
        (vr.newFindingIds && vr.newFindingIds.length ? '<p style="color:#991b1b;margin-top:4px"><b>New findings:</b> ' + vr.newFindingIds.map(escHtml).join(', ') + '</p>' : '');
    }

    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NetPulse Report</title>' +
      '<style>body{font-family:Segoe UI,Arial;max-width:820px;margin:24px auto;padding:0 18px;color:#1f2328}h1{color:#0969da;font-size:24px}h2{font-size:18px;margin-top:22px;border-bottom:2px solid #d0d7de;padding-bottom:4px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #d0d7de;padding:6px 8px;text-align:left}pre{background:#f6f8fa;padding:12px;border-radius:6px;font-size:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}.meta{color:#57606a;font-size:12px}@media print{body{margin:0}}</style></head><body>' +
      '<h1>NetPulse — Diagnosis Report</h1>' +
      '<p class="meta">Generated: ' + new Date().toLocaleString() + ' &bull; Source: ' + badgeHtml + ' ' + escHtml(source) + '</p>' +
      (redact ? '<p class="meta" style="color:#854d0e;background:#fef9e7;padding:6px 10px;border-radius:6px;border:1px solid #fde68a"><strong>Redaction notice:</strong> SSID, BSSID, MAC addresses and GPS coordinates have been masked. Review carefully before sharing.</p>' : '') +
      '<h2>Summary</h2>' + summary +
      '<h2>Findings &amp; Root Cause</h2>' + findingsHtml +
      verifyHtml +
      '<h2>Evidence Details</h2><pre>' + escHtml(buildEvidence(data)) + '</pre>' +
      '<h2>Neighbor Networks</h2><table><tr><th>SSID</th><th>Channel</th><th>Signal</th><th>Auth</th></tr>' +
      (data.neighbors || []).map(n => '<tr><td>' + escHtml(n.ssid) + '</td><td>' + escHtml(n.channel) + '</td><td>' + n.signalPct + '%</td><td>' + escHtml(n.auth) + '</td></tr>').join('') +
      '</table><h2>Traceroute</h2><table><tr><th>Hop</th><th>IP</th><th>Times (ms)</th><th>Loss</th></tr>' +
      ((data.trace && data.trace.hops) || []).map(h => '<tr><td>' + h.hop + '</td><td>' + escHtml(h.ip) + '</td><td>' + (h.times || []).map(t => t === null ? '*' : t).join(', ') + '</td><td>' + h.lossPct + '%</td></tr>').join('') +
      '</table><p class="meta" style="margin-top:24px">NetPulse &bull; Network Fault Diagnosis, Root Cause Analysis &amp; Wi-Fi Site Survey</p></body></html>';

    return redact ? redactReportHtml(html) : html;
  }

  function updateReportTab() {
    if (!lastResult) return;
    const frame = $('reportFrame');
    frame.srcdoc = buildReportHtml(lastResult.data, lastResult.analysis);
    $('reportSource').textContent = reportSourceLabel() + ' - ' + new Date().toLocaleString() + ' | Print or Save';
  }

  function saveReportToFile() {
    if (!lastResult) return;
    const html = buildReportHtml(lastResult.data, lastResult.analysis);
    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    }).then(r => r.json()).then(j => {
      if (j.ok) {
        $('scanStatus').textContent = 'Report saved: ' + j.path;
        $('reportSource').textContent = 'Report saved: ' + j.path;
      } else {
        $('scanStatus').textContent = 'Report error: ' + j.error;
      }
    }).catch(e => {
      $('scanStatus').textContent = 'Report error: ' + e.message;
    });
  }

  $('btnSaveReport').addEventListener('click', saveReportToFile);
  $('btnSaveReport2').addEventListener('click', saveReportToFile);
  $('btnPrintReport').addEventListener('click', () => {
    try {
      $('reportFrame').contentWindow.print();
    } catch (e) {
      $('reportSource').textContent = 'Print error: ' + e.message + ' - use the browser print (Ctrl+P)';
    }
  });

  /* ---------------- Survey Report Builder ---------------- */
  let surveyReportData = [];
  let surveyReportSelected = new Set();

  function renderSurveyReportRow(s) {
    const qKey = isNum(s.signalPct) ? (s.signalPct >= 75 ? 'Excellent' : s.signalPct >= 50 ? 'Good' : s.signalPct >= 25 ? 'Fair' : 'Poor') : 'N/A';
    const qColor = qKey === 'Excellent' ? '#34d399' : qKey === 'Good' ? '#fbbf24' : qKey === 'Fair' ? '#fb923c' : '#f87171';
    const coord = (isNum(s.lat) && isNum(s.lng)) ? s.lat + ', ' + s.lng : '--';
    const network = s.networkType || '--';
    const signal = isNum(s.signalPct) ? s.signalPct + '%' : '--';
    const rssi = isNum(s.rssiDbm) ? s.rssiDbm + ' dBm' : '--';
    const bandCh = (s.band || '--') + ' / ' + (s.channel || '--');
    const sec = s.security || '--';
    const dist = isNum(s.distanceM) ? s.distanceM.toFixed(1) + ' m' : '--';
    const link = (isNum(s.linkTx) ? s.linkTx : '--') + ' / ' + (isNum(s.linkRx) ? s.linkRx : '--') + ' Mbps';
    const speed = (isNum(s.download) ? s.download.toFixed(1) : '--') + ' / ' + (isNum(s.upload) ? s.upload.toFixed(1) : '--');
    const lat = (isNum(s.ping) ? Math.round(s.ping) : '--') + ' / ' + (isNum(s.jitter) ? s.jitter.toFixed(1) : '--');
    const time = s.timestamp ? new Date(s.timestamp).toLocaleString() : '--';
    const checked = surveyReportSelected.has(s.id) ? ' checked' : '';
    return '<tr data-id="' + esc(s.id) + '">' +
      '<td><input type="checkbox" class="sel-cb" data-id="' + esc(s.id) + '"' + checked + '></td>' +
      '<td><b>' + esc(s.locationName || 'Unnamed') + '</b></td>' +
      '<td class="row-sub">' + esc(coord) + '</td>' +
      '<td>' + esc(s.ssid || '--') + '</td>' +
      '<td>' + esc(network) + '</td>' +
      '<td>' + signal + '</td>' +
      '<td>' + rssi + '</td>' +
      '<td><span class="quality-chip" style="color:' + qColor + ';background:' + qColor + '1f;border:1px solid ' + qColor + '55">' + qKey + '</span></td>' +
      '<td>' + esc(bandCh) + '</td>' +
      '<td>' + esc(sec) + '</td>' +
      '<td>' + esc(dist) + '</td>' +
      '<td>' + esc(link) + '</td>' +
      '<td>' + esc(speed) + ' Mbps</td>' +
      '<td>' + esc(lat) + ' ms</td>' +
      '<td class="row-sub">' + esc(time) + '</td></tr>';
  }

  async function loadSurveyReportData() {
    try {
      const r = await fetch('/api/surveys').then(r => r.json());
      if (!r.ok) return;
      surveyReportData = (r.surveys || []).filter(s => s && s.id);
      renderSurveyReportTable();
    } catch (e) { /* ignore */ }
  }

  function renderSurveyReportTable() {
    const tbody = $('surveyReportBody');
    if (!tbody) return;
    if (!surveyReportData.length) {
      tbody.innerHTML = '<tr><td colspan="15" class="survey-report-empty">No survey points yet. Go to Survey &amp; Mapping tab to run scans.</td></tr>';
      $('surveyReportCount').textContent = '0 scans';
      return;
    }
    tbody.innerHTML = surveyReportData.map(renderSurveyReportRow).join('');
    $('surveyReportCount').textContent = surveyReportData.length + ' scans (' + surveyReportSelected.size + ' selected)';
  }

  function bindSurveyReportEvents() {
    const selectAll = $('btnSurveyReportSelectAll');
    const clearBtn = $('btnSurveyReportClear');
    const previewBtn = $('btnSurveyReportPreview');
    const pdfBtn = $('btnSurveyReportPdf');
    const table = $('surveyReportTable');
    if (!table) return;

    if (selectAll) selectAll.addEventListener('click', () => {
      surveyReportData.forEach(s => surveyReportSelected.add(s.id));
      renderSurveyReportTable();
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      surveyReportSelected.clear();
      renderSurveyReportTable();
    });

    table.addEventListener('click', (ev) => {
      const cb = ev.target.closest('.sel-cb');
      if (cb) {
        const id = cb.dataset.id;
        if (cb.checked) surveyReportSelected.add(id); else surveyReportSelected.delete(id);
        $('surveyReportCount').textContent = surveyReportData.length + ' scans (' + surveyReportSelected.size + ' selected)';
      }
    });

    if (previewBtn) previewBtn.addEventListener('click', generateSurveyReportPreview);
    if (pdfBtn) pdfBtn.addEventListener('click', generateSurveyReportPdf);
  }

  function buildSurveyReportHtml(surveys) {
    if (!surveys || !surveys.length) return '';
    const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let sig = 0, down = 0, c1 = 0, c2 = 0, ex = 0, good = 0, fair = 0, poor = 0;
    surveys.forEach(s => {
      if (isNum(s.signalPct)) { sig += s.signalPct; c1++; if (s.signalPct >= 75) ex++; else if (s.signalPct >= 50) good++; else if (s.signalPct >= 25) fair++; else poor++; }
      if (isNum(s.download)) { down += s.download; c2++; }
    });
    const rows = surveys.map(s => {
      const coord = (isNum(s.lat) && isNum(s.lng)) ? s.lat + ', ' + s.lng : '--';
      const q = isNum(s.signalPct) ? (s.signalPct >= 75 ? 'Excellent' : s.signalPct >= 50 ? 'Good' : s.signalPct >= 25 ? 'Fair' : 'Poor') : 'N/A';
      return '<tr><td>' + escH(s.locationName || '-') + '</td><td>' + escH(coord) + '</td>' +
        '<td>' + escH(s.ssid || '-') + '</td><td>' + escH(s.networkType || '-') + '</td>' +
        '<td>' + (isNum(s.signalPct) ? s.signalPct + '%' : '-') + '</td>' +
        '<td>' + (isNum(s.rssiDbm) ? s.rssiDbm + ' dBm' : '-') + '</td>' +
        '<td>' + q + '</td><td>' + escH((s.band || '-') + ' / ' + (s.channel || '-')) + '</td>' +
        '<td>' + escH(s.security || '-') + '</td>' +
        '<td>' + (isNum(s.distanceM) ? s.distanceM.toFixed(1) + ' m' : '-') + '</td>' +
        '<td>' + (isNum(s.linkTx) ? s.linkTx : '-') + ' / ' + (isNum(s.linkRx) ? s.linkRx : '-') + ' Mbps</td>' +
        '<td>' + (isNum(s.download) ? s.download.toFixed(1) : '-') + ' / ' + (isNum(s.upload) ? s.upload.toFixed(1) : '-') + ' Mbps</td>' +
        '<td>' + (isNum(s.ping) ? Math.round(s.ping) : '-') + ' / ' + (isNum(s.jitter) ? s.jitter.toFixed(1) : '-') + '</td>' +
        '<td>' + (s.timestamp ? new Date(s.timestamp).toLocaleString() : '-') + '</td></tr>';
    }).join('');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NetPulse Survey Report</title>' +
      '<style>body{font-family:Segoe UI,Arial;max-width:920px;margin:24px auto;padding:0 18px;color:#1f2328}h1{color:#0969da;font-size:24px}h2{font-size:18px;margin-top:22px;border-bottom:2px solid #d0d7de;padding-bottom:4px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d0d7de;padding:5px 7px;text-align:left}th{background:#f6f8fa;font-weight:700}.meta{color:#57606a;font-size:12px}@media print{body{margin:0}}</style></head><body>' +
      '<h1>NetPulse — Wi-Fi Survey Report</h1>' +
      '<p class="meta">Generated: ' + new Date().toLocaleString() + ' &bull; Survey points: ' + surveys.length + '</p>' +
      '<h2>Summary</h2><table><tr><th>Metric</th><th>Value</th></tr>' +
      '<tr><td>Survey points</td><td>' + surveys.length + '</td></tr>' +
      '<tr><td>Average signal</td><td>' + (c1 ? Math.round(sig / c1) + '%' : '-') + '</td></tr>' +
      '<tr><td>Average download</td><td>' + (c2 ? (down / c2).toFixed(1) + ' Mbps' : '-') + '</td></tr>' +
      '<tr><td>Excellent (75%+)</td><td>' + ex + '</td></tr>' +
      '<tr><td>Good (50-74%)</td><td>' + good + '</td></tr>' +
      '<tr><td>Fair (25-49%)</td><td>' + fair + '</td></tr>' +
      '<tr><td>Poor (&lt;25%)</td><td>' + poor + '</td></tr></table>' +
      '<h2>Survey Points</h2><table><tr><th>Location</th><th>Coordinates</th><th>SSID</th><th>Network</th><th>Signal</th><th>RSSI</th><th>Quality</th><th>Band/Ch</th><th>Security</th><th>Distance</th><th>Link Speed</th><th>Internet</th><th>Latency</th><th>Time</th></tr>' +
      rows + '</table>' +
      '<h2>WiFi Quality Factors</h2><table><tr><th>Location</th><th>Signal %</th><th>RSSI (dBm)</th><th>Channel</th><th>Band</th><th>Standard</th><th>Security</th><th>Link TX/RX</th><th>Distance</th></tr>' +
      surveys.map(s => '<tr><td>' + escH(s.locationName || '-') + '</td><td>' + (isNum(s.signalPct) ? s.signalPct + '%' : '-') + '</td><td>' + (isNum(s.rssiDbm) ? s.rssiDbm : '-') + '</td><td>' + escH(s.channel || '-') + '</td><td>' + escH(s.band || '-') + '</td><td>' + escH(s.standard || '-') + '</td><td>' + escH(s.security || '-') + '</td><td>' + (isNum(s.linkTx) ? s.linkTx : '-') + '/' + (isNum(s.linkRx) ? s.linkRx : '-') + '</td><td>' + (isNum(s.distanceM) ? s.distanceM.toFixed(1) + 'm' : '-') + '</td></tr>').join('') +
      '</table><p class="meta" style="margin-top:24px">NetPulse &bull; Data Communication Project &bull; Wi-Fi Site Survey Report</p></body></html>';
  }

  function generateSurveyReportPreview() {
    const selected = surveyReportData.filter(s => surveyReportSelected.has(s.id));
    const list = selected.length ? selected : surveyReportData;
    if (!list.length) { $('surveyReportStatus').textContent = 'No survey points to preview'; return; }
    const html = buildSurveyReportHtml(list);
    const frame = $('surveyReportFrame');
    frame.srcdoc = html;
    $('surveyReportPreviewCard').style.display = '';
    $('surveyReportPreviewCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('surveyReportStatus').textContent = 'Preview: ' + list.length + ' survey points';
  }

  async function generateSurveyReportPdf() {
    const ids = Array.from(surveyReportSelected);
    if (!ids.length) { $('surveyReportStatus').textContent = 'Select at least one survey point first'; return; }
    $('btnSurveyReportPdf').disabled = true;
    $('surveyReportStatus').textContent = 'Generating PDF...';
    try {
      const r = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'pdf', ids })
      }).then(r => r.json());
      if (r.ok) {
        $('surveyReportStatus').textContent = 'PDF saved: ' + r.files.join(', ');
        const fileName = r.files[0] ? r.files[0].split(/[/\\]/).pop() : 'survey_report.pdf';
        window.open('/Surveys/' + encodeURIComponent(r.folder.split(/[/\\]/).pop()) + '/' + encodeURIComponent(fileName), '_blank');
      } else {
        $('surveyReportStatus').textContent = 'PDF error: ' + (r.error || 'unknown');
      }
    } catch (e) {
      $('surveyReportStatus').textContent = 'PDF error: ' + e.message;
    } finally {
      $('btnSurveyReportPdf').disabled = false;
    }
  }

  /* ================================================================
   * TROUBLESHOOT TAB — 5-step state machine
   * ================================================================ */
  (function initTroubleshootTab() {
    let tsCurrentStep = 1;
    let tsBeforeScanId = null;
    let tsAfterScanId = null;
    let tsVerifyResult = null;
    let tsLastData = null;
    let tsLastAnalysis = null;

    const VERDICT_ICONS = {
      resolved: '✅',
      improved: '📈',
      unchanged: '⏸',
      worse: '📉',
      inconclusive: '❓'
    };
    const VERDICT_LABELS = {
      resolved: 'Issue resolved',
      improved: 'Improved but not fully resolved',
      unchanged: 'No change detected',
      worse: 'Condition is worse',
      inconclusive: 'Inconclusive — insufficient data'
    };
    const DIR_MAP = {
      better: { icon: '↑', cls: 'dir-better', label: 'Better' },
      worse:  { icon: '↓', cls: 'dir-worse',  label: 'Worse' },
      same:   { icon: '→', cls: 'dir-same',   label: 'Same' }
    };

    function setTsStep(n) {
      tsCurrentStep = n;
      // Update stepper visuals
      document.querySelectorAll('.ts-step').forEach(el => {
        const s = parseInt(el.dataset.step, 10);
        el.classList.remove('ts-step--active', 'ts-step--done');
        if (s < n) el.classList.add('ts-step--done');
        else if (s === n) el.classList.add('ts-step--active');
      });
      // Show/hide panes
      for (let i = 1; i <= 5; i++) {
        const pane = $('ts-pane-' + i);
        if (pane) pane.style.display = (i === n) ? '' : 'none';
      }
    }

    function updateTsSourceBadge(source) {
      const badge = $('tsSourceBadge');
      const diagBadge = $('tsDiagBadge');
      if (!badge) return;
      const map = { live: ['LIVE', 'source-badge--live'], simulated: ['SIMULATED', 'source-badge--sim'], replay: ['REPLAY', 'source-badge--replay'] };
      const [label, cls] = map[source] || ['LIVE', 'source-badge--live'];
      badge.textContent = label;
      badge.className = 'source-badge ' + cls;
      badge.style.display = '';
      if (diagBadge) {
        diagBadge.textContent = label;
        diagBadge.className = 'source-badge ' + cls;
      }
    }

    function showTsDiagResult(data, analysis) {
      tsLastData = data;
      tsLastAnalysis = analysis;
      tsBeforeScanId = (data && data.id) ? data.id : null;

      const insuffEl = $('tsInsufficientData');
      const diagContent = $('tsDiagContent');

      if (analysis && analysis.insufficientData) {
        if (insuffEl) insuffEl.style.display = '';
        if (diagContent) diagContent.style.display = 'none';
      } else {
        if (insuffEl) insuffEl.style.display = 'none';
        if (diagContent) diagContent.style.display = '';
        renderFaults($('tsFaultPanel'), $('tsOsiIndicator'), analysis, data);
        drawTopology($('tsTopoCanvas'), data);
        drawTrace($('tsTraceCanvas'), data, 'Traceroute to 8.8.8.8');
      }

      updateTsSourceBadge('live');
      setTsStep(2);
      // Scroll to diagnose pane
      const pane2 = $('ts-pane-2');
      if (pane2) pane2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderVerifyResult(result) {
      tsVerifyResult = result;
      const verdict = result.verdict || 'inconclusive';
      const icon = VERDICT_ICONS[verdict] || '❓';
      const label = VERDICT_LABELS[verdict] || verdict;

      // Verdict banner
      const banner = $('tsVerdictBanner');
      if (banner) {
        banner.className = 'ts-verdict-banner ts-verdict-banner--' + verdict;
        banner.innerHTML = '<span class="ts-verdict-icon" aria-hidden="true">' + icon + '</span>' +
          '<span class="ts-verdict-text"><strong>' + esc(label) + '</strong>' +
          (result.reasons && result.reasons.length ? ' — ' + esc(result.reasons[0]) : '') + '</span>';
      }

      // Metrics table
      const tbody = $('tsMetricsTbody');
      if (tbody) {
        if (!result.metrics || !result.metrics.length) {
          tbody.innerHTML = '<tr><td colspan="5">No metric data returned.</td></tr>';
        } else {
          tbody.innerHTML = result.metrics.map(m => {
            const d = DIR_MAP[m.direction] || DIR_MAP.same;
            return '<tr>' +
              '<td>' + esc(m.label || m.key || '--') + '</td>' +
              '<td>' + esc(String(m.before != null ? m.before : '--')) + '</td>' +
              '<td>' + esc(String(m.after != null ? m.after : '--')) + '</td>' +
              '<td>' + esc(m.unit || '') + '</td>' +
              '<td class="' + d.cls + '">' + d.icon + ' <span class="sr-only">' + d.label + '</span></td>' +
              '</tr>';
          }).join('');
        }
      }

      // Resolved findings
      const resolvedEl = $('tsResolvedFindings');
      if (resolvedEl) {
        if (result.resolvedFindingIds && result.resolvedFindingIds.length) {
          resolvedEl.innerHTML = '<p class="dir-better">✅ Resolved: ' +
            result.resolvedFindingIds.map(id => '<code>' + esc(id) + '</code>').join(', ') + '</p>';
        } else {
          resolvedEl.innerHTML = '';
        }
      }

      // New findings
      const newEl = $('tsNewFindings');
      if (newEl) {
        if (result.newFindingIds && result.newFindingIds.length) {
          newEl.innerHTML = '<p class="dir-worse">⚠️ New issues: ' +
            result.newFindingIds.map(id => '<code>' + esc(id) + '</code>').join(', ') + '</p>';
        } else {
          newEl.innerHTML = '';
        }
      }

      const verifyResultEl = $('tsVerifyResult');
      if (verifyResultEl) verifyResultEl.style.display = '';
      setTsStep(4);
    }

    async function runVerify() {
      if (!tsBeforeScanId || !tsAfterScanId) {
        const vs = $('tsVerifyStatus');
        if (vs) vs.textContent = 'Verification requires both before and after scan IDs.';
        setTsStep(4);
        return;
      }
      const vs = $('tsVerifyStatus');
      if (vs) vs.textContent = 'Comparing before and after scans…';
      try {
        const r = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ beforeId: tsBeforeScanId, afterId: tsAfterScanId })
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'verify failed');
        if (vs) vs.textContent = '';
        renderVerifyResult(j);
      } catch (e) {
        if (vs) vs.textContent = 'Verification error: ' + e.message;
        setTsStep(4);
      }
    }

    // --- Wire buttons ---

    const tsBtnScan = $('tsBtnScan');
    if (tsBtnScan) {
      tsBtnScan.addEventListener('click', () => {
        const statusEl = $('tsScanStatus');
        const progEl = $('tsScanProgress');
        if (statusEl) statusEl.textContent = '';
        if (progEl) { progEl.className = 'scan-progress'; progEl.innerHTML = '<div class="fill"></div>'; }
        tsBtnScan.disabled = true;
        runLiveScan(statusEl, progEl, (data, analysis) => {
          tsBtnScan.disabled = false;
          showTsDiagResult(data, analysis);
        }).then(result => {
          if (!result) tsBtnScan.disabled = false;
        });
      });
    }

    const tsBtnGoFix = $('tsBtnGoFix');
    if (tsBtnGoFix) tsBtnGoFix.addEventListener('click', () => setTsStep(3));

    const tsBtnSkipToReport = $('tsBtnSkipToReport');
    if (tsBtnSkipToReport) tsBtnSkipToReport.addEventListener('click', () => setTsStep(5));

    const tsBtnBackDiag = $('tsBtnBackDiag');
    if (tsBtnBackDiag) tsBtnBackDiag.addEventListener('click', () => setTsStep(2));

    const tsBtnDhcpRenewTs = $('tsBtnDhcpRenew');
    if (tsBtnDhcpRenewTs) {
      tsBtnDhcpRenewTs.addEventListener('click', () => {
        showFixConfirmModal({
          title: 'Confirm: Renew DHCP',
          body: '<p><strong>What this does:</strong> Runs <code>ipconfig /release</code> then <code>ipconfig /renew</code>.</p>' +
                '<p style="margin-top:8px;color:var(--warn)"><strong>⚠ Warning:</strong> Your network connection will drop briefly (usually 5–30 seconds) while the IP is renewed.</p>' +
                '<p style="margin-top:8px"><strong>How to undo:</strong> If the connection does not return, reboot the PC or manually re-enter your static IP settings.</p>' +
                '<p style="margin-top:8px;color:var(--muted)">Requires Administrator rights.</p>',
          confirmLabel: 'Run DHCP Renew'
        }, async () => {
          const statusEl = $('tsFixStatus');
          if (statusEl) statusEl.textContent = 'Applying DHCP renew…';
          const ok = await runFixAction('dhcp-renew');
          if (ok !== false) {
            if (statusEl) statusEl.textContent = 'Fix applied. Click "Re-scan & Verify Fix" to confirm.';
            const goVerify = $('tsBtnGoVerify');
            if (goVerify) goVerify.disabled = false;
          }
        });
      });
    }

    const tsBtnFlushDnsTs = $('tsBtnFlushDns');
    if (tsBtnFlushDnsTs) {
      tsBtnFlushDnsTs.addEventListener('click', () => {
        showFixConfirmModal({
          title: 'Confirm: Flush DNS Cache',
          body: '<p><strong>What this does:</strong> Runs <code>ipconfig /flushdns</code> to clear the DNS resolver cache.</p>' +
                '<p style="margin-top:8px"><strong>Effect:</strong> The next DNS lookup for each hostname will go to your DNS server. No connection drop expected.</p>' +
                '<p style="margin-top:8px"><strong>How to undo:</strong> The cache rebuilds automatically with use. There is nothing to undo.</p>',
          confirmLabel: 'Flush DNS'
        }, async () => {
          const statusEl = $('tsFixStatus');
          if (statusEl) statusEl.textContent = 'Flushing DNS cache…';
          const ok = await runFixAction('flush-dns');
          if (ok !== false) {
            if (statusEl) statusEl.textContent = 'DNS cache flushed. Click "Re-scan & Verify Fix" to confirm.';
            const goVerify = $('tsBtnGoVerify');
            if (goVerify) goVerify.disabled = false;
          }
        });
      });
    }

    const tsBtnGoVerify = $('tsBtnGoVerify');
    if (tsBtnGoVerify) {
      tsBtnGoVerify.addEventListener('click', () => {
        setTsStep(4);
        const vs = $('tsVerifyStatus');
        if (vs) vs.textContent = 'Running verification scan…';
        const verifyResultEl = $('tsVerifyResult');
        if (verifyResultEl) verifyResultEl.style.display = 'none';
        // Re-scan, then verify
        runLiveScan(vs, null, (data) => {
          tsAfterScanId = (data && data.id) ? data.id : null;
          runVerify();
        }).then(result => {
          if (!result && vs) vs.textContent = 'Verification scan failed. Cannot verify.';
        });
      });
    }

    const tsBtnGoReport = $('tsBtnGoReport');
    if (tsBtnGoReport) tsBtnGoReport.addEventListener('click', () => setTsStep(5));

    const tsBtnRescan = $('tsBtnRescan');
    if (tsBtnRescan) {
      tsBtnRescan.addEventListener('click', () => {
        // Reset state for a fresh scan
        tsBeforeScanId = null;
        tsAfterScanId = null;
        tsVerifyResult = null;
        tsLastData = null;
        tsLastAnalysis = null;
        const goVerify = $('tsBtnGoVerify');
        if (goVerify) goVerify.disabled = true;
        setTsStep(1);
      });
    }

    const tsBtnGenReport = $('tsBtnGenReport');
    if (tsBtnGenReport) {
      tsBtnGenReport.addEventListener('click', () => {
        if (!tsLastData) {
          const rs = $('tsReportStatus');
          if (rs) rs.textContent = 'Run a scan first before generating a report.';
          return;
        }
        const redact = $('tsRedactToggle') ? $('tsRedactToggle').checked : true;
        const html = buildReportHtml(tsLastData, tsLastAnalysis, { redact, verifyResult: tsVerifyResult });
        const frame = $('tsReportFrame');
        if (frame) frame.srcdoc = html;
        const previewCard = $('tsReportPreviewCard');
        if (previewCard) { previewCard.style.display = ''; previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        const saveBtn = $('tsBtnSaveReport');
        const pdfBtn = $('tsBtnSavePdf');
        if (saveBtn) saveBtn.disabled = false;
        if (pdfBtn) pdfBtn.disabled = false;
        const rs = $('tsReportStatus');
        if (rs) rs.textContent = 'Report generated. Review before sharing.';
      });
    }

    const tsBtnSaveReport = $('tsBtnSaveReport');
    if (tsBtnSaveReport) {
      tsBtnSaveReport.addEventListener('click', async () => {
        if (!tsLastData) return;
        const redact = $('tsRedactToggle') ? $('tsRedactToggle').checked : true;
        const html = buildReportHtml(tsLastData, tsLastAnalysis, { redact, verifyResult: tsVerifyResult });
        const rs = $('tsReportStatus');
        try {
          const r = await fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html })
          }).then(res => res.json());
          if (rs) rs.textContent = r.ok ? 'Report saved: ' + (r.path || 'reports/') : 'Save error: ' + (r.error || 'unknown');
        } catch (e) {
          if (rs) rs.textContent = 'Save error: ' + e.message;
        }
      });
    }

    const tsBtnSavePdf = $('tsBtnSavePdf');
    if (tsBtnSavePdf) {
      tsBtnSavePdf.addEventListener('click', async () => {
        if (!tsLastData) return;
        const rs = $('tsReportStatus');
        if (rs) rs.textContent = 'Generating PDF…';
        try {
          const r = await fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format: 'pdf', json: { data: tsLastData, analysis: tsLastAnalysis } })
          }).then(res => res.json());
          if (rs) rs.textContent = r.ok ? 'PDF saved: ' + (r.path || r.files && r.files[0] || 'reports/') : 'PDF error: ' + (r.error || 'unknown');
        } catch (e) {
          if (rs) rs.textContent = 'PDF error: ' + e.message;
        }
      });
    }

    // Wire speed test disclosure overlay (used by survey.js; wired here for CSP safety)
    const speedAllow = $('speedDiscAllow');
    const speedDeny = $('speedDiscDeny');
    const speedOverlay = $('speedDisclosureOverlay');
    if (speedAllow && speedOverlay) {
      speedAllow.addEventListener('click', () => {
        localStorage.setItem('npa-speedtest-consent', '1');
        speedOverlay.style.display = 'none';
        // Dispatch a custom event so survey.js can proceed
        document.dispatchEvent(new CustomEvent('speedtest-consent-granted'));
      });
    }
    if (speedDeny && speedOverlay) {
      speedDeny.addEventListener('click', () => {
        speedOverlay.style.display = 'none';
        document.dispatchEvent(new CustomEvent('speedtest-consent-denied'));
      });
    }
  })();
  /* ================================================================
   * END TROUBLESHOOT TAB
   * ================================================================ */

  bindSurveyReportEvents();

  loadHistory();
})();
