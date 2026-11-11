/**
 * Newsland Brokerage Radar Engine (Tabular List Layout)
 * Renders institutional stock recommendations, ratings, and target prices.
 */

async function safeFetch(primaryUrl, fallbackUrl) {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const first = isLocal ? primaryUrl : (fallbackUrl || primaryUrl);
  const second = isLocal ? fallbackUrl : primaryUrl;

  const fetchOpt = { cache: 'no-cache' };
  try {
    const res = await fetch(first, fetchOpt);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && (ct.includes('json') || first.endsWith('.json'))) return res;
  } catch (_) {}

  if (second && second !== first) {
    try {
      const fb = await fetch(second, fetchOpt);
      const ct = fb.headers.get('content-type') || '';
      if (fb.ok && (ct.includes('json') || second.endsWith('.json'))) return fb;
    } catch (_) {}
  }
  return fetch(first, fetchOpt);
}

let rawCalls = [];
let currentSentiment = 'all';
let currentBroker = 'all';
let currentQuery = '';
let sortKey = 'published';
let sortDir = -1; // -1 desc, 1 asc

const THEMES = ['paper', 'night', 'sepia', 'slate'];
function readSavedTheme() {
  try {
    const raw = localStorage.getItem('newsland.theme');
    if (!raw) return 'paper';
    const parsed = JSON.parse(raw);
    return THEMES.includes(parsed) ? parsed : 'paper';
  } catch (_) {
    const raw = (localStorage.getItem('newsland.theme') || '').replace(/"/g, '');
    return THEMES.includes(raw) ? raw : 'paper';
  }
}

function initTheme() {
  const savedTheme = readSavedTheme();
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'paper';
      const nextTheme = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      document.documentElement.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('newsland.theme', JSON.stringify(nextTheme)); } catch (_) {}
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatTimeAgo(ts) {
  if (!ts) return 'Recent';
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function updateStats(data) {
  const stats = data.stats || {};
  const total = stats.total || rawCalls.length || 0;
  const bull = stats.bullish || 0;
  const bear = stats.bearish || 0;
  const neut = stats.neutral || 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-bullish').textContent = bull;
  document.getElementById('stat-bearish').textContent = bear;
  document.getElementById('stat-neutral').textContent = neut;

  document.getElementById('count-all').textContent = total;
  document.getElementById('count-bull').textContent = bull;
  document.getElementById('count-bear').textContent = bear;
  document.getElementById('count-neutral').textContent = neut;

  if (data.updated) {
    try {
      const d = new Date(data.updated);
      document.getElementById('stat-updated').textContent =
        `Synced ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      document.getElementById('stat-updated').textContent = 'Live';
    }
  }
}

function renderBrokerChips(stats) {
  const container = document.getElementById('broker-chips-row');
  if (!container) return;

  const top = (stats.top_brokerages || []).filter(b => b.name !== 'Street Consensus');
  let html = `<button class="firm-chip ${currentBroker === 'all' ? 'active' : ''}" data-broker="all">All Brokerages</button>`;
  for (const b of top) {
    const isActive = currentBroker.toLowerCase() === b.name.toLowerCase();
    html += `<button class="firm-chip ${isActive ? 'active' : ''}" data-broker="${escapeHtml(b.name)}">${escapeHtml(b.name)} (${b.count})</button>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.firm-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.firm-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentBroker = btn.dataset.broker;
      filterAndRender();
    });
  });
}

function filterAndRender() {
  const tbody = document.getElementById('radar-tbody');
  if (!tbody) return;

  const q = currentQuery.trim().toLowerCase();

  let filtered = rawCalls.filter(c => {
    if (currentSentiment !== 'all' && c.sentiment !== currentSentiment) return false;

    if (currentBroker !== 'all') {
      const bName = (c.brokerage || '').toLowerCase();
      const matchBroker = (c.brokerages || []).some(b => b.toLowerCase() === currentBroker.toLowerCase());
      if (bName !== currentBroker.toLowerCase() && !matchBroker) return false;
    }

    if (q) {
      const text = `${c.title || ''} ${c.stock || ''} ${c.brokerage || ''} ${c.symbol || ''} ${c.target || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sortDir;
    }
    return String(av).localeCompare(String(bv)) * sortDir;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="radar-empty-row">
        <td colspan="6">No matching brokerage calls found. Try clearing your filter or search query.</td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    const sentimentCls = item.sentiment === 'bullish' ? 'bullish' : (item.sentiment === 'bearish' ? 'bearish' : 'neutral');
    const timeAgo = formatTimeAgo(item.published);
    const sourceName = item.source || 'Wire';

    const stockName = item.stock || 'Market / Sector';
    const stockQuery = item.symbol || (stockName !== 'Multi / Sector' && stockName !== 'Market / Sector' ? stockName : '');

    html += `
      <tr data-id="${escapeHtml(item.id)}">
        <td class="col-broker">
          <span class="firm-pill">${escapeHtml(item.brokerage)}</span>
        </td>
        <td class="col-stock">
          <div class="stock-cell">
            <span class="stock-name">${escapeHtml(stockName)}</span>
            ${stockQuery ? `<a href="index.html?company=${encodeURIComponent(stockQuery)}" class="xray-mini-link" title="Open ${escapeHtml(stockName)} in Company X-Ray">X-Ray ↗</a>` : ''}
          </div>
        </td>
        <td class="col-reco">
          <span class="reco-badge ${sentimentCls}">${escapeHtml(item.action_label)}</span>
        </td>
        <td class="col-target">
          ${item.target ? `<span class="target-val">${escapeHtml(item.target)}</span>` : `<span class="target-empty">—</span>`}
        </td>
        <td class="col-details">
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="detail-headline">
            ${escapeHtml(item.title)}
          </a>
        </td>
        <td class="col-meta">
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="meta-source">${escapeHtml(sourceName)} ↗</a>
          <span class="meta-time" title="${escapeHtml(item.published_str || '')}">${escapeHtml(timeAgo)}</span>
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
}

async function loadRadarData() {
  try {
    const res = await safeFetch('/api/radar', '/data/radar.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    rawCalls = data.calls || [];
    updateStats(data);
    renderBrokerChips(data.stats || {});
    filterAndRender();
  } catch (err) {
    console.error('Brokerage Radar load error:', err);
    const tbody = document.getElementById('radar-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr class="radar-empty-row">
          <td colspan="6">Unable to load Brokerage Radar: ${escapeHtml(err.message)}</td>
        </tr>
      `;
    }
  }
}

function setupEvents() {
  document.querySelectorAll('.r-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.r-pill').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentSentiment = btn.dataset.action;
      filterAndRender();
    });
  });

  const searchInput = document.getElementById('radar-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      currentQuery = e.target.value;
      filterAndRender();
    });
  }

  document.querySelectorAll('.radar-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = key === 'published' ? -1 : 1;
      }
      filterAndRender();
    });
  });

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = '↻ Syncing…';
      loadRadarData().finally(() => {
        refreshBtn.textContent = '↻ Refresh';
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEvents();
  loadRadarData();
});
