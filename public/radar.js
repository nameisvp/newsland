/**
 * Newsland Brokerage Radar Engine
 * Calm, structured 5-column financial table with instant filtering.
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
let lastUpdated = null;
let currentDays = 7;
let currentMarket = 'all';
let currentSentiment = 'all';
let currentBroker = 'all';
let currentQuery = '';
let sortKey = 'published';
let sortDir = -1;

function getItemMarket(c) {
  if (c.market === 'India' || c.market === 'US') return c.market;
  const sym = c.symbol || '';
  if (sym.endsWith('.NS') || sym.endsWith('.BO') || sym === '^NSEI' || sym === '^BSESN') return 'India';
  if (['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'TSM'].includes(sym)) return 'US';
  const text = `${c.title || ''} ${c.url || ''}`.toLowerCase();
  if (/\b(nvidia|apple|microsoft|alphabet|google|amazon|meta|tesla|regeneron|nasdaq|nyse|wall street|us-stocks|baird)\b/.test(text) && !/₹|\brs\b|\bnifty\b|\bsensex\b|\bindia\b/.test(text)) {
    return 'US';
  }
  return 'India';
}

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

function cleanActionLabel(label) {
  return String(label || 'Coverage').replace(/\s*[▲▼●]\s*$/, '').trim();
}

function getWindowCalls() {
  const nowSec = Date.now() / 1000;
  const maxAge = currentDays * 86400;
  return rawCalls.filter(c => !c.published || (nowSec - c.published <= maxAge));
}

function updateStats() {
  const windowCalls = getWindowCalls();
  const total = windowCalls.length;
  const bull = windowCalls.filter(c => c.sentiment === 'bullish').length;
  const bear = windowCalls.filter(c => c.sentiment === 'bearish').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-bullish').textContent = bull;
  document.getElementById('stat-bearish').textContent = bear;

  const indiaCnt = windowCalls.filter(c => getItemMarket(c) === 'India').length;
  const usCnt = windowCalls.filter(c => getItemMarket(c) === 'US').length;
  if (document.getElementById('count-mkt-india')) document.getElementById('count-mkt-india').textContent = indiaCnt;
  if (document.getElementById('count-mkt-us')) document.getElementById('count-mkt-us').textContent = usCnt;

  if (lastUpdated) {
    try {
      const d = new Date(lastUpdated);
      document.getElementById('stat-updated').textContent =
        `Synced ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      document.getElementById('stat-updated').textContent = 'Live';
    }
  }
}

function populateFirmDropdown() {
  const select = document.getElementById('firm-select');
  if (!select) return;

  const windowCalls = getWindowCalls();
  const counts = {};
  for (const c of windowCalls) {
    const b = c.brokerage || 'Other';
    if (b === 'Street Consensus') continue;
    counts[b] = (counts[b] || 0) + 1;
  }

  const sortedFirms = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  let html = `<option value="all">All Brokerages (${windowCalls.length})</option>`;
  for (const f of sortedFirms) {
    const sel = currentBroker.toLowerCase() === f.name.toLowerCase() ? 'selected' : '';
    html += `<option value="${escapeHtml(f.name)}" ${sel}>${escapeHtml(f.name)} (${f.count})</option>`;
  }
  select.innerHTML = html;
}

function updateResetVisibility() {
  const btn = document.getElementById('reset-filters-btn');
  if (!btn) return;
  const isFiltered = currentMarket !== 'all' || currentSentiment !== 'all' || currentBroker !== 'all' || currentQuery.trim() !== '';
  btn.hidden = !isFiltered;
}

function filterAndRender() {
  const tbody = document.getElementById('radar-tbody');
  if (!tbody) return;

  updateResetVisibility();
  const q = currentQuery.trim().toLowerCase();
  const windowCalls = getWindowCalls();

  let filtered = windowCalls.filter(c => {
    if (currentMarket !== 'all' && getItemMarket(c) !== currentMarket) return false;
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
      <tr>
        <td colspan="5" class="empty-cell">No matching brokerage calls found. Try clearing a filter or expanding to 30D History.</td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    const sentimentCls = item.sentiment === 'bullish' ? 'bullish' : (item.sentiment === 'bearish' ? 'bearish' : 'neutral');
    const timeAgo = formatTimeAgo(item.published);
    const timeLabel = (item.published && (Date.now() / 1000 - item.published > 86400))
      ? (item.published_str || timeAgo)
      : timeAgo;
    const sourceName = item.source || 'Wire';

    const stockName = item.stock || 'Market / Sector';
    const stockQuery = item.symbol || (stockName !== 'Multi / Sector' && stockName !== 'Market / Sector' ? stockName : '');
    const mkt = getItemMarket(item);
    const callText = cleanActionLabel(item.action_label);

    html += `
      <tr data-id="${escapeHtml(item.id)}">
        <td class="col-firm">
          <span class="firm-name">${escapeHtml(item.brokerage)}</span>
        </td>
        <td class="col-stock">
          ${stockQuery ? `
            <a href="index.html?company=${encodeURIComponent(stockQuery)}" class="stock-link" title="Open ${escapeHtml(stockName)} in Company X-Ray">
              <span>${escapeHtml(stockName)}</span>
              ${mkt === 'US' ? '<span class="mkt-micro">US</span>' : ''}
              <span class="xray-arrow">↗</span>
            </a>
          ` : `
            <span class="stock-link">
              <span>${escapeHtml(stockName)}</span>
              ${mkt === 'US' ? '<span class="mkt-micro">US</span>' : ''}
            </span>
          `}
        </td>
        <td class="col-call">
          <span class="call-pill ${sentimentCls}">${escapeHtml(callText)}</span>
        </td>
        <td class="col-target">
          ${item.target ? `<span class="target-num">${escapeHtml(item.target)}</span>` : `<span class="target-dash">—</span>`}
        </td>
        <td class="col-report">
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="report-link">
            ${escapeHtml(item.title)}
          </a>
          <div class="report-meta">
            <span>${escapeHtml(sourceName)}</span>
            <span>&middot;</span>
            <span title="${escapeHtml(item.published_str || '')}">${escapeHtml(timeLabel)}</span>
          </div>
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
    lastUpdated = data.updated;
    updateStats();
    populateFirmDropdown();
    filterAndRender();
  } catch (err) {
    console.error('Brokerage Radar load error:', err);
    const tbody = document.getElementById('radar-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-cell">Unable to load Brokerage Radar: ${escapeHtml(err.message)}</td>
        </tr>
      `;
    }
  }
}

function resetAllFilters() {
  currentMarket = 'all';
  currentSentiment = 'all';
  currentBroker = 'all';
  currentQuery = '';

  const searchInput = document.getElementById('radar-search');
  if (searchInput) searchInput.value = '';

  const firmSelect = document.getElementById('firm-select');
  if (firmSelect) firmSelect.value = 'all';

  document.querySelectorAll('.mkt-pill').forEach(b => b.classList.toggle('active', b.dataset.market === 'all'));
  document.querySelectorAll('.sent-pill').forEach(b => b.classList.toggle('active', b.dataset.action === 'all'));

  filterAndRender();
}

function setupEvents() {
  document.querySelectorAll('.time-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-pill').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentDays = Number(btn.dataset.days) || 7;
      updateStats();
      populateFirmDropdown();
      filterAndRender();
    });
  });

  document.querySelectorAll('.mkt-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mkt-pill').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentMarket = btn.dataset.market;
      filterAndRender();
    });
  });

  document.querySelectorAll('.sent-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sent-pill').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentSentiment = btn.dataset.action;
      filterAndRender();
    });
  });

  const firmSelect = document.getElementById('firm-select');
  if (firmSelect) {
    firmSelect.addEventListener('change', e => {
      currentBroker = e.target.value || 'all';
      filterAndRender();
    });
  }

  const searchInput = document.getElementById('radar-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      currentQuery = e.target.value;
      filterAndRender();
    });
  }

  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetAllFilters);
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
