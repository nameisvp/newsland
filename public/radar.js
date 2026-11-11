/**
 * Newsland Brokerage Radar Engine
 * Fetches institutional research calls, ratings, and target prices with client-side instant filtering.
 */

// Helper to fetch live API with static /data fallback for Cloudflare Pages
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

// State
let rawCalls = [];
let currentSentiment = 'all';
let currentBroker = 'all';
let currentQuery = '';

// Theme System
const THEMES = ['paper', 'night', 'sepia', 'slate'];
function initTheme() {
  const savedTheme = localStorage.getItem('newsland.theme') || 'paper';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'paper';
      const nextIdx = (THEMES.indexOf(cur) + 1) % THEMES.length;
      const nextTheme = THEMES[nextIdx];
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('newsland.theme', nextTheme);
    });
  }
}

// Relative time formatter
function formatTimeAgo(ts) {
  if (!ts) return 'Recent';
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// Render Stats Header
function updateStats(data) {
  const stats = data.stats || {};
  const total = stats.total || rawCalls.length || 0;
  const bull = stats.bullish || 0;
  const bear = stats.bearish || 0;
  const neut = stats.neutral || 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-bullish').textContent = bull;
  document.getElementById('stat-bearish').textContent = bear;

  document.getElementById('count-all').textContent = total;
  document.getElementById('count-bull').textContent = bull;
  document.getElementById('count-bear').textContent = bear;
  document.getElementById('count-neutral').textContent = neut;

  if (stats.top_brokerages && stats.top_brokerages.length > 0) {
    const top = stats.top_brokerages.filter(b => b.name !== 'Brokerage Radar').slice(0, 3);
    const firmStr = top.map(b => `${b.name} (${b.count})`).join(', ') || 'Global & Domestic';
    document.getElementById('stat-top-firm').textContent = firmStr;
  } else {
    document.getElementById('stat-top-firm').textContent = 'Global & Indian Firms';
  }

  if (data.updated) {
    try {
      const d = new Date(data.updated);
      document.getElementById('stat-updated').textContent = `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      document.getElementById('stat-updated').textContent = 'Live Feed Active';
    }
  }
}

// Render Brokerage Filter Chips
function renderBrokerChips(stats) {
  const container = document.getElementById('broker-chips-row');
  if (!container) return;

  const top = (stats.top_brokerages || []).filter(b => b.name !== 'Brokerage Radar');
  let html = `<button class="radar-broker-chip ${currentBroker === 'all' ? 'active' : ''}" data-broker="all">All Firms</button>`;
  for (const b of top) {
    const isActive = currentBroker.toLowerCase() === b.name.toLowerCase();
    html += `<button class="radar-broker-chip ${isActive ? 'active' : ''}" data-broker="${escapeHtml(b.name)}">${escapeHtml(b.name)} (${b.count})</button>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.radar-broker-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.radar-broker-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentBroker = btn.dataset.broker;
      filterAndRender();
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// Render Main Radar Grid
function filterAndRender() {
  const grid = document.getElementById('radar-grid');
  if (!grid) return;

  const q = currentQuery.trim().toLowerCase();

  const filtered = rawCalls.filter(c => {
    // Sentiment filter
    if (currentSentiment !== 'all' && c.sentiment !== currentSentiment) {
      return false;
    }

    // Brokerage filter
    if (currentBroker !== 'all') {
      const bName = (c.brokerage || '').toLowerCase();
      const matchBroker = (c.brokerages || []).some(b => b.toLowerCase() === currentBroker.toLowerCase());
      if (bName !== currentBroker.toLowerCase() && !matchBroker) return false;
    }

    // Query filter
    if (q) {
      const matchText = `${c.title || ''} ${c.summary || ''} ${c.stock || ''} ${c.brokerage || ''} ${c.symbol || ''}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="radar-empty">
        <h3>No matching brokerage calls found</h3>
        <p>Try clearing your search query or switching to "All Calls" to view all latest updates.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of filtered) {
    const sentimentCls = item.sentiment === 'bullish' ? 'bullish' : (item.sentiment === 'bearish' ? 'bearish' : 'neutral');
    const timeAgo = formatTimeAgo(item.published);
    const sourceName = item.source || 'Media Radar';

    const stockName = item.stock && item.stock !== 'Market / Sector' ? item.stock : '';
    const stockQuery = item.symbol || stockName;

    html += `
      <article class="radar-card" data-id="${escapeHtml(item.id)}">
        <div class="radar-card-header">
          <div class="radar-card-pills">
            <span class="broker-badge">${escapeHtml(item.brokerage)}</span>
            <span class="action-badge ${sentimentCls}">${escapeHtml(item.action_label)}</span>
            ${item.target ? `<span class="target-pill">${escapeHtml(item.target)}</span>` : ''}
          </div>
          ${stockName ? `
            <div class="radar-stock-row">
              <span class="radar-stock-title">${escapeHtml(stockName)}</span>
              ${stockQuery ? `<a href="index.html?company=${encodeURIComponent(stockQuery)}" class="radar-stock-link" title="Open ${escapeHtml(stockName)} in Company X-Ray">X-Ray ↗</a>` : ''}
            </div>
          ` : ''}
        </div>

        <div class="radar-card-body">
          ${escapeHtml(item.title)}
          ${item.summary && item.summary !== item.title ? `<p class="radar-card-summary">${escapeHtml(item.summary)}</p>` : ''}
        </div>

        <div class="radar-card-footer">
          <span>${escapeHtml(timeAgo)} &middot; ${escapeHtml(item.published_str || '')}</span>
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer" class="radar-source-link">
            via ${escapeHtml(sourceName)} ↗
          </a>
        </div>
      </article>
    `;
  }

  grid.innerHTML = html;
}

// Fetch and load data
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
    const grid = document.getElementById('radar-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="radar-empty">
          <h3>Brokerage Radar feed temporarily offline</h3>
          <p>Could not fetch recommendations: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }
}

// Setup Event Listeners
function setupEvents() {
  // Sentiment filter chips
  document.querySelectorAll('.radar-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.radar-filter-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentSentiment = btn.dataset.action;
      filterAndRender();
    });
  });

  // Search input
  const searchInput = document.getElementById('radar-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentQuery = e.target.value;
      filterAndRender();
    });
  }

  // Refresh button
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

// Boot
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEvents();
  loadRadarData();
});
