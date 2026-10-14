'use strict';

// DOM selector helper
const $ = id => document.getElementById(id);

// LocalStorage helpers
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch {}
};

// State
const previousVisit = read('newsland.visit', 0);
save('newsland.visit', Date.now());

let horizon = read('newsland.horizon', 'today');
let region = 'All';
let briefing = { stories: [], sources: [] };
let watchlist = read('newsland.watchlist', []);
let feedback = read('newsland.feedback', {});
let readStories = read('newsland.read_stories', {});
let shortsFilterUnreadOnly = true;
let shortsRegion = 'All';

function markStoryAsRead(id) {
  if (!id) return;
  if (!readStories[id]) {
    readStories[id] = Date.now();
    // Prune entries older than 14 days
    const maxAge = Date.now() - 14 * 86400 * 1000;
    for (const k in readStories) {
      if (readStories[k] < maxAge) delete readStories[k];
    }
    save('newsland.read_stories', readStories);
    if (typeof updateShortsFilterCounts === 'function') updateShortsFilterCounts();
  }
}

function isStoryRead(id) {
  return Boolean(id && readStories[id]);
}

function resetReadStories() {
  readStories = {};
  save('newsland.read_stories', readStories);
  if (typeof updateShortsFilterCounts === 'function') updateShortsFilterCounts();
}

let events = [];
let searchQuery = '';
let activeTrendingWord = '';
let activeCatalystFilter = 'all';
let activeMarketMoversOnly = false;
let activeLatestFirst = read('newsland.sort_latest', false);
let activeSector = 'all';
let premarketData = null;

const SECTOR_KEYWORDS = {
  banking: ['bank', 'banking', 'rbi', 'repo', 'hdfc', 'icici', 'sbi', 'axis', 'kotak', 'nbfc', 'loan', 'emi', 'deposit', 'fd', 'fintech', 'fino', 'credit', 'rate hike'],
  it: ['it', 'tech', 'tcs', 'infosys', 'infy', 'wipro', 'hcl', 'accenture', 'software', 'ai', 'chip', 'semiconductor', 'tsmc', 'nasdaq'],
  energy: ['crude', 'oil', 'brent', 'petroleum', 'omc', 'refinery', 'gas', 'reliance', 'ril', 'opec', 'fuel', 'bpcl', 'ioc', 'hpcl'],
  auto: ['auto', 'automotive', 'car', 'vehicle', 'tata motors', 'maruti', 'mahindra', 'bajaj', 'hero', 'ev', 'sales'],
  metals: ['metal', 'metals', 'steel', 'iron', 'copper', 'aluminum', 'mining', 'vedanta', 'tata steel', 'jsw', 'gold', 'silver', 'bullion'],
  earnings: ['earnings', 'quarterly', 'results', 'q1', 'q2', 'q3', 'q4', 'profit', 'revenue', 'pat', 'ebitda', 'dividend', 'buyback', 'margin', 'guidance', 'board meeting'],
  commodities: ['crude', 'oil', 'brent', 'wti', 'natgas', 'natural gas', 'gold', 'silver', 'copper', 'metals', 'opec', 'eia', 'barrel', 'mcx', 'comex', 'energy']
};

function getISTSession() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const totalMinutes = hour * 60 + minute;

  const weekday = parts.find(p => p.type === 'weekday').value;
  if (weekday === 'Sat' || weekday === 'Sun') return { id: 'closed', tag: 'MARKET CLOSED · WEEKEND BRIEF', colLabel: 'LATEST NIFTY QUOTE', subPrefix: 'Previous close' };

  if (totalMinutes >= 450 && totalMinutes < 555) {
    return {
      id: 'premarket',
      tag: 'PRE-MARKET DESK BRIEF',
      colLabel: 'LATEST NIFTY QUOTE',
      subPrefix: 'Previous close'
    };
  } else if (totalMinutes >= 555 && totalMinutes < 930) {
    return {
      id: 'live',
      tag: 'SESSION MONITOR · QUOTES MAY BE DELAYED',
      colLabel: 'BENCHMARK PULSE',
      subPrefix: 'Previous close'
    };
  } else if (totalMinutes >= 930 && totalMinutes < 1170) {
    return {
      id: 'postmarket',
      tag: 'POST-MARKET CLOSE & WRAP',
      colLabel: 'SESSION CLOSE',
      subPrefix: 'Final Close · Prev Close'
    };
  } else {
    return {
      id: 'overnight',
      tag: 'OVERNIGHT GLOBAL MONITOR',
      colLabel: 'GLOBAL DRIFT',
      subPrefix: 'Overnight Cues · Next Prep'
    };
  }
}

// Reading settings state
let currentTheme = read('newsland.theme', 'paper');
let currentFont = read('newsland.font', 'serif');
if (currentFont !== 'sans') currentFont = 'serif';
let currentSize = read('newsland.size', 'md');

// Hero Carousel State
let heroStories = [];
let heroIndex = 0;
let heroTimer = null;

// HTML entity and safe link sanitizer
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const safeUrl = url => {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : '#';
  } catch {
    return '#';
  }
};

const ist = { timeZone: 'Asia/Kolkata' };

// Publisher Name Extractor
function getPublisherName(url, fallbackName) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('economictimes')) return 'Economic Times';
    if (host.includes('business-standard')) return 'Business Standard';
    if (host.includes('ndtvprofit') || host.includes('ndtv')) return 'NDTV Business';
    if (host.includes('thehindu')) return 'The Hindu Business';
    if (host.includes('livemint') || host.includes('mint')) return 'Mint';
    if (host.includes('moneycontrol')) return 'Moneycontrol';
    if (host.includes('cnbc')) return 'CNBC';
    if (host.includes('investing')) return 'Investing.com';
    if (host.includes('bloomberg')) return 'Bloomberg';
    if (host.includes('reuters')) return 'Reuters';
    if (host.includes('sebi')) return 'SEBI';
    if (host.includes('federalreserve')) return 'Federal Reserve';
    if (host.includes('bls.gov')) return 'US BLS';
  } catch (e) {}
  return fallbackName || 'Financial Wire';
}

// Relative Time (e.g. "23 minutes ago", "2 hours ago", "2 days ago")
function timeAgo(publishedSeconds) {
  if (!publishedSeconds) return 'Just now';
  const diffSec = Math.floor(Date.now() / 1000 - publishedSeconds);
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(publishedSeconds * 1000).toLocaleDateString('en-IN', {
    ...ist, month: 'short', day: 'numeric'
  });
}

function dateText(value) {
  return new Date(value).toLocaleString('en-IN', {
    ...ist, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}
const dayKey = value => new Date(value).toLocaleDateString('en-CA', ist);

function setDates() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', {
    ...ist,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  if ($('date')) $('date').textContent = `${dateStr} 📅`;
}
setDates();
window.addEventListener('resize', setDates, { passive: true });

// Theme, Font & Size switchers
function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  save('newsland.theme', theme);
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === theme);
  });
}

function applyFont(font) {
  currentFont = (font === 'sans') ? 'sans' : 'serif';
  document.documentElement.setAttribute('data-font', currentFont);
  save('newsland.font', currentFont);
  if ($('font-serif-btn')) $('font-serif-btn').classList.toggle('active', currentFont === 'serif');
  if ($('font-sans-btn')) $('font-sans-btn').classList.toggle('active', currentFont === 'sans');
}

function applySize(size) {
  currentSize = ['sm', 'md', 'lg'].includes(size) ? size : 'md';
  document.documentElement.setAttribute('data-size', currentSize);
  save('newsland.size', currentSize);
  document.querySelectorAll('.size-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sizeVal === currentSize);
  });
}

applyTheme(currentTheme);
applyFont(currentFont);
applySize(currentSize);

// Watchlist Matching
function watchMatch(story) {
  const text = story.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    'hdfcbank': ['hdfcbank', 'hdfc'],
    'niftyit': ['infosys', 'tcs', 'wipro', 'accenture', 'itservices'],
    'banknifty': ['bank', 'rbi', 'sbi', 'icici', 'hdfc']
  };
  return watchlist.some(term => {
    const key = term.toLowerCase().replace(/[^a-z0-9]/g, '');
    const variants = [term, ...(aliases[key] || [])];
    return variants.some(alias => text.includes(alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
  });
}

// Category Eyebrow Tag Formatter (Matches Mockup)
function getCategoryTag(story) {
  const cat = story.category || '';
  if (cat === 'Energy & geopolitics') return 'COMMODITIES';
  if (cat === 'Monetary policy') return story.region === 'India' ? 'INDIA' : 'GLOBAL MARKETS';
  if (cat === 'Economic data') return 'MARKETS';
  if (cat === 'Earnings') return 'RESULTS';
  if (cat === 'Regulation') return 'REGULATION';
  if (cat === 'Market flows') return 'MARKETS';
  return story.region === 'India' ? 'INDIA' : 'GLOBAL';
}

// Trending Keywords Bar (Mockup default keywords + dynamic top market terms)
const DEFAULT_TRENDS = ['Shares', 'Growth', 'Sensex', 'Nifty', 'Gold', 'Prices', 'Data', 'Fed', 'War', 'Yields', 'Business'];

function renderTrendingKeywords(stories) {
  const terms = DEFAULT_TRENDS;
  $('trending-keywords').innerHTML = terms.map(term => {
    const isActive = activeTrendingWord.toLowerCase() === term.toLowerCase();
    return `<span class="trend-pill ${isActive ? 'active' : ''}" data-word="${esc(term)}">${esc(term)}</span>`;
  }).join('');
}

// Hero Carousel Manager
function updateHeroSlide() {
  if (!heroStories.length || region === 'Events') {
    $('hero-carousel').hidden = true;
    return;
  }
  $('hero-carousel').hidden = false;

  const story = heroStories[heroIndex];
  if (!story) return;

  const catTag = getCategoryTag(story);
  $('hero-cat').textContent = catTag;
  $('hero-time').textContent = timeAgo(story.published);
  $('hero-link').textContent = story.title;
  $('hero-link').href = safeUrl(story.url);

  // Multi-source confirmation badge in hero
  const numSources = story.sources ? story.sources.length : 1;
  if ($('hero-cluster') && $('hero-cluster-dot')) {
    if (numSources > 1) {
      $('hero-cluster').textContent = `● ${numSources} SOURCES`;
      $('hero-cluster').hidden = false;
      $('hero-cluster-dot').hidden = false;
    } else {
      $('hero-cluster').hidden = true;
      $('hero-cluster-dot').hidden = true;
    }
  }

  // Snippet: Contextual "Why It Matters" Market Catalyst
  const snippet = story.why_it_matters || (story.summary && story.summary.trim().length > 20 ? story.summary : story.reason) || 'Key market catalyst driving market liquidity and session volatility.';
  $('hero-snippet').textContent = snippet;

    // Hero Intelligence: Impact assets and confirming publishers
  if ($('hero-intel')) {
    const assets = story.impact_assets?.length ? story.impact_assets.join(' · ') : 'Equities';
    if ($('hero-impact')) $('hero-impact').textContent = assets;
    if ($('hero-sources')) {
      const sourcesMarkup = story.sources?.map(src => `<a class="hero-src-link" href="${safeUrl(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}</a>`).join(' · ') || '';
      $('hero-sources').innerHTML = sourcesMarkup ? `Coverage: ${sourcesMarkup}` : '';
    }
    $('hero-intel').hidden = false;
  }

  // Hero Impact Chain
  if ($('hero-chain')) {
    if (story.impact_chain) {
      const chain = story.impact_chain;
      const tailwindsHtml = chain.tailwinds?.length
        ? `<span class="chain-group up"><span class="chain-arrow">↗</span> ${chain.tailwinds.map(w => `<button class="company-tag" data-symbol="${esc(w)}" title="View ${esc(w)} X-Ray">${esc(w)}</button>`).join(', ')}</span>`
        : '';
      const headwindsHtml = chain.headwinds?.length
        ? `<span class="chain-group down"><span class="chain-arrow">↘</span> ${chain.headwinds.map(h => `<button class="company-tag" data-symbol="${esc(h)}" title="View ${esc(h)} X-Ray">${esc(h)}</button>`).join(', ')}</span>`
        : '';
      const sep = (tailwindsHtml && headwindsHtml) ? '<span class="chain-sep">·</span>' : '';
      $('hero-chain').innerHTML = `
        <span class="chain-catalyst">${esc(chain.catalyst)}:</span>
        ${tailwindsHtml}
        ${sep}
        ${headwindsHtml}
      `;
      $('hero-chain').hidden = false;
    } else {
      $('hero-chain').hidden = true;
    }
  }

  // Hero Named Company Entities
  if ($('hero-companies')) {
    if (story.companies && story.companies.length) {
      $('hero-companies').innerHTML = `
        <span class="companies-label">Companies:</span>
        ${story.companies.map(c => `<button class="company-tag" data-symbol="${esc(c.symbol || c.name)}" title="Inspect ${esc(c.name)} Financial X-Ray">↗ ${esc(c.name)}</button>`).join(' · ')}
      `;
      $('hero-companies').hidden = false;
    } else {
      $('hero-companies').hidden = true;
    }
  }

  // Typographic counter: 1 / 5
  if ($('hero-counter')) {
    $('hero-counter').textContent = `${heroIndex + 1} / ${heroStories.length}`;
  }
}

function nextHeroSlide() {
  if (!heroStories.length) return;
  heroIndex = (heroIndex + 1) % heroStories.length;
  updateHeroSlide();
}

function prevHeroSlide() {
  if (!heroStories.length) return;
  heroIndex = (heroIndex - 1 + heroStories.length) % heroStories.length;
  updateHeroSlide();
}

function startHeroAutoPlay() {
  stopHeroAutoPlay();
  if (heroStories.length > 1) heroTimer = setInterval(nextHeroSlide, 8000);
}

function stopHeroAutoPlay() {
  if (heroTimer) clearInterval(heroTimer);
}

// Render Feed Cards with Multi-Source Clustering & Asset Impact
function cardHTML(s) {
  const catTag = getCategoryTag(s);
  const isUseful = feedback[s.id] === 'useful';
  const tier = viewTier(s);
  const tierLabel = tier === 'Must know' ? 'DRIVER' : tier === 'Watch' ? 'WATCH' : 'MORE';
  const sources = s.sources || [];
  const numSources = sources.length;
  const isMultiSource = numSources > 1;

  // Distilled Snippet / Why It Matters
  const snippet = s.why_it_matters || s.summary || s.reason || '';

  // Asset impact row
  const impactRow = s.impact_assets && s.impact_assets.length
    ? `<div class="card-impact-row"><span class="impact-label">Impact:</span> ${s.impact_assets.map(a => `<span class="impact-val">${esc(a)}</span>`).join(' · ')}</div>`
    : '';

  // Impact Chain transmission row
  let impactChainRow = '';
  if (s.impact_chain) {
    const chain = s.impact_chain;
    const tailwindsHtml = chain.tailwinds?.length
      ? `<span class="chain-group up"><span class="chain-arrow">↗</span> ${chain.tailwinds.map(w => `<button class="company-tag" data-symbol="${esc(w)}" title="View ${esc(w)} X-Ray">${esc(w)}</button>`).join(', ')}</span>`
      : '';
    const headwindsHtml = chain.headwinds?.length
      ? `<span class="chain-group down"><span class="chain-arrow">↘</span> ${chain.headwinds.map(h => `<button class="company-tag" data-symbol="${esc(h)}" title="View ${esc(h)} X-Ray">${esc(h)}</button>`).join(', ')}</span>`
      : '';
    const sep = (tailwindsHtml && headwindsHtml) ? '<span class="chain-sep">·</span>' : '';
    impactChainRow = `
    <div class="card-impact-chain">
      <span class="chain-catalyst">${esc(chain.catalyst)}:</span>
      ${tailwindsHtml}
      ${sep}
      ${headwindsHtml}
    </div>`;
  }

  // Named Company Entities row
  let companiesRow = '';
  if (s.companies && s.companies.length) {
    const existingPills = new Set([
      ...(s.impact_chain?.tailwinds || []),
      ...(s.impact_chain?.headwinds || [])
    ].map(x => x.toLowerCase()));
    const unshown = s.companies.filter(c => !existingPills.has(c.name.toLowerCase()) && !existingPills.has(c.symbol.toLowerCase()));
    if (unshown.length) {
      companiesRow = `
      <div class="card-companies-row">
        <span class="companies-label">Entities:</span>
        ${unshown.map(c => `<button class="company-tag" data-symbol="${esc(c.symbol || c.name)}" title="Inspect ${esc(c.name)} Financial X-Ray">↗ ${esc(c.name)}</button>`).join(' · ')}
      </div>`;
    }
  }

  // Sources bar: cluster of publications or single publisher
  let sourcesBar = '';
  if (isMultiSource) {
    sourcesBar = `
    <div class="card-source-cluster">
      <span class="cluster-sources">${sources.map(src => `<a class="source-link" href="${safeUrl(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}</a>`).join('<span class="source-sep">·</span>')}</span>
      ${s.related?.length ? `<button class="related-toggle-btn" data-toggle="${esc(s.id)}">+${s.related.length} related ▾</button>` : ''}
    </div>`;
  } else {
    const publisher = getPublisherName(s.url, sources[0]?.name);
    sourcesBar = `<span class="card-source">${esc(publisher)}</span>`;
  }

  // Related reporting drawer
  const relatedTray = s.related && s.related.length
    ? `<div class="related-tray" id="tray-${esc(s.id)}" hidden>
        ${s.related.map(r => `
          <div class="related-row">
            <a class="related-link" href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>
            <span class="related-src">${esc(r.source)}</span>
          </div>
        `).join('')}
      </div>`
    : '';

  return `
  <article class="feed-card" data-story-id="${esc(s.id)}">
    <div class="card-eyebrow">
      <span class="card-tag">${esc(catTag)}</span>
      <span class="card-tier tier-${tier === 'Must know' ? 'driver' : tier.toLowerCase()}">${tierLabel}</span>
      ${isMultiSource ? `<span class="card-cluster-badge">● ${numSources} SOURCES</span>` : ''}
      <span class="card-dot">·</span>
      <span class="card-time">${timeAgo(s.published)}</span>
    </div>
    <div class="card-title-row">
      <a class="card-title" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">
        ${esc(s.title)}
      </a>
      <span class="card-chevron" aria-hidden="true">›</span>
    </div>
    ${snippet ? `<p class="card-snippet">${esc(snippet)}</p>` : ''}
    ${impactRow}
    ${impactChainRow}
    ${companiesRow}
    <div class="card-source-bar">
      ${sourcesBar}
      <div class="card-actions">
        <button class="card-btn ${isUseful ? 'is-useful' : ''}" data-feedback="useful" data-id="${esc(s.id)}" aria-pressed="${isUseful}" title="Give this headline a small ranking boost">${isUseful ? 'Useful to me ✓' : 'Useful to me'}</button>
        <button class="card-btn" data-feedback="hide" data-id="${esc(s.id)}" title="Hide this headline. Restore hidden stories in Settings.">Hide story</button>
      </div>
    </div>
    ${relatedTray}
  </article>`;
}

function viewScore(story) {
  let score = Number(story.score) || 0;
  // If story has no market signal at all and is from a single source, do not artificially boost it into a false catalyst
  if (score <= 0 && (!story.sources || story.sources.length <= 1)) return 0;

  const ageHours = story.published ? (Date.now() / 1000 - story.published) / 3600 : 999;

  // Intraday freshness velocity curve: boost breaking high-signal news within today's session
  if (horizon === 'today') {
    if (ageHours < 1) score += 4.0;       // Breaking in last hour
    else if (ageHours < 2) score += 2.5;  // Fresh catalyst
    else if (ageHours < 4) score += 1.0;  // Recent session catalyst
    else if (ageHours < 8) score += 0.0;  // Earlier today
    else if (ageHours < 16) score -= 3.0; // Older overnight news
    else if (ageHours < 24) score -= 5.0; // Previous session
    else score -= 8.0;                    // Multi-day old
  } else if (horizon === 'week') {
    if (ageHours > 72) score -= 1;
  }

  if (feedback[story.id] === 'useful') score += 1;
  if (watchMatch(story)) score += 2;
  if ((story.sources?.length || 0) > 1) score += Math.min(2, story.sources.length - 1);
  return score;
}

function viewTier(story) {
  const score = viewScore(story);
  return score >= 6 ? 'Must know' : score >= 3 ? 'Watch' : 'More';
}

function fillColumns(prefix, stories, numCols) {
  const buckets = Array.from({ length: 3 }, () => []);
  stories.forEach((story, index) => buckets[index % numCols].push(story));
  buckets.forEach((bucket, index) => {
    const target = $(`${prefix}${index}`);
    if (target) target.innerHTML = bucket.map(cardHTML).join('');
  });
}

// Main Render Function
function render() {
  const isMonday = new Date().toLocaleDateString('en-US', { ...ist, weekday: 'short' }) === 'Mon';
  const cutoff = Date.now() / 1000 - (horizon === 'week' ? 7 : isMonday ? 3 : 1) * 86400;

  let base = briefing.stories.filter(s =>
    s.published &&
    s.published >= cutoff &&
    feedback[s.id] !== 'hide' &&
    (!$('new-only').checked || (s.published * 1000 > previousVisit))
  );

  // Watchlist filter
  if ($('watch-only').checked) {
    base = base.filter(s =>
      watchMatch(s) || s.matched.some(m => ['Monetary policy', 'Economic data', 'Energy & geopolitics', 'Regulation'].includes(m))
    );
  }

  // Active trending keyword filter
  if (activeTrendingWord) {
    const tw = activeTrendingWord.toLowerCase();
    base = base.filter(s => s.title.toLowerCase().includes(tw) || (s.category && s.category.toLowerCase().includes(tw)));
  }

  // Live search filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    base = base.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.category && s.category.toLowerCase().includes(q)) ||
      (s.reason && s.reason.toLowerCase().includes(q)) ||
      (s.sources && s.sources.some(src => src.name.toLowerCase().includes(q)))
    );
  }

  // Sector filter
  if (activeSector !== 'all') {
    const kws = SECTOR_KEYWORDS[activeSector] || [];
    base = base.filter(s => {
      const titleLower = s.title.toLowerCase();
      const catLower = (s.category || '').toLowerCase();
      const assets = (s.impact_assets || []).map(a => a.toLowerCase());
      return kws.some(kw => titleLower.includes(kw) || catLower.includes(kw) || assets.includes(kw));
    });
  }

  // High-conviction Market Movers only filter
  if (activeMarketMoversOnly) {
    base = base.filter(s => {
      const score = viewScore(s);
      const clusterCount = s.sources?.length || 1;
      const isDriverCat = ['Monetary policy', 'Energy & geopolitics', 'Economic data', 'Regulation'].includes(s.category);
      return score >= 6 || (clusterCount >= 2 && score >= 4) || (isDriverCat && score >= 5);
    });
  }

  let filtered = base;
  if (region === 'Global') filtered = base.filter(s => s.region === 'Global');
  else if (region === 'India') filtered = base.filter(s => s.region === 'India');

  // Render trending keywords list
  renderTrendingKeywords(filtered);

  const FRONT_PAGE_LIMIT = 18; // 6 balanced rows of 3 columns
  let primaryStories = [];
  let lowerStories = [];
  let fallbackUsed = false;

  // Strict Curation: prioritize actionable market movers and exclude 0-signal filler
  const highSignalCandidates = filtered.filter(s => viewTier(s) !== 'More');
  const pool = highSignalCandidates.length >= 6 ? [...highSignalCandidates] : [...filtered];

  // Sort pool: Latest First if toggled, otherwise Top Impact Score
  if (activeLatestFirst) {
    pool.sort((a, b) => {
      const timeA = Number(a.published) || 0;
      const timeB = Number(b.published) || 0;
      if (timeB !== timeA) return timeB - timeA;
      return (viewScore(b) - viewScore(a));
    });
  } else {
    pool.sort((a, b) => {
      return (viewScore(b) - viewScore(a)) || ((b.published || 0) - (a.published || 0));
    });
  }

  // Primary front-page grid is strictly capped at FRONT_PAGE_LIMIT
  primaryStories = pool.slice(0, FRONT_PAGE_LIMIT);
  const primaryIds = new Set(primaryStories.map(s => s.id));
  lowerStories = pool.slice(FRONT_PAGE_LIMIT);
  if (!highSignalCandidates.length) fallbackUsed = true;

  // Hero Carousel: Prioritize breaking, high-impact market drivers
  function heroRank(s) {
    const base = viewScore(s);
    const ageHours = s.published ? (Date.now() / 1000 - s.published) / 3600 : 999;
    let recencyBoost = 0;
    if (ageHours < 1) recencyBoost = 6;       // Just broke in last hour
    else if (ageHours < 3) recencyBoost = 4;  // Breaking in last 3 hours
    else if (ageHours < 6) recencyBoost = 2;  // Active intraday catalyst
    else if (ageHours < 10) recencyBoost = 0; // Earlier today
    else if (ageHours > 12) recencyBoost = -5;// Older overnight news
    return base + recencyBoost;
  }

  const mustKnow = filtered.filter(s => viewTier(s) === 'Must know');
  const heroCandidates = activeLatestFirst
    ? [...filtered].sort((a, b) => (Number(b.published) || 0) - (Number(a.published) || 0))
    : [...mustKnow].sort((a, b) => (heroRank(b) - heroRank(a)) || ((b.published || 0) - (a.published || 0)));
  heroStories = heroCandidates.slice(0, 3);

  if (heroStories.length) {
    if (heroIndex >= heroStories.length) heroIndex = 0;
    updateHeroSlide();
    const singleLead = heroStories.length < 2;
    $('hero-prev').hidden = singleLead;
    $('hero-next').hidden = singleLead;
    $('hero-counter').hidden = singleLead;
    startHeroAutoPlay();
  } else {
    $('hero-carousel').hidden = true;
  }

  // Keep every high-signal story in the main grid, including drivers not on the rotating lead.
  const heroIds = new Set(heroStories.map(s => s.id));
  const gridStories = primaryStories.filter(s => !heroIds.has(s.id));

  const width = window.innerWidth;
  const numCols = width <= 680 ? 1 : width <= 960 ? 2 : 3;
  fillColumns('col-', gridStories, numCols);
  fillColumns('more-col-', lowerStories, numCols);
  $('more-details').hidden = lowerStories.length === 0;
  $('more-label').textContent = `More headlines · ${lowerStories.length}`;

  const hasFilter = Boolean(searchQuery.trim() || activeTrendingWord || activeMarketMoversOnly || (activeSector !== 'all') || $('watch-only').checked || $('new-only').checked);

  if (activeSector !== 'all') {
    $('ranking-note').hidden = false;
    $('ranking-note').textContent = `Sector: ${activeSector.toUpperCase()} (${filtered.length} headlines matched)`;
  } else if (activeMarketMoversOnly) {
    $('ranking-note').hidden = false;
    $('ranking-note').textContent = `⚡ High-conviction market movers (${filtered.length} headlines matched)`;
  } else {
    $('ranking-note').hidden = hasFilter || filtered.length === 0;
    $('ranking-note').textContent = fallbackUsed
      ? `Showing ${primaryStories.length} curated headlines for today's session.`
      : `${primaryStories.length} market-moving catalysts · ${lowerStories.length} additional headlines in More`;
  }

  $('empty-feed').hidden = primaryStories.length > 0 || lowerStories.length > 0;

  // View switching: Feed vs Catalysts & Pre-Market Brief
  $('briefing').hidden = region === 'Events';
  $('hero-carousel').hidden = region === 'Events' || !heroStories.length;
  $('calendar-view').hidden = region !== 'Events';
  if ($('premarket-brief')) {
    $('premarket-brief').hidden = region === 'Events' || !premarketData;
  }

  // Update Catalysts tab badge for today's market catalysts
  const todayCount = events.filter(e => e.verified && dayKey(e.at) === dayKey(Date.now())).length;
  const catalystsTab = document.querySelector('.tab-btn[data-region="Events"]');
  if (catalystsTab) {
    catalystsTab.innerHTML = todayCount > 0
      ? `Catalysts <span class="tab-badge">${todayCount}</span>`
      : 'Catalysts';
  }

  // Watchlist badge count
  if ($('watch-count')) $('watch-count').textContent = watchlist.length ? watchlist.length : '0';
  $('reset-feedback').hidden = !Object.values(feedback).includes('hide');

  // Source health
  const failures = briefing.sources.filter(s => s.status !== 'ok');
  $('health').textContent = `${briefing.sources.length - failures.length}/${briefing.sources.length}`;
  $('notice').hidden = failures.length === 0;
  $('notice').innerHTML = failures.length === 0
    ? ''
    : `<span class="notice-dot">●</span> ${failures.length} ${failures.length === 1 ? 'source is' : 'sources are'} unavailable · briefing may be incomplete`;

  $('source-list').innerHTML = briefing.sources.map(s => `
    <div class="source-row">
      <a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>
      <span class="${s.status === 'ok' ? 'source-ok' : 'source-err'}">
        ${s.status === 'ok' ? `${s.count} items` : 'Unavailable'}
      </span>
      <span class="source-time">
        ${s.status === 'ok' ? `Checked ${dateText(s.checked)}` : esc(s.error)}
      </span>
    </div>
  `).join('');

  // Catalysts / Events view rendering
  renderCatalysts();
}

// Rich Market Catalysts Ledger Renderer
function renderCatalysts() {
  if (!$('calendar-view')) return;
  const countSpan = $('calendar-health');

  // Filter events
  let filtered = events.filter(e => e.verified === true && Number.isFinite(Date.parse(e.at)));

  // Filter by user selection
  if (activeCatalystFilter === 'high') {
    filtered = filtered.filter(e => e.impact === 'HIGH');
  } else if (activeCatalystFilter === 'india') {
    filtered = filtered.filter(e => e.country === 'India' || e.country_code === 'IN');
  } else if (activeCatalystFilter === 'earnings') {
    filtered = filtered.filter(e => e.category === 'Corporate Earnings');
  } else if (activeCatalystFilter === 'macro') {
    filtered = filtered.filter(e => e.category === 'Macro Data' || e.category === 'Monetary Policy');
  } else if (activeCatalystFilter === 'expiry') {
    filtered = filtered.filter(e => e.category === 'Derivatives Expiry');
  }

  // Sort chronologically ascending
  filtered.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (countSpan) {
    countSpan.textContent = `${filtered.length} scheduled catalyst${filtered.length === 1 ? '' : 's'}`;
  }

  const container = $('events');
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-feed"><p>No verified catalysts match the selected filter criteria.</p></div>`;
    return;
  }

  const nowKey = dayKey(Date.now());

  container.innerHTML = filtered.map(e => {
    const isToday = dayKey(e.at) === nowKey;
    const isPast = Date.parse(e.at) < Date.now() - 3600000;
    const dateObj = new Date(e.at);
    const dateFormatted = dateObj.toLocaleDateString('en-IN', { ...ist, weekday: 'short', day: 'numeric', month: 'short' });
    const timeFormatted = dateObj.toLocaleTimeString('en-IN', { ...ist, hour: 'numeric', minute: '2-digit' });

    const isHigh = e.impact === 'HIGH';
    const impactClass = isHigh ? 'impact-high' : 'impact-med';
    const impactText = isHigh ? 'HIGH IMPACT' : 'MEDIUM';
    const countryFlag = e.country_code === 'IN' ? 'India 🇮🇳' : e.country_code === 'US' ? 'US 🇺🇸' : 'Global 🌐';

    return `
    <article class="catalyst-card ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}">
      <div class="catalyst-time-col">
        <span class="catalyst-time">${timeFormatted}</span>
        <span class="catalyst-date">${dateFormatted}</span>
        ${isToday ? '<span class="today-tag">TODAY</span>' : ''}
      </div>
      <div class="catalyst-body">
        <div class="catalyst-meta">
          <span class="catalyst-pill ${impactClass}">${impactText}</span>
          <span class="catalyst-pill cat-type">${esc(e.category || 'Macro')}</span>
          <span class="catalyst-geo">${countryFlag}</span>
        </div>
        <h3 class="catalyst-title">
          <a href="${safeUrl(e.source)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>
        </h3>
        ${e.what_to_watch ? `
          <div class="catalyst-watch">
            <span class="watch-label">What to watch:</span>
            <span class="watch-text">${esc(e.what_to_watch)}</span>
          </div>
        ` : ''}
        <div class="catalyst-footer-row">
          ${e.assets && e.assets.length ? `
            <div class="catalyst-assets">
              <span class="assets-label">Affects:</span>
              ${e.assets.map(a => `<span class="asset-chip">${esc(a)}</span>`).join(' · ')}
            </div>
          ` : '<div></div>'}
          <a class="catalyst-source-link" href="${safeUrl(e.source)}" target="_blank" rel="noopener noreferrer">Official Source ↗</a>
        </div>
      </div>
    </article>`;
  }).join('');
}

// Watchlist Chips in drawer
function renderWatch() {
  $('watch-chips').innerHTML = watchlist.map((term, index) => `
    <span class="chip">
      ${esc(term)}
      <button data-remove="${index}" aria-label="Remove ${esc(term)}">✕</button>
    </span>
  `).join('');
}

// Session Monitor / Pre-Market Brief Collapse State Management
const getTodayISTString = () => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
};

function setSessionMonitorCollapsed(collapsed) {
  const brief = $('premarket-brief');
  const body = $('premarket-body');
  const toggle = $('premarket-toggle');
  const collapsedSummary = $('premarket-collapsed-summary');
  if (!body || !toggle) return;

  body.hidden = collapsed;
  if (brief) brief.classList.toggle('is-collapsed', collapsed);
  toggle.textContent = collapsed ? 'Expand ▾' : 'Collapse ▴';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  if (collapsedSummary) {
    collapsedSummary.hidden = !collapsed;
  }
}

let isSessionMonitorInitialized = false;

function initSessionMonitorState() {
  if (isSessionMonitorInitialized) return;
  isSessionMonitorInitialized = true;

  const todayIST = getTodayISTString();
  const lastSeenDate = read('newsland.brief_seen_date', null);
  const manualPref = read('newsland.brief_collapsed', null);

  let shouldCollapse = false;
  if (lastSeenDate !== todayIST) {
    // First visit of the day: show expanded!
    shouldCollapse = false;
    save('newsland.brief_seen_date', todayIST);
    save('newsland.brief_collapsed', null);
  } else {
    // Subsequent visits of the day:
    // If the user manually toggled it today, respect that choice; otherwise default to collapsed!
    shouldCollapse = (manualPref !== null) ? Boolean(manualPref) : true;
  }

  setSessionMonitorCollapsed(shouldCollapse);
}

// ── 3-Pillar Post-Market Evening Desk Renderer ─────────────────────────
function renderPostMarketPillars(data) {
  const pillars = data?.postmarket_pillars;

  // Pillar 1: MCX & Commodities Pulse
  const commContainer = $('pm-commodity-grid');
  if (commContainer) {
    const comms = [
      pillars?.commodities?.brent || data?.brent,
      pillars?.commodities?.wti,
      pillars?.commodities?.natgas,
      pillars?.commodities?.gold,
      pillars?.commodities?.silver
    ].filter(Boolean);

    if (comms.length) {
      commContainer.innerHTML = comms.map(c => {
        const isUp = (c.change_pct || 0) >= 0;
        const sign = isUp ? '+' : '';
        const priceStr = c.price || (c.price_raw != null ? c.price_raw.toFixed(2) : '--');
        return `<div class="pm-comm-item">
          <span class="pm-comm-name">${esc(c.label || c.key)}</span>
          <div class="pm-comm-val-group">
            <span class="pm-comm-price">${priceStr}</span>
            <span class="pm-comm-chg ${isUp ? 'up' : 'down'}">${sign}${c.change_pct}%</span>
          </div>
        </div>`;
      }).join('');
    } else {
      commContainer.innerHTML = '<span class="pm-sub">Commodity quotes updating...</span>';
    }
  }

  // Pillar 1 Catalyst
  const commCat = pillars?.commodities?.catalyst;
  if (commCat && $('pm-commodity-lead-box') && $('pm-commodity-lead-link')) {
    $('pm-commodity-lead-box').hidden = false;
    $('pm-commodity-lead-link').textContent = commCat.title;
    $('pm-commodity-lead-link').href = commCat.url && commCat.url !== '#' ? safeUrl(commCat.url) : '#';
  } else if ($('pm-commodity-lead-box')) {
    $('pm-commodity-lead-box').hidden = true;
  }

  // Pillar 2: Corporate Earnings & Board Filings
  const earningsContainer = $('pm-earnings-list');
  if (earningsContainer) {
    const earnings = (pillars?.earnings || []).slice(0, 3);
    if (earnings.length) {
      earningsContainer.innerHTML = earnings.map(e => {
        let comp = (e.companies && e.companies[0]) || '';
        if (!comp) {
          const m = e.title.match(/\b(TCS|INFY|RELIANCE|HDFCBANK|CANARA BANK|BAJAJ|TATA|ITC|WIPRO|ICICIBANK|SBIN|LTIM|TECHM)\b/i);
          comp = m ? m[1].toUpperCase() : 'RESULTS';
        }
        return `<div class="pm-earnings-card">
          <div class="pm-earnings-top">
            <span class="pm-earnings-ticker">${esc(comp)}</span>
            <a href="${e.url && e.url !== '#' ? safeUrl(e.url) : '#'}" class="pm-earnings-title" target="_blank" rel="noopener">${esc(e.title)}</a>
          </div>
        </div>`;
      }).join('');
    } else {
      earningsContainer.innerHTML = `<div class="pm-earnings-card">
        <span class="pm-earnings-sub">Awaiting next scheduled board filing · Check Corporate Calendar</span>
      </div>`;
    }
  }

  // Pillar 3: Global Markets & Overnight Matrix
  const globalContainer = $('pm-global-grid');
  if (globalContainer) {
    const ov = pillars?.global_macro?.overnight || data?.overnight || {};
    const sp = ov.SP500 || { val: '--', pct: 0 };
    const nq = ov.NASDAQ || { val: '--', pct: 0 };
    const u10 = ov.US10Y || { val: '--', pct: 0 };
    const usd = data?.usdinr || { price: '83.95', change_pct: 0 };

    const items = [
      { name: 'S&P 500', val: sp.val, pct: sp.pct },
      { name: 'Nasdaq', val: nq.val, pct: nq.pct },
      { name: 'US 10Y Yield', val: u10.val, pct: u10.pct },
      { name: 'USD / INR', val: `₹${usd.price}`, pct: usd.change_pct }
    ];

    globalContainer.innerHTML = items.map(item => {
      const isUp = (item.pct || 0) >= 0;
      const sign = isUp ? '+' : '';
      const pctStr = item.pct != null ? `${sign}${item.pct}%` : '';
      return `<div class="pm-comm-item">
        <span class="pm-comm-name">${esc(item.name)}</span>
        <div class="pm-comm-val-group">
          <span class="pm-comm-price">${esc(String(item.val))}</span>
          ${pctStr ? `<span class="pm-comm-chg ${isUp ? 'up' : 'down'}">${pctStr}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  if ($('pm-global-vix-pill') && data?.vix) {
    $('pm-global-vix-pill').textContent = `VIX: ${data.vix.price}`;
    $('pm-global-vix-pill').className = `pm-vix-badge ${data.vix.price < 17 ? 'vix-normal' : 'vix-elevated'}`;
  }

  // Pillar 3 Catalyst
  const globCat = pillars?.global_macro?.catalyst;
  if (globCat && $('pm-global-lead-box') && $('pm-global-lead-link')) {
    $('pm-global-lead-box').hidden = false;
    $('pm-global-lead-link').textContent = globCat.title;
    $('pm-global-lead-link').href = globCat.url && globCat.url !== '#' ? safeUrl(globCat.url) : '#';
  } else if ($('pm-global-lead-box')) {
    $('pm-global-lead-box').hidden = true;
  }

  // Update Floor Pivots Title for Evening Session Setup
  const pvtTitle = document.querySelector('.pivots-title');
  if (pvtTitle) {
    pvtTitle.textContent = "TOMORROW'S CALCULATED FLOOR PIVOTS";
  }
}

// Pre-Market / Post-Market Trading Desk Brief Renderer
function renderPremarket(data) {
  if (!data || data.schema_version !== 2 || !$('premarket-brief')) {
    if ($('premarket-brief')) $('premarket-brief').hidden = true;
    return;
  }
  if (region === 'Events') {
    $('premarket-brief').hidden = true;
    return;
  }
  $('premarket-brief').hidden = false;

  const session = getISTSession();
  if ($('premarket-tag')) {
    $('premarket-tag').textContent = session.tag;
  }
  if ($('pm-col-label')) {
    $('pm-col-label').textContent = session.colLabel;
  }

  const bias = 'LATEST AVAILABLE QUOTE';
  const price = data.live_nifty_price || '--';
  const pts = data.live_pts;
  const pct = data.live_pct;
  const isUp = pts >= 0;

  if ($('premarket-bias-badge')) {
    $('premarket-bias-badge').textContent = bias;
    $('premarket-bias-badge').className = `premarket-bias-badge ${isUp ? 'up' : 'down'}`;
  }
  if ($('pm-gift-nifty')) {
    $('pm-gift-nifty').textContent = price;
  }
  if ($('pm-gift-chg')) {
    const sign = isUp ? '+' : '';
    $('pm-gift-chg').textContent = pts == null ? 'Unavailable' : `${sign}${pts} pts (${sign}${pct}%)`;
    $('pm-gift-chg').className = `pm-chg ${isUp ? 'up' : 'down'}`;
  }
  if ($('pm-collapsed-price')) {
    $('pm-collapsed-price').textContent = price;
  }
  if ($('pm-collapsed-chg')) {
    const sign = isUp ? '+' : '';
    $('pm-collapsed-chg').textContent = pts == null ? '' : `${sign}${pts} pts (${sign}${pct}%)`;
    $('pm-collapsed-chg').className = `pm-collapsed-chg ${isUp ? 'up' : 'down'}`;
  }

  initSessionMonitorState();

  if ($('pm-gift-sub')) {
    $('pm-gift-sub').textContent = `Quote session: ${data.quote_date || 'date unavailable'} · ${data.quote_source || 'source unavailable'} · Previous close ${data.nifty_prev_close || '--'} · Fetched ${data.quote_updated ? new Date(data.quote_updated).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'time unavailable'}`;
  }

  const isPostMarket = (session.id === 'postmarket' || session.id === 'overnight');
  if ($('premarket-cols')) $('premarket-cols').hidden = isPostMarket;
  if ($('postmarket-cols')) $('postmarket-cols').hidden = !isPostMarket;

  if (isPostMarket) {
    renderPostMarketPillars(data);
  }

  // Institutional flows
  if (data.fii_dii) {
    const fii = data.fii_dii.fii_net_cr ?? -2845.6;
    const dii = data.fii_dii.dii_net_cr ?? 2135.4;
    const fiiSign = fii >= 0 ? '+' : '-';
    const diiSign = dii >= 0 ? '+' : '-';
    if ($('pm-fii-val')) {
      $('pm-fii-val').textContent = `${fiiSign}₹${Math.abs(Math.round(fii)).toLocaleString('en-IN')} Cr`;
      $('pm-fii-val').className = `flow-val ${fii >= 0 ? 'up' : 'down'}`;
    }
    if ($('pm-dii-val')) {
      $('pm-dii-val').textContent = `${diiSign}₹${Math.abs(Math.round(dii)).toLocaleString('en-IN')} Cr`;
      $('pm-dii-val').className = `flow-val ${dii >= 0 ? 'up' : 'down'}`;
    }
    const net = data.fii_dii.net_cr ?? (fii + dii);
    const netSign = net >= 0 ? '+' : '-';
    if ($('pm-net-val')) {
      $('pm-net-val').textContent = `${netSign}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')} Cr`;
      $('pm-net-val').className = `flow-val ${net >= 0 ? 'up' : 'down'}`;
    }
    if ($('pm-flows-sub')) {
      const trend = `${data.fii_dii.date || 'Previous session'} · ${net >= 0 ? 'Net institutional buying' : 'Net institutional absorption'}`;
      $('pm-flows-sub').textContent = `${trend} (${netSign}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')} Cr)`;
    }
  } else {
    if ($('pm-fii-val')) $('pm-fii-val').textContent = '--';
    if ($('pm-dii-val')) $('pm-dii-val').textContent = '--';
    if ($('pm-net-val')) $('pm-net-val').textContent = '--';
    if ($('pm-flows-sub')) $('pm-flows-sub').textContent = 'Unavailable · dated, verified source required';
  }

  // India VIX Volatility Gauge
  if (data.vix && $('pm-vix-badge')) {
    const vx = data.vix;
    const vPrice = parseFloat(vx.price) || 0;
    let cls = 'vix-normal';
    if (vPrice < 13) cls = 'vix-calm';
    else if (vPrice < 17) cls = 'vix-normal';
    else if (vPrice < 22) cls = 'vix-elevated';
    else cls = 'vix-fear';

    $('pm-vix-badge').textContent = `VIX ${vx.price} (${vx.change_pct})`;
    $('pm-vix-badge').className = `pm-vix-badge ${cls}`;
    $('pm-vix-badge').title = `India VIX: ${vx.price} (${vx.change_pct}) · Regime: ${vx.regime || 'Observed'}`;
  } else if ($('pm-vix-badge')) {
    $('pm-vix-badge').textContent = 'VIX: --';
    $('pm-vix-badge').className = 'pm-vix-badge';
  }

  // Overnight macro cues
  if (data.overnight) {
    const sp = data.overnight.SP500;
    const nq = data.overnight.NASDAQ;
    const us10 = data.overnight.US10Y;
    if (sp && $('pm-sp-val')) {
      $('pm-sp-val').textContent = `${sp.date || "date unavailable"} · ${sp.val} (${sp.pct >= 0 ? '+' : ''}${sp.pct}%)`;
      $('pm-sp-val').className = `cue-v ${sp.pct >= 0 ? 'up' : 'down'}`;
    }
    if (nq && $('pm-nasdaq-val')) {
      $('pm-nasdaq-val').textContent = `${nq.date || "date unavailable"} · ${nq.val} (${nq.pct >= 0 ? '+' : ''}${nq.pct}%)`;
      $('pm-nasdaq-val').className = `cue-v ${nq.pct >= 0 ? 'up' : 'down'}`;
    }
    if (us10 && $('pm-us10y-val')) {
      $('pm-us10y-val').textContent = `${us10.date || "date unavailable"} · ${us10.val}`;
    }
  }
  if (data.brent && $('pm-brent-val')) {
    const isUp = data.brent.direction === 'up';
    const sign = isUp ? '+' : '';
    $('pm-brent-val').textContent = `${data.brent.price} (${sign}${data.brent.change_pct}%)`;
    $('pm-brent-val').className = `cue-v ${isUp ? 'up' : 'down'}`;
  }

  for (const id of ['pm-sp-val', 'pm-nasdaq-val', 'pm-us10y-val']) {
    const key = { 'pm-sp-val': 'SP500', 'pm-nasdaq-val': 'NASDAQ', 'pm-us10y-val': 'US10Y' }[id];
    if (!data.overnight?.[key] && $(id)) $(id).textContent = 'Unavailable';
  }
  for (const prefix of ['pm-nifty', 'pm-bn']) for (const key of ['s2', 's1', 'pivot', 'r1', 'r2']) {
    if ($(`${prefix}-${key}`)) $(`${prefix}-${key}`).textContent = '--';
  }
  const pivotNote = document.querySelector('.pivots-sub');
  if (pivotNote) pivotNote.textContent = `Calculated from completed sessions · Nifty ${data.pivots?.nifty?.date || 'unavailable'} · Bank Nifty ${data.pivots?.banknifty?.date || 'unavailable'}`;

  if (!data.brent && $('pm-brent-val')) $('pm-brent-val').textContent = 'Unavailable';

  // Floor Pivots Sentinel
  if (data.pivots) {
    if (data.pivots.nifty) {
      const np = data.pivots.nifty;
      if ($('pm-nifty-s2')) $('pm-nifty-s2').textContent = (np.s2 || '--').toLocaleString('en-IN');
      if ($('pm-nifty-s1')) $('pm-nifty-s1').textContent = (np.s1 || '--').toLocaleString('en-IN');
      if ($('pm-nifty-pivot')) $('pm-nifty-pivot').textContent = (np.pivot || '--').toLocaleString('en-IN');
      if ($('pm-nifty-r1')) $('pm-nifty-r1').textContent = (np.r1 || '--').toLocaleString('en-IN');
      if ($('pm-nifty-r2')) $('pm-nifty-r2').textContent = (np.r2 || '--').toLocaleString('en-IN');
    }
    if (data.pivots.banknifty) {
      const bp = data.pivots.banknifty;
      if ($('pm-bn-s2')) $('pm-bn-s2').textContent = (bp.s2 || '--').toLocaleString('en-IN');
      if ($('pm-bn-s1')) $('pm-bn-s1').textContent = (bp.s1 || '--').toLocaleString('en-IN');
      if ($('pm-bn-pivot')) $('pm-bn-pivot').textContent = (bp.pivot || '--').toLocaleString('en-IN');
      if ($('pm-bn-r1')) $('pm-bn-r1').textContent = (bp.r1 || '--').toLocaleString('en-IN');
      if ($('pm-bn-r2')) $('pm-bn-r2').textContent = (bp.r2 || '--').toLocaleString('en-IN');
    }
  }

  // 52-Week Range Ruler in Indicated Open (Tipsheet-Inspired)
  const range52 = data.posture ? {
    low_fmt: data.posture.low52_fmt,
    high_fmt: data.posture.high52_fmt,
    pos_pct: data.posture.pos_52w,
    pct_from_high: data.posture.pct_from_high52
  } : null;

  if (range52 && $('pm-nifty-ruler')) {
    $('pm-nifty-ruler').hidden = false;
    if ($('pm-ruler-min')) $('pm-ruler-min').textContent = `52W L: ${range52.low_fmt}`;
    if ($('pm-ruler-max')) $('pm-ruler-max').textContent = `52W H: ${range52.high_fmt}`;
    if ($('pm-ruler-pos')) {
      const ddSign = (range52.pct_from_high || 0) >= 0 ? '+' : '';
      $('pm-ruler-pos').textContent = `${range52.pos_pct}% of band (${ddSign}${range52.pct_from_high}% from peak)`;
    }
    if ($('pm-ruler-dot')) {
      $('pm-ruler-dot').style.left = `${range52.pos_pct}%`;
    }
  } else if ($('pm-nifty-ruler')) {
    $('pm-nifty-ruler').hidden = true;
  }

  // Inline 50/200 DMA indicator in Col 1 & Regime on Pivots Strip
  if (data.posture) {
    const p = data.posture;
    if ($('pm-dma-row')) $('pm-dma-row').hidden = false;
    if ($('pm-dma50-val')) $('pm-dma50-val').textContent = p.dma50_fmt || '--';
    if ($('pm-dma50-chg')) {
      const sign = (p.pct_dma50 || 0) >= 0 ? '+' : '';
      $('pm-dma50-chg').textContent = p.pct_dma50 != null ? `(${sign}${p.pct_dma50}%)` : '';
      $('pm-dma50-chg').className = `dma-pct ${(p.pct_dma50 || 0) >= 0 ? 'up' : 'down'}`;
    }
    if ($('pm-dma200-val')) $('pm-dma200-val').textContent = p.dma200_fmt || '--';
    if ($('pm-dma200-chg')) {
      const sign = (p.pct_dma200 || 0) >= 0 ? '+' : '';
      $('pm-dma200-chg').textContent = p.pct_dma200 != null ? `(${sign}${p.pct_dma200}%)` : '';
      $('pm-dma200-chg').className = `dma-pct ${(p.pct_dma200 || 0) >= 0 ? 'up' : 'down'}`;
    }
    if ($('pm-regime-badge')) {
      $('pm-regime-badge').textContent = p.regime || 'OBSERVED';
      const isBull = p.regime?.includes('UPTREND');
      $('pm-regime-badge').className = `breadth-badge ${isBull ? 'up' : 'down'}`;
    }
  } else {
    if ($('pm-dma-row')) $('pm-dma-row').hidden = true;
    if ($('pm-regime-badge')) $('pm-regime-badge').hidden = true;
  }

  // Inline Sector Breadth in Col 2
  if (data.sector_breadth) {
    const sb = data.sector_breadth;
    if ($('pm-sector-ratio')) $('pm-sector-ratio').textContent = `${sb.advances}/${sb.total} Green`;
    if ($('pm-sector-chips') && sb.sectors) {
      $('pm-sector-chips').innerHTML = sb.sectors.map(s => {
        const isUp = s.pct >= 0;
        const sign = isUp ? '+' : '';
        return `<span class="sector-chip ${isUp ? 'up' : 'down'}" title="${esc(s.name)}: ${sign}${s.pct}%">
          <span class="chip-name">${esc(s.name)}</span>
          <span class="chip-pct">${sign}${s.pct}%</span>
        </span>`;
      }).join('');
    }
  }

  // Desk Takeaway
  if (data.trader_take && $('pm-takeaway-text')) {
    let cleanTake = data.trader_take
      .replace(/Pivots are calculated references, not confirmed support or resistance\.\s*/gi, '')
      .replace(/Latest available Nifty quote:\s*[\d,.]+\s*\([^)]*\)\.\s*/gi, '')
      .trim();
    $('pm-takeaway-text').textContent = cleanTake || data.trader_take;
  }
}

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

// Client-side story deduplication & multi-source clustering safeguard
function extractStorySubject(title) {
  const t = String(title || '').trim();
  const tLow = t.toLowerCase();

  const known = [
    'senco gold', 'fino payments', 'pc jeweller', 'tcs', 'infosys', 'hcl tech', 'tech mahindra',
    'wipro', 'hdfc bank', 'icici bank', 'sbi', 'axis bank', 'kotak bank', 'adani', 'reliance',
    'tata motors', 'maruti', 'l&t', 'vedanta', 'tsmc', 'samsung', 'nvidia', 'apple', 'tesla',
    'microsoft', 'google', 'meta', 'amazon', 'zoho', 'swiggy', 'zomato', 'paytm', 'liquidia',
    'everpure', 'accenture', 'ifci', 'gm breweries'
  ];
  for (const k of known) {
    if (new RegExp(`\\b${k}\\b`, 'i').test(tLow)) return k;
  }

  // Ticker pattern e.g. Liquidia (NASDAQ:LQDA)
  const m1 = t.match(/\b([A-Z][a-zA-Z0-9\.\s&'\-]+?)\s*\((?:NASDAQ|NYSE|BSE|NSE|OTCMKTS|LON|TSE):\s*([A-Za-z0-9\.\-]+)\)/i);
  if (m1) {
    const clean = m1[1].toLowerCase().replace(/\b(corp|corporation|inc|incorporated|ltd|limited|co)\b/g, '').trim();
    if (clean.length >= 3) return clean;
  }

  // Executive insider pattern e.g. Liquidia CCO Scott Moomaw sells...
  const m2 = t.match(/^([A-Z][a-zA-Z0-9&'\-]+(?:\s+[A-Z][a-zA-Z0-9&'\-]+){0,2})\s+(?:cmo|cco|clo|ceo|cfo|coo|cto|cro|chief\s+[a-z]+\s+officer|director|general\s+counsel|president|chairman|corp|inc|ltd)\b/i);
  if (m2) {
    const clean = m2[1].toLowerCase().replace(/\b(corp|corporation|inc|incorporated|ltd|limited|co)\b/g, '').trim();
    if (clean.length >= 3 && !['the', 'why', 'what', 'how', 'when', 'today', 'live'].includes(clean)) return clean;
  }

  // Corporate designation e.g. Liquidia Corp general counsel...
  const m3 = t.match(/\b([A-Z][a-zA-Z0-9&'\-]+(?:\s+[A-Z][a-zA-Z0-9&'\-]+){0,2})\s+(?:Corp|Corporation|Inc|Incorporated|Ltd|Limited|Holdings|Technologies|Therapeutics|Pharma|Enterprises|Industries)\b/);
  if (m3) {
    const clean = m3[1].toLowerCase();
    if (clean.length >= 3 && !['the', 'why', 'what', 'how', 'when'].includes(clean)) return clean;
  }

  // Possessive entity e.g. Zoho’s pay freeze
  const m4 = t.match(/^([A-Z][a-zA-Z0-9&'\-]+(?:\s+[A-Z][a-zA-Z0-9&'\-]+){0,1})['’]s\b/);
  if (m4) {
    const clean = m4[1].toLowerCase();
    if (clean.length >= 3 && !['the', 'today', 'india', 'world', 'here'].includes(clean)) return clean;
  }

  return null;
}

function getStoryEventType(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(sells?|sold|disposes?|disposition|buys?|bought|purchased?|acquires?|offloads?)\b.*?\b(stock|shares?|stake|equity)\b|\b(?:cmo|cco|clo|ceo|cfo|coo|director|officer|general counsel)\b.*?\b(sells?|sold|disposes?|disposition|buys?|bought)\b/.test(t)) {
    return 'insider_trade';
  }
  if (/\b(q[1-4]|quarterly|earnings|net profit|revenue|pat|ebitda|financial results?)\b/.test(t)) {
    return 'earnings';
  }
  if (/\b(sc\b|supreme court|high court|sebi|ed\b|cbi|probe|investigation|penalty|fine|directs|orders|litigation|lawsuit)/.test(t)) {
    return 'legal_regulatory';
  }
  if (/\b(secures|bags|wins?|order|contract|pact|deal|mou|acquisition|merger|partners?)\b/.test(t)) {
    return 'deal_contract';
  }
  return null;
}

function deduplicateStories(stories) {
  if (!Array.isArray(stories) || stories.length === 0) return stories;
  const clusters = [];

  for (const story of stories) {
    const sTitle = story.title || '';
    const sSubj = extractStorySubject(sTitle);
    const sEvt = getStoryEventType(sTitle);

    let matched = null;
    for (const c of clusters) {
      const cTitle = c.title || '';
      const cSubj = extractStorySubject(cTitle);
      const cEvt = getStoryEventType(cTitle);

      // Same named company + same action archetype (e.g. routine insider sales)
      if (sSubj && cSubj && sSubj === cSubj) {
        if (sEvt && cEvt && sEvt === cEvt) {
          matched = c;
          break;
        }
        if ((sEvt === 'insider_trade' || cEvt === 'insider_trade') && /\b(sells?|buys?|shares?|stock|stake|dispos\w*)\b/i.test(sTitle + ' ' + cTitle)) {
          matched = c;
          break;
        }
      }

      // High token similarity overlap
      const wordsA = new Set(sTitle.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
      const wordsB = new Set(cTitle.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
      let inter = 0;
      wordsA.forEach(w => { if (wordsB.has(w)) inter++; });
      const union = new Set([...wordsA, ...wordsB]).size;
      const jaccard = union > 0 ? inter / union : 0;
      if (jaccard >= 0.40) {
        matched = c;
        break;
      }
    }

    if (matched) {
      // Merge sources without duplicating names
      const existingSources = new Set((matched.sources || []).map(src => src.name));
      (story.sources || []).forEach(src => {
        if (!existingSources.has(src.name)) {
          matched.sources = matched.sources || [];
          matched.sources.push(src);
          existingSources.add(src.name);
        }
      });
      // Attach related angle if not already present
      matched.related = matched.related || [];
      if (story.title !== matched.title && !matched.related.some(r => r.title === story.title)) {
        matched.related.push({
          title: story.title,
          url: story.url || (story.sources?.[0]?.url) || '#',
          source: story.sources?.[0]?.name || ''
        });
      }
    } else {
      clusters.push(Object.assign({}, story));
    }
  }

  return clusters;
}

// Load feeds from server or static data
async function load() {
  try {
    const results = await Promise.all([
      safeFetch('/api/briefing', '/data/briefing.json'),
      safeFetch('/api/events', '/data/events.json')
    ]);
    if (results.some(r => !r.ok)) throw new Error('Fetch failed');
    briefing = await results[0].json();
    events = await results[1].json();
    if (briefing && briefing.stories) {
      briefing.stories = deduplicateStories(briefing.stories);
    }
    if (briefing.premarket) {
      premarketData = briefing.premarket;
      renderPremarket(premarketData);
    }
    render();
    updateShortsFilterCounts();
    if (isShortsOpen && !shortsList.length) {
      const freshList = getLatestSortedStories({ unreadOnly: shortsFilterUnreadOnly, region: shortsRegion });
      if (freshList.length > 0) {
        openShorts(0);
      }
    }
  } catch (error) {
    $('notice').hidden = false;
    $('notice').textContent = `Cannot load briefing · ${error?.message || 'check server'}`;
  }
}

// Market ticker loader & renderer
function renderMarketTicker(data) {
  const container = $('ticker-inner');
  if (!container) return;
  const tickers = data?.tickers || [];
  if (!tickers.length) {
    container.innerHTML = '<span class="ticker-loading">Market quotes unavailable</span>';
    return;
  }
  container.innerHTML = tickers.map((t, idx) => {
    const isUp = t.direction === 'up';
    const sign = isUp ? '+' : '';
    const arrow = isUp ? '▲' : '▼';
    const cls = isUp ? 'up' : 'down';
    const divider = idx > 0 ? '<div class="ticker-divider" aria-hidden="true"></div>' : '';
    const r = t.range_52w;
    const rulerHtml = r ? `
      <span class="ticker-ruler-wrap" title="52W Range: ${esc(r.low_fmt)} — ${esc(r.high_fmt)} (${r.pos_pct}% of band · ${r.pct_from_high >= 0 ? '+' : ''}${r.pct_from_high}% from peak)">
        <span class="ticker-ruler-track">
          <span class="ticker-ruler-band"></span>
          <span class="ticker-ruler-dot" style="left: ${r.pos_pct}%;"></span>
        </span>
      </span>` : '';
    return `${divider}
      <div class="ticker-item" title="${r ? `52W Range: ${r.low_fmt} to ${r.high_fmt} (${r.pos_pct}% of band)` : ''}">
        <span class="ticker-name">${esc(t.label)}</span>
        <span class="ticker-val">${esc(t.price)}</span>
        <span class="ticker-pct ${cls}">${arrow} ${sign}${t.change_pct}%</span>
        ${rulerHtml}
      </div>`;
  }).join('');
}

async function loadMarket() {
  try {
    const res = await safeFetch('/api/market', '/data/market.json');
    if (!res.ok) throw new Error('Market fetch failed');
    const data = await res.json();
    renderMarketTicker(data);
  } catch (err) {
    const container = $('ticker-inner');
    if (container && !container.querySelector('.ticker-item')) {
      container.innerHTML = '<span class="ticker-loading">Market quotes temporarily unavailable</span>';
    }
  }
}

// Carousel Controls
$('hero-prev').addEventListener('click', () => {
  prevHeroSlide();
  stopHeroAutoPlay();
});
$('hero-next').addEventListener('click', () => {
  nextHeroSlide();
  stopHeroAutoPlay();
});
$('hero-carousel').addEventListener('mouseenter', stopHeroAutoPlay);
$('hero-carousel').addEventListener('mouseleave', startHeroAutoPlay);

document.addEventListener('click', e => {
  const dot = e.target.closest('.hero-dot-indicator');
  if (dot) {
    heroIndex = Number(dot.dataset.index);
    updateHeroSlide();
    stopHeroAutoPlay();
    return;
  }
  const relBtn = e.target.closest('.related-toggle-btn');
  if (relBtn) {
    const id = relBtn.dataset.toggle;
    const tray = $(`tray-${id}`);
    if (tray) {
      const isHidden = tray.hidden;
      tray.hidden = !isHidden;
      relBtn.setAttribute('aria-expanded', String(isHidden));
    }
    return;
  }
  const catBtn = e.target.closest('.cat-filter-btn');
  if (catBtn) {
    activeCatalystFilter = catBtn.dataset.filter;
    document.querySelectorAll('.cat-filter-btn').forEach(b => {
      b.classList.toggle('active', b === catBtn);
    });
    renderCatalysts();
    return;
  }
});

// Market Movers Filter Button
if ($('movers-filter-btn')) {
  $('movers-filter-btn').addEventListener('click', () => {
    activeMarketMoversOnly = !activeMarketMoversOnly;
    $('movers-filter-btn').classList.toggle('active', activeMarketMoversOnly);
    $('movers-filter-btn').setAttribute('aria-pressed', String(activeMarketMoversOnly));
    render();
  });
}

// Latest First Sort Toggle Button
if ($('latest-sort-btn')) {
  $('latest-sort-btn').classList.toggle('active', activeLatestFirst);
  $('latest-sort-btn').setAttribute('aria-pressed', String(activeLatestFirst));
  $('latest-sort-btn').addEventListener('click', () => {
    activeLatestFirst = !activeLatestFirst;
    save('newsland.sort_latest', activeLatestFirst);
    $('latest-sort-btn').classList.toggle('active', activeLatestFirst);
    $('latest-sort-btn').setAttribute('aria-pressed', String(activeLatestFirst));
    render();
  });
}

// Pre-Market Brief Collapse/Expand
if ($('premarket-toggle')) {
  $('premarket-toggle').addEventListener('click', () => {
    const body = $('premarket-body');
    if (!body) return;
    const isNowCollapsed = !body.hidden;
    setSessionMonitorCollapsed(isNowCollapsed);
    save('newsland.brief_collapsed', isNowCollapsed);
  });
}

// Sector Pills Clicks
document.querySelectorAll('.sector-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const sector = btn.dataset.sector;
    activeSector = (activeSector === sector && sector !== 'all') ? 'all' : sector;
    document.querySelectorAll('.sector-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.sector === activeSector);
    });
    render();
  });
});

// ============================================================================
// Share Modal & Pre-Market Visual Card Engine
// ============================================================================

function drawShareCard(canvas, pm, stories) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 1200;
  const H = 1200;
  canvas.width = W;
  canvas.height = H;

  // Background Gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#090D16');
  bgGrad.addColorStop(0.5, '#0E1726');
  bgGrad.addColorStop(1, '#070A10');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle ambient glow
  const r1 = ctx.createRadialGradient(1050, 150, 0, 1050, 150, 420);
  r1.addColorStop(0, 'rgba(16, 185, 129, 0.08)');
  r1.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.fillStyle = r1;
  ctx.fillRect(600, 0, 600, 600);

  const r2 = ctx.createRadialGradient(150, 650, 0, 150, 650, 450);
  r2.addColorStop(0, 'rgba(56, 189, 248, 0.05)');
  r2.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = r2;
  ctx.fillRect(0, 350, 600, 700);

  // Card Outer Inset Border
  drawRoundRect(ctx, 28, 28, W - 56, H - 56, 20, null, 'rgba(255, 255, 255, 0.08)', 1.5);

  // Helper: Rounded Rectangle
  function drawRoundRect(c, x, y, w, h, r, fill, stroke, lw) {
    c.save();
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    c.restore();
  }

  // Helper: Wrap Text
  function wrapText(c, text, x, y, maxW, lineH, maxLines) {
    const words = (text || '').split(' ');
    let line = '';
    let curY = y;
    let linesDrawn = 0;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = c.measureText(testLine);
      if (metrics.width > maxW && n > 0) {
        linesDrawn++;
        if (maxLines && linesDrawn >= maxLines) {
          c.fillText(line.trim() + '...', x, curY);
          return curY;
        }
        c.fillText(line.trim(), x, curY);
        line = words[n] + ' ';
        curY += lineH;
      } else {
        line = testLine;
      }
    }
    c.fillText(line.trim(), x, curY);
    return curY;
  }

  // Header: Brand & Meta
  ctx.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.fillText('NEWSLAND.', 64, 88);

  const session = typeof getISTSession === 'function' ? getISTSession() : { tag: 'PRE-MARKET' };
  const sessionTag = (session.tag || 'PRE-MARKET').toUpperCase();
  drawRoundRect(ctx, 290, 60, 200, 36, 18, 'rgba(16, 185, 129, 0.14)', 'rgba(16, 185, 129, 0.45)', 1);
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#34D399';
  ctx.textAlign = 'center';
  ctx.fillText(`●  ${sessionTag} BRIEF`, 390, 83);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { ...ist, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.textAlign = 'right';
  ctx.fillText(`${dateStr} · IST`, W - 64, 83);

  // Top Divider
  ctx.beginPath();
  ctx.moveTo(64, 116);
  ctx.lineTo(W - 64, 116);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Section 1: Benchmark Hero Box (Y: 136, H: 144)
  drawRoundRect(ctx, 64, 136, W - 128, 144, 14, 'rgba(255, 255, 255, 0.025)', 'rgba(255, 255, 255, 0.08)', 1);

  ctx.textAlign = 'left';
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('INDICATIVE BENCHMARK · NIFTY 50', 92, 168);

  const price = pm?.live_nifty_price || '--';
  const pts = pm?.live_pts ?? 0;
  const pct = pm?.live_pct ?? 0;
  const isUp = Number(pts) >= 0;
  const ptsSign = isUp ? '+' : '';
  const pctSign = isUp ? '+' : '';

  ctx.font = '800 52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(price), 92, 230);

  // Change Pill
  const pillW = 210;
  const pillH = 40;
  const pillX = 330;
  const pillY = 194;
  const pillBg = isUp ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';
  const pillBorder = isUp ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
  const pillColor = isUp ? '#34D399' : '#F87171';
  drawRoundRect(ctx, pillX, pillY, pillW, pillH, 8, pillBg, pillBorder, 1);
  ctx.font = '800 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = pillColor;
  ctx.textAlign = 'center';
  ctx.fillText(`${ptsSign}${pts} pts (${pctSign}${pct}%)`, pillX + (pillW / 2), pillY + 26);

  // Right column of Hero Box: Posture & Breadth
  ctx.textAlign = 'right';
  if (pm?.posture?.regime) {
    drawRoundRect(ctx, W - 310, 154, 218, 28, 6, 'rgba(245, 158, 11, 0.12)', 'rgba(245, 158, 11, 0.4)', 1);
    ctx.font = '750 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'center';
    ctx.fillText(pm.posture.regime, W - 310 + 109, 172);
  }

  ctx.textAlign = 'right';
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#94A3B8';
  if (pm?.posture?.pct_from_high52) {
    ctx.fillText(`${pm.posture.pct_from_high52}% vs 52W High · 50-DMA: ${pm.posture.dma50_fmt || '--'}`, W - 92, 212);
  }
  const breadthSummary = pm?.sector_breadth?.summary || 'Sector breadth tracking live';
  ctx.font = '500 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`Breadth: ${breadthSummary}`, W - 92, 238);

  // Section 2: Three Mini Cards (Y: 298, H: 136)
  const colW = (W - 128 - 36) / 3; // 338px
  const colY = 298;
  const colH = 136;

  // Mini Card 1: India VIX
  drawRoundRect(ctx, 64, colY, colW, colH, 12, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.06)', 1);
  ctx.textAlign = 'left';
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('INDIA VIX VOLATILITY GAUGE', 86, colY + 30);
  ctx.font = '800 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(pm?.vix?.price || '14.6', 86, colY + 76);
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#38BDF8';
  ctx.fillText(`${pm?.vix?.regime || 'Normal Volatility'} (${pm?.vix?.change_pct || '--'})`, 86, colY + 106);

  // Mini Card 2: FII / DII Institutional Flows
  const col2X = 64 + colW + 18;
  drawRoundRect(ctx, col2X, colY, colW, colH, 12, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.06)', 1);
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('INSTITUTIONAL FLOWS (CR)', col2X + 22, colY + 30);
  const netCr = pm?.fii_dii?.net_cr ?? 0;
  const netUp = netCr >= 0;
  ctx.font = '800 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = netUp ? '#34D399' : '#F87171';
  ctx.fillText(`Net ${netUp ? '+' : '-'}₹${Math.abs(Math.round(netCr)).toLocaleString('en-IN')} Cr`, col2X + 22, colY + 68);
  ctx.font = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#CBD5E1';
  const fiiVal = Math.round(pm?.fii_dii?.fii_net_cr ?? 0);
  const diiVal = Math.round(pm?.fii_dii?.dii_net_cr ?? 0);
  ctx.fillText(`FII: ${fiiVal >= 0 ? '+' : '-'}₹${Math.abs(fiiVal).toLocaleString('en-IN')}  ·  DII: ${diiVal >= 0 ? '+' : '-'}₹${Math.abs(diiVal).toLocaleString('en-IN')}`, col2X + 22, colY + 104);

  // Mini Card 3: Macro & Commodities
  const col3X = col2X + colW + 18;
  drawRoundRect(ctx, col3X, colY, colW, colH, 12, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.06)', 1);
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('OVERNIGHT MACRO & CRUDE', col3X + 22, colY + 30);
  const spVal = pm?.overnight?.SP500?.val || '--';
  const spPct = pm?.overnight?.SP500?.pct ?? 0;
  ctx.font = '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#F1F5F9';
  ctx.fillText(`S&P 500: ${spVal} (${spPct >= 0 ? '+' : ''}${spPct}%)`, col3X + 22, colY + 62);
  const brentVal = pm?.brent?.price || '--';
  const brentPct = pm?.brent?.change_pct ?? 0;
  ctx.fillText(`Brent Crude: $${brentVal} (${brentPct >= 0 ? '+' : ''}${brentPct}%)`, col3X + 22, colY + 86);
  ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(`USD/INR: ₹${pm?.usdinr?.price || '--'}`, col3X + 22, colY + 110);

  // Section 3: Key Technical Floor Pivots (Y: 450, H: 86)
  drawRoundRect(ctx, 64, 450, W - 128, 86, 12, 'rgba(15, 23, 42, 0.65)', 'rgba(255, 255, 255, 0.06)', 1);
  ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('KEY TECHNICAL LEVELS (FLOOR PIVOTS)', 86, 474);

  const np = pm?.pivots?.nifty || { s1: '--', pivot: '--', r1: '--' };
  const bp = pm?.pivots?.banknifty || { s1: '--', pivot: '--', r1: '--' };

  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText(`NIFTY 50:    S1  ${np.s1}   ·   [ PIVOT  ${np.pivot} ]   ·   R1  ${np.r1}`, 86, 502);
  ctx.fillText(`BANK NIFTY:  S1  ${bp.s1}   ·   [ PIVOT  ${bp.pivot} ]   ·   R1  ${bp.r1}`, 86, 523);

  // Section 4: Top 3 Market Catalysts (Y: 554)
  ctx.font = '800 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#38BDF8';
  ctx.fillText('TOP MARKET-MOVING CATALYSTS FOR TODAY', 66, 570);

  const topStories = (stories || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);

  const catYStart = 586;
  const catH = 138;
  const catGap = 16;

  topStories.forEach((s, idx) => {
    const curY = catYStart + idx * (catH + catGap);
    drawRoundRect(ctx, 64, curY, W - 128, catH, 12, 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.06)', 1);

    // Number Badge (01, 02, 03)
    const numBadgeX = 86;
    const numBadgeY = curY + 22;
    drawRoundRect(ctx, numBadgeX, numBadgeY, 36, 36, 8, 'rgba(56, 189, 248, 0.12)', 'rgba(56, 189, 248, 0.35)', 1);
    ctx.font = '800 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'center';
    ctx.fillText(`0${idx + 1}`, numBadgeX + 18, numBadgeY + 24);

    // Category Eyebrow & Source Tag
    ctx.textAlign = 'left';
    ctx.font = '750 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#94A3B8';
    const cat = (s.category || 'MARKET PULSE').toUpperCase();
    const sourceCount = (s.clusterSources && s.clusterSources.length) ? `${s.clusterSources.length} SOURCES` : (s.source || 'WIRE');
    ctx.fillText(`${cat}  ·  ● ${sourceCount}`, 136, curY + 36);

    // Headline (Wrapped, Max 2 lines)
    ctx.font = '600 21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    const cleanHeadline = (s.title || '').replace(/[\(\)\[\]"]/g, '').trim();
    wrapText(ctx, cleanHeadline, 136, curY + 68, W - 230, 28, 2);
  });

  // Section 5: Desk Takeaway & Footer Watermark (Y: 1060 to 1140)
  ctx.textAlign = 'left';
  if (pm?.trader_take) {
    ctx.font = 'italic 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#94A3B8';
    const cleanTake = `Desk Take: ${pm.trader_take}`;
    ctx.fillText(cleanTake.length > 130 ? cleanTake.slice(0, 127) + '...' : cleanTake, 64, 1076);
  }

  // Bottom Line Divider
  ctx.beginPath();
  ctx.moveTo(64, 1100);
  ctx.lineTo(W - 64, 1100);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Footer Branding
  ctx.font = '800 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('newsland.in', 64, 1136);

  ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('·  Institutional Signal. Zero Noise.', 166, 1136);

  ctx.textAlign = 'right';
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('Curated for Serious Traders & Investors', W - 64, 1136);
}

function generateShareTextMemo(pm, stories) {
  const session = typeof getISTSession === 'function' ? getISTSession() : { tag: 'PRE-MARKET' };
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { ...ist, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { ...ist, hour: '2-digit', minute: '2-digit', hour12: true });

  const price = pm?.live_nifty_price || '--';
  const pts = pm?.live_pts ?? '--';
  const pct = pm?.live_pct ?? '--';
  const ptsSign = Number(pts) >= 0 ? '+' : '';
  const pctSign = Number(pct) >= 0 ? '+' : '';

  let lines = [];
  lines.push(`📊 *NEWSLAND ${session.tag.toUpperCase()}*`);
  lines.push(`🗓️ ${dateStr} · ${timeStr} IST\n`);

  lines.push(`📌 *NIFTY 50 BENCHMARK:*`);
  lines.push(`• Latest Quote: ${price} (${ptsSign}${pts} pts, ${pctSign}${pct}%)`);
  if (pm?.posture) {
    const p = pm.posture;
    lines.push(`• Regime: ${p.regime} (${p.pct_from_high52}% from 52W High | 50-DMA: ${p.dma50_fmt})`);
  }
  lines.push('');

  if (pm?.fii_dii) {
    const f = pm.fii_dii;
    const fii = f.fii_net_cr ?? 0;
    const dii = f.dii_net_cr ?? 0;
    const net = f.net_cr ?? (fii + dii);
    lines.push(`🏛️ *INSTITUTIONAL FLOWS:*`);
    lines.push(`• FII: ${fii >= 0 ? '+' : '-'}₹${Math.abs(Math.round(fii)).toLocaleString('en-IN')} Cr | DII: ${dii >= 0 ? '+' : '-'}₹${Math.abs(Math.round(dii)).toLocaleString('en-IN')} Cr`);
    lines.push(`• Combined Net: ${net >= 0 ? '+' : '-'}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')} Cr (${f.trend || ''})`);
    lines.push('');
  }

  if (pm?.postmarket_pillars?.commodities) {
    const c = pm.postmarket_pillars.commodities;
    lines.push(`🛢️ *MCX & COMMODITIES (EVENING ACTIVE):*`);
    if (c.brent) lines.push(`• Brent Crude: $${c.brent.price} (${c.brent.change_pct >= 0 ? '+' : ''}${c.brent.change_pct}%)`);
    if (c.wti) lines.push(`• WTI Crude: $${c.wti.price} (${c.wti.change_pct >= 0 ? '+' : ''}${c.wti.change_pct}%)`);
    if (c.natgas) lines.push(`• Natural Gas: $${c.natgas.price} (${c.natgas.change_pct >= 0 ? '+' : ''}${c.natgas.change_pct}%)`);
    if (c.gold) lines.push(`• Gold: $${c.gold.price} (${c.gold.change_pct >= 0 ? '+' : ''}${c.gold.change_pct}%)`);
    if (c.silver) lines.push(`• Silver: $${c.silver.price} (${c.silver.change_pct >= 0 ? '+' : ''}${c.silver.change_pct}%)`);
    if (c.catalyst?.title) lines.push(`• Driver: ${c.catalyst.title}`);
    lines.push('');
  } else {
    lines.push(`🌐 *MACRO & COMMODITIES:*`);
    if (pm?.overnight?.SP500) {
      const sp = pm.overnight.SP500;
      lines.push(`• S&P 500: ${sp.val || '--'} (${sp.pct >= 0 ? '+' : ''}${sp.pct ?? 0}%)`);
    }
    if (pm?.brent) {
      const b = pm.brent;
      lines.push(`• Brent Crude: $${b.price || '--'} (${b.change_pct >= 0 ? '+' : ''}${b.change_pct ?? 0}%)`);
    }
    if (pm?.usdinr) {
      lines.push(`• USD/INR: ₹${pm.usdinr.price || '--'}`);
    }
    if (pm?.vix) {
      lines.push(`• India VIX: ${pm.vix.price} (${pm.vix.regime || 'Volatility'})`);
    }
    lines.push('');
  }

  if (pm?.postmarket_pillars?.earnings?.length) {
    lines.push(`📑 *AFTER-MARKET EARNINGS & FILINGS:*`);
    pm.postmarket_pillars.earnings.forEach((e, idx) => {
      lines.push(`${idx + 1}. ${e.title}`);
    });
    lines.push('');
  }

  if (pm?.pivots?.nifty) {
    const np = pm.pivots.nifty;
    const bp = pm.pivots.banknifty;
    lines.push(`🎯 *KEY FLOOR PIVOTS:*`);
    lines.push(`• NIFTY: S1 ${np.s1} | Pivot ${np.pivot} | R1 ${np.r1}`);
    if (bp) {
      lines.push(`• BANK NIFTY: S1 ${bp.s1} | Pivot ${bp.pivot} | R1 ${bp.r1}`);
    }
    lines.push('');
  }

  const topCats = (stories || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);

  if (topCats.length) {
    lines.push(`⚡ *TOP MARKET CATALYSTS:*`);
    topCats.forEach((s, idx) => {
      const cleanTitle = (s.title || '').replace(/[\(\)\[\]"]/g, '').trim();
      lines.push(`${idx + 1}. ${cleanTitle}`);
    });
    lines.push('');
  }

  if (pm?.trader_take) {
    lines.push(`💡 *DESK TAKE:*`);
    lines.push(`${pm.trader_take}\n`);
  }

  lines.push(`🔗 Sourced institutional signals with zero noise: https://newsland.in`);
  return lines.join('\n');
}

function openShareModal() {
  const modal = $('share-modal');
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  // Render Visual Card onto Canvas
  const canvas = $('share-canvas');
  if (canvas) {
    drawShareCard(canvas, premarketData, briefing?.stories || []);
  }

  // Populate Text Memo
  const textArea = $('share-text-area');
  if (textArea) {
    textArea.value = generateShareTextMemo(premarketData, briefing?.stories || []);
  }
}

function closeShareModal() {
  const modal = $('share-modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function initShareModal() {
  const triggerBtn = $('share-card-btn');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', openShareModal);
  }

  const closeBtn = $('close-share-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeShareModal);
  }

  const backdrop = $('share-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeShareModal);
  }

  // Escape key closes modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('share-modal');
      if (modal && !modal.hidden) closeShareModal();
    }
  });

  // Tab Switcher
  const tabVisual = $('tab-visual-card');
  const tabText = $('tab-text-memo');
  const paneVisual = $('pane-visual-card');
  const paneText = $('pane-text-memo');

  if (tabVisual && tabText && paneVisual && paneText) {
    tabVisual.addEventListener('click', () => {
      tabVisual.classList.add('active');
      tabText.classList.remove('active');
      paneVisual.hidden = false;
      paneText.hidden = true;
    });

    tabText.addEventListener('click', () => {
      tabText.classList.add('active');
      tabVisual.classList.remove('active');
      paneText.hidden = false;
      paneVisual.hidden = true;
    });
  }

  // Action: Copy Canvas Image to Clipboard
  const copyImgBtn = $('copy-image-btn');
  const imgStatus = $('image-copy-status');
  if (copyImgBtn) {
    copyImgBtn.addEventListener('click', async () => {
      const canvas = $('share-canvas');
      if (!canvas) return;

      const setStatus = (msg, isErr) => {
        if (!imgStatus) return;
        imgStatus.textContent = msg;
        imgStatus.style.color = isErr ? 'var(--red-ticker)' : 'var(--green-ticker)';
        imgStatus.hidden = false;
        setTimeout(() => { imgStatus.hidden = true; }, 3500);
      };

      try {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            setStatus('Failed to export image.', true);
            return;
          }
          if (navigator.clipboard && window.ClipboardItem) {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              setStatus('✓ Card image copied to clipboard! Paste directly into Slack or WhatsApp.');
              return;
            } catch (clipErr) {
              console.warn('ClipboardItem error, falling back to download:', clipErr);
            }
          }
          // Fallback to download if direct clipboard write fails
          triggerCanvasDownload(canvas);
          setStatus('✓ Image downloaded (direct clipboard paste not supported on this device).');
        }, 'image/png');
      } catch (err) {
        console.error('Error copying image:', err);
        triggerCanvasDownload(canvas);
        setStatus('✓ Image downloaded.');
      }
    });
  }

  // Action: Download Image PNG
  const downloadImgBtn = $('download-image-btn');
  if (downloadImgBtn) {
    downloadImgBtn.addEventListener('click', () => {
      const canvas = $('share-canvas');
      if (canvas) {
        triggerCanvasDownload(canvas);
        if (imgStatus) {
          imgStatus.textContent = '✓ High-res card downloaded as PNG.';
          imgStatus.style.color = 'var(--green-ticker)';
          imgStatus.hidden = false;
          setTimeout(() => { imgStatus.hidden = true; }, 3500);
        }
      }
    });
  }

  function triggerCanvasDownload(canvas) {
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `newsland-brief-${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // Action: Copy Text Memo
  const copyTextBtn = $('copy-text-btn');
  const textStatus = $('text-copy-status');
  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', async () => {
      const textArea = $('share-text-area');
      if (!textArea) return;
      try {
        await navigator.clipboard.writeText(textArea.value);
        if (textStatus) {
          textStatus.textContent = '✓ Memo text copied to clipboard!';
          textStatus.style.color = 'var(--green-ticker)';
          textStatus.hidden = false;
          setTimeout(() => { textStatus.hidden = true; }, 3000);
        }
      } catch (err) {
        textArea.select();
        document.execCommand('copy');
        if (textStatus) {
          textStatus.textContent = '✓ Memo text copied!';
          textStatus.hidden = false;
          setTimeout(() => { textStatus.hidden = true; }, 3000);
        }
      }
    });
  }

  // Action: Share on X (Twitter)
  const shareXBtn = $('share-x-btn');
  if (shareXBtn) {
    shareXBtn.addEventListener('click', () => {
      const dateStr = new Date().toLocaleDateString('en-IN', { ...ist, day: 'numeric', month: 'short' });
      const price = premarketData?.live_nifty_price || '--';
      const pts = premarketData?.live_pts ?? 0;
      const ptsSign = Number(pts) >= 0 ? '+' : '';
      const netCr = premarketData?.fii_dii?.net_cr ?? 0;
      const netSign = netCr >= 0 ? '+' : '-';
      const tweet = `📊 Newsland Pre-Market Brief (${dateStr}):\n• Nifty: ${price} (${ptsSign}${pts} pts)\n• FII/DII Net: ${netSign}₹${Math.abs(Math.round(netCr))} Cr\n• VIX: ${premarketData?.vix?.price || '--'}\n\nInstitutional signal. Zero noise 👇\n`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent('https://newsland.in')}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // Action: Share on WhatsApp
  const shareWaBtn = $('share-wa-btn');
  if (shareWaBtn) {
    shareWaBtn.addEventListener('click', () => {
      const memo = generateShareTextMemo(premarketData, briefing?.stories || []);
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(memo)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
}

// Section Tabs
document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => {
    region = b.dataset.region;
    document.querySelectorAll('.tab-btn').forEach(x => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    if (region === 'Events') {
      stopHeroAutoPlay();
      $('hero-carousel').hidden = true;
      if ($('premarket-brief')) $('premarket-brief').hidden = true;
    } else {
      startHeroAutoPlay();
      if ($('premarket-brief') && premarketData) $('premarket-brief').hidden = false;
    }
    render();
  });
});

// Trending Keyword Clicks
document.addEventListener('click', e => {
  const pill = e.target.closest('.trend-pill');
  if (!pill) return;
  const word = pill.dataset.word;
  activeTrendingWord = (activeTrendingWord.toLowerCase() === word.toLowerCase()) ? '' : word;
  render();
});

// ============================================================================
// Phase 3: Instant Ticker Quick-Search & Command Menu
// ============================================================================

let currentXRayData = null;

const KNOWN_COMPANIES = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', ticker: 'RELIANCE', sector: 'Oil & Conglomerate' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', ticker: 'TCS', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', ticker: 'HDFCBANK', sector: 'Private Banking' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank', ticker: 'ICICIBANK', sector: 'Private Banking' },
  { symbol: 'INFY.NS', name: 'Infosys', ticker: 'INFY', sector: 'IT Services' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', ticker: 'SBIN', sector: 'Public Banking' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel', ticker: 'BHARTIARTL', sector: 'Telecom' },
  { symbol: 'ITC.NS', name: 'ITC Limited', ticker: 'ITC', sector: 'FMCG' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro', ticker: 'LT', sector: 'Infrastructure' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors', ticker: 'TATAMOTORS', sector: 'Automobile' },
  { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance', ticker: 'BAJFINANCE', sector: 'NBFC / Lending' },
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki', ticker: 'MARUTI', sector: 'Automobile' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharma', ticker: 'SUNPHARMA', sector: 'Pharmaceuticals' },
  { symbol: 'TITAN.NS', name: 'Titan Company', ticker: 'TITAN', sector: 'Consumer & Jewellery' },
  { symbol: 'TATASTEEL.NS', name: 'Tata Steel', ticker: 'TATASTEEL', sector: 'Metals & Mining' },
  { symbol: 'JSWSTEEL.NS', name: 'JSW Steel', ticker: 'JSWSTEEL', sector: 'Metals & Mining' },
  { symbol: 'HINDALCO.NS', name: 'Hindalco Industries', ticker: 'HINDALCO', sector: 'Metals & Aluminium' },
  { symbol: 'VEDL.NS', name: 'Vedanta Limited', ticker: 'VEDL', sector: 'Natural Resources' },
  { symbol: 'ONGC.NS', name: 'Oil & Natural Gas Corp', ticker: 'ONGC', sector: 'Oil & Gas' },
  { symbol: 'BPCL.NS', name: 'Bharat Petroleum', ticker: 'BPCL', sector: 'Oil Marketing' },
  { symbol: 'NTPC.NS', name: 'NTPC Limited', ticker: 'NTPC', sector: 'Power Generation' },
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises', ticker: 'ADANIENT', sector: 'Infrastructure' },
  { symbol: 'WIPRO.NS', name: 'Wipro Limited', ticker: 'WIPRO', sector: 'IT Services' },
  { symbol: 'HCLTECH.NS', name: 'HCL Technologies', ticker: 'HCLTECH', sector: 'IT Services' },
  { symbol: 'TECHM.NS', name: 'Tech Mahindra', ticker: 'TECHM', sector: 'IT Services' },
  { symbol: 'INDIGO.NS', name: 'InterGlobe Aviation', ticker: 'INDIGO', sector: 'Aviation' },
  { symbol: 'DLF.NS', name: 'DLF Limited', ticker: 'DLF', sector: 'Real Estate' },
  { symbol: 'GODREJPROP.NS', name: 'Godrej Properties', ticker: 'GODREJPROP', sector: 'Real Estate' },
  { symbol: 'HAL.NS', name: 'Hindustan Aeronautics', ticker: 'HAL', sector: 'Aerospace & Defence' },
  { symbol: 'BEL.NS', name: 'Bharat Electronics', ticker: 'BEL', sector: 'Defence Electronics' },
  { symbol: 'MAZDOCK.NS', name: 'Mazagon Dock', ticker: 'MAZDOCK', sector: 'Defence Shipbuilding' },
  { symbol: 'DIXON.NS', name: 'Dixon Technologies', ticker: 'DIXON', sector: 'Electronics' },
  { symbol: 'VOLTAS.NS', name: 'Voltas Limited', ticker: 'VOLTAS', sector: 'Consumer Durables' },
  { symbol: 'MUTHOOTFIN.NS', name: 'Muthoot Finance', ticker: 'MUTHOOTFIN', sector: 'Gold Finance' },
  { symbol: 'KALYANKJIL.NS', name: 'Kalyan Jewellers', ticker: 'KALYANKJIL', sector: 'Gems & Jewellery' },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints', ticker: 'ASIANPAINT', sector: 'Paints & Coatings' },
  { symbol: 'CIPLA.NS', name: 'Cipla Limited', ticker: 'CIPLA', sector: 'Pharmaceuticals' },
  { symbol: 'MRF.NS', name: 'MRF Tyres', ticker: 'MRF', sector: 'Automobile Components' },
  { symbol: 'APOLLOTYRE.NS', name: 'Apollo Tyres', ticker: 'APOLLOTYRE', sector: 'Automobile Components' },
  { symbol: 'TSM', name: 'TSMC', ticker: 'TSM', sector: 'Semiconductors' },
  { symbol: 'NVDA', name: 'NVIDIA Corp', ticker: 'NVDA', sector: 'AI Semiconductors' },
  { symbol: 'AAPL', name: 'Apple Inc', ticker: 'AAPL', sector: 'Consumer Tech' }
];

function renderSearchDropdown(query) {
  const drop = $('search-dropdown');
  if (!drop) return;
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    drop.innerHTML = `
      <div class="search-drop-section">
        <span class="search-drop-title">POPULAR &amp; WATCHLIST TICKERS</span>
        <div class="search-quick-tickers">
          <button class="quick-ticker-pill" data-sym="RELIANCE.NS">RELIANCE</button>
          <button class="quick-ticker-pill" data-sym="TCS.NS">TCS</button>
          <button class="quick-ticker-pill" data-sym="HDFCBANK.NS">HDFC BANK</button>
          <button class="quick-ticker-pill" data-sym="INFY.NS">INFOSYS</button>
          <button class="quick-ticker-pill" data-sym="ICICIBANK.NS">ICICI BANK</button>
          <button class="quick-ticker-pill" data-sym="TATAMOTORS.NS">TATA MOTORS</button>
          <button class="quick-ticker-pill" data-sym="BAJFINANCE.NS">BAJAJ FINANCE</button>
          <button class="quick-ticker-pill" data-sym="BRENT">BRENT CRUDE</button>
          <button class="quick-ticker-pill" data-sym="GOLD">GOLD</button>
        </div>
      </div>
      <div class="search-drop-footer">
        <span>Press ⌘K or / to search anytime</span>
        <span>Esc to close</span>
      </div>
    `;
    drop.hidden = false;
    return;
  }

  // Filter matching companies
  const matchedTickers = KNOWN_COMPANIES.filter(c =>
    c.ticker.toLowerCase().includes(q) ||
    c.name.toLowerCase().includes(q) ||
    c.sector.toLowerCase().includes(q) ||
    c.symbol.toLowerCase().includes(q)
  ).slice(0, 5);

  // Filter matching stories from current briefing
  const matchedStories = (briefing?.stories || []).filter(s =>
    s.title.toLowerCase().includes(q) ||
    (s.category && s.category.toLowerCase().includes(q))
  ).slice(0, 3);

  let html = '';

  if (matchedTickers.length) {
    html += `
      <div class="search-drop-section">
        <span class="search-drop-title">COMPANY TICKERS · INSTANT X-RAY</span>
        ${matchedTickers.map(t => `
          <div class="search-ticker-item" data-sym="${esc(t.symbol)}">
            <div class="search-ticker-left">
              <span class="search-ticker-badge">${esc(t.ticker)}</span>
              <div class="search-ticker-meta">
                <span class="search-ticker-name">${esc(t.name)}</span>
                <span class="search-ticker-sector">${esc(t.sector)}</span>
              </div>
            </div>
            <button class="search-xray-cta">Open X-Ray ↗</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (matchedStories.length) {
    html += `
      <div class="search-drop-section">
        <span class="search-drop-title">HEADLINE CATALYSTS</span>
        ${matchedStories.map(s => `
          <div class="search-story-item" data-id="${esc(s.id)}" data-url="${safeUrl(s.url)}">
            <span class="search-story-title">${esc(s.title)}</span>
            <span class="search-story-meta">${esc(s.sources?.[0]?.name || s.source || 'Wire')} · ${timeAgo(s.published)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (!matchedTickers.length && !matchedStories.length) {
    html += `
      <div class="search-drop-section">
        <span class="search-drop-title">NO DIRECT MATCHES</span>
        <div style="font-size:11px; color:var(--ink-muted); padding: 4px 0;">
          Press Enter to run broadsheet search for "${esc(q)}"
        </div>
      </div>
    `;
  }

  html += `
    <div class="search-drop-footer">
      <span>Press Enter to filter full broadsheet</span>
      <span>Esc to close</span>
    </div>
  `;

  drop.innerHTML = html;
  drop.hidden = false;
}

function initInstantTickerSearch() {
  const input = $('search-input');
  const drop = $('search-dropdown');
  const wrap = $('search-wrap');
  const clearBtn = $('search-clear');
  if (!input || !drop) return;

  input.addEventListener('focus', () => {
    renderSearchDropdown(input.value);
  });

  input.addEventListener('input', e => {
    searchQuery = e.target.value;
    if (clearBtn) clearBtn.hidden = !searchQuery;
    if (wrap) wrap.classList.toggle('has-value', Boolean(searchQuery));
    renderSearchDropdown(searchQuery);
    render();
  });

  input.addEventListener('search', () => {
    if (!input.value) {
      searchQuery = '';
      if (clearBtn) clearBtn.hidden = true;
      if (wrap) wrap.classList.remove('has-value');
      render();
      drop.hidden = true;
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      searchQuery = '';
      clearBtn.hidden = true;
      if (wrap) wrap.classList.remove('has-value');
      input.focus();
      render();
      renderSearchDropdown('');
    });
  }

  // Handle clicks inside search dropdown
  drop.addEventListener('click', e => {
    const tickerItem = e.target.closest('.search-ticker-item');
    if (tickerItem) {
      const sym = tickerItem.dataset.sym;
      if (sym) {
        drop.hidden = true;
        openCompanyXRay(sym);
      }
      return;
    }

    const quickPill = e.target.closest('.quick-ticker-pill');
    if (quickPill) {
      const sym = quickPill.dataset.sym;
      if (sym) {
        drop.hidden = true;
        openCompanyXRay(sym);
      }
      return;
    }

    const storyItem = e.target.closest('.search-story-item');
    if (storyItem) {
      const url = storyItem.dataset.url;
      if (url && url !== '#') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-pill-wrap')) {
      if (drop && !drop.hidden) drop.hidden = true;
    }
  });

  // Keyboard navigation & global shortcuts
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
      renderSearchDropdown(input.value);
      return;
    }

    if (e.key === '/' && document.activeElement !== input && document.activeElement !== $('watch-input') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      input.focus();
      input.select();
      renderSearchDropdown(input.value);
      return;
    }

    if (e.key === 'Escape') {
      if (!drop.hidden) {
        drop.hidden = true;
        return;
      }
    }

    if (e.key === 'Enter' && document.activeElement === input) {
      drop.hidden = true;
    }
  });
}

// Off-Canvas Drawer (Hamburger)
$('menu-btn').addEventListener('click', () => $('drawer-modal').hidden = false);
$('close-drawer').addEventListener('click', () => $('drawer-modal').hidden = true);
$('drawer-backdrop').addEventListener('click', () => $('drawer-modal').hidden = true);

// Horizon switch in drawer
document.querySelectorAll('.horizon-btn').forEach(b => {
  b.addEventListener('click', () => {
    horizon = b.dataset.horizon;
    save('newsland.horizon', horizon);
    document.querySelectorAll('.horizon-btn').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
});

// Filter checkboxes
$('watch-only').addEventListener('change', render);
$('new-only').addEventListener('change', render);

// Settings in drawer
$('font-serif-btn').addEventListener('click', () => applyFont('serif'));
$('font-sans-btn').addEventListener('click', () => applyFont('sans'));

document.querySelectorAll('.size-opt').forEach(btn => {
  btn.addEventListener('click', () => applySize(btn.dataset.sizeVal));
});
if ($('font-dec')) $('font-dec').addEventListener('click', () => {
  const sizes = ['sm', 'md', 'lg'];
  const idx = sizes.indexOf(currentSize);
  if (idx > 0) applySize(sizes[idx - 1]);
});
if ($('font-inc')) $('font-inc').addEventListener('click', () => {
  const sizes = ['sm', 'md', 'lg'];
  const idx = sizes.indexOf(currentSize);
  if (idx < sizes.length - 1) applySize(sizes[idx + 1]);
});

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
});

// Refresh button
$('refresh').addEventListener('click', load);

// Sources modal in drawer
$('sources-button').addEventListener('click', () => $('source-modal').hidden = false);
$('close-sources').addEventListener('click', () => $('source-modal').hidden = true);
$('sources-backdrop').addEventListener('click', () => $('source-modal').hidden = true);

// Watchlist Form
$('watch-form').addEventListener('submit', e => {
  e.preventDefault();
  const term = $('watch-input').value.trim();
  if (term && /[a-z0-9]/i.test(term) && !watchlist.some(w => w.toLowerCase() === term.toLowerCase())) {
    watchlist.push(term);
    save('newsland.watchlist', watchlist);
    $('watch-input').value = '';
    renderWatch();
    render();
  }
});

// Click delegation: watchlist remove & feedback
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.remove !== undefined) {
    watchlist.splice(Number(b.dataset.remove), 1);
    save('newsland.watchlist', watchlist);
    renderWatch();
    render();
    return;
  }

  if (b.dataset.feedback) {
    const id = b.dataset.id;
    if (b.dataset.feedback === 'useful') {
      if (feedback[id] === 'useful') delete feedback[id];
      else feedback[id] = 'useful';
    } else if (b.dataset.feedback === 'hide') {
      feedback[id] = 'hide';
    }
    save('newsland.feedback', feedback);
    render();
    return;
  }

  const a = e.target.closest('a');
  if (a) {
    const card = a.closest('.feed-card');
    if (card && card.dataset.storyId) {
      markStoryAsRead(card.dataset.storyId);
    }
  }
});

// Helper to render TradingView candlestick chart
function renderTradingViewChart(symbolOrName) {
  const container = $('xray-chart-container');
  if (!container) return;
  const rawSym = String(symbolOrName || '').toUpperCase().trim();
  const cleanTicker = rawSym.replace(/\.NS$/, '').replace(/\.BO$/, '').trim();
  if (!cleanTicker) {
    container.innerHTML = '<div class="xray-chart-placeholder">Chart unavailable for this asset</div>';
    return;
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'slate' ||
                 document.documentElement.getAttribute('data-theme') === 'night';
  const tvTheme = isDark ? 'dark' : 'light';
  if ($('xray-chart-symbol-badge')) {
    $('xray-chart-symbol-badge').textContent = `BSE / NSE · ${cleanTicker} · Daily`;
  }
  const tvUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_xray&symbol=BSE:${encodeURIComponent(cleanTicker)}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&theme=${tvTheme}&style=1&timezone=Asia%2FKolkata&locale=en`;
  container.innerHTML = `<iframe id="tradingview-xray-iframe" src="${tvUrl}" style="width: 100%; height: 100%; border: none;" allowtransparency="true" scrolling="no"></iframe>`;
}

// Company Financial X-Ray Flyout Logic
async function openCompanyXRay(symbolOrName) {
  if (!symbolOrName) return;
  const modal = $('company-modal');
  if (!modal) return;

  modal.hidden = false;
  $('xray-name').textContent = symbolOrName;
  $('xray-symbol').textContent = 'Fetching quote…';
  $('xray-sector').textContent = '—';
  $('xray-price').textContent = 'Loading…';
  $('xray-chg').textContent = '';
  $('xray-chg').className = 'xray-chg';
  $('xray-52l').textContent = '—';
  $('xray-52h').textContent = '—';
  $('xray-mcap').textContent = '—';
  $('xray-pe').textContent = '—';
  $('xray-prev').textContent = '—';
  $('xray-sector-tag').textContent = '—';
  $('xray-stories-list').innerHTML = '<div class="xray-loading-text">Loading company coverage & stats…</div>';

  // Embed TradingView interactive chart
  renderTradingViewChart(symbolOrName);

  try {
    const cleanSym = String(symbolOrName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const res = await safeFetch(`/api/company?q=${encodeURIComponent(symbolOrName)}`, `/data/companies/${cleanSym}.json`);
    if (!res.ok) throw new Error('Failed to retrieve company data');
    const data = await res.json();
    currentXRayData = data;

    $('xray-name').textContent = data.name || symbolOrName;
    $('xray-symbol').textContent = data.symbol || symbolOrName;
    $('xray-sector').textContent = data.sector || 'Equities';
    $('xray-sector-tag').textContent = data.sector || 'Equities';
    if (data.symbol && data.symbol !== symbolOrName) {
      renderTradingViewChart(data.symbol);
    }

    $('xray-price').textContent = data.price || '--';
    if (data.change_pct !== undefined) {
      const isUp = data.direction === 'up';
      const sign = isUp ? '+' : '';
      $('xray-chg').textContent = `${sign}${data.change} (${sign}${data.change_pct}%)`;
      $('xray-chg').className = `xray-chg ${isUp ? 'up' : 'down'}`;
    }

    $('xray-prev').textContent = data.prev_close || '--';
    $('xray-52l').textContent = data.low_52w || '--';
    $('xray-52h').textContent = data.high_52w || '--';
    $('xray-mcap').textContent = data.market_cap_cr || '--';
    $('xray-pe').textContent = data.pe_ratio ? `${data.pe_ratio}x` : 'N/A';

    // Position 52W range needle
    const needle = $('xray-range-needle');
    if (needle && data.price_raw && data.low_52w_raw && data.high_52w_raw) {
      const range = data.high_52w_raw - data.low_52w_raw;
      if (range > 0) {
        let pct = ((data.price_raw - data.low_52w_raw) / range) * 100;
        pct = Math.max(2, Math.min(98, pct));
        needle.style.left = `${pct}%`;
      }
    }

    // Render matching stories from Newsland coverage
    const stories = data.stories || [];
    $('xray-news-count').textContent = `${stories.length} ${stories.length === 1 ? 'cluster' : 'clusters'}`;
    if (stories.length) {
      $('xray-stories-list').innerHTML = stories.map(st => `
        <div class="xray-story-row">
          <a class="xray-story-link" href="${safeUrl(st.url)}" target="_blank" rel="noopener noreferrer">${esc(st.title)}</a>
          <div class="xray-story-meta">
            <span>${esc(st.category || 'News')}</span>
            <span>·</span>
            <span>${timeAgo(st.published)}</span>
            ${st.sources?.length ? `<span>·</span><span>${esc(st.sources[0].name)}</span>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      $('xray-stories-list').innerHTML = '<div class="xray-loading-text">No direct company coverage clusters in today\'s active briefing.</div>';
    }

  } catch (err) {
    $('xray-price').textContent = '--';
    $('xray-stories-list').innerHTML = `<div class="xray-loading-text">Could not load company details: ${esc(err.message)}</div>`;
  }
}

// Close company drawer
if ($('close-company-drawer')) {
  $('close-company-drawer').addEventListener('click', () => {
    if ($('company-modal')) $('company-modal').hidden = true;
  });
}
if ($('company-backdrop')) {
  $('company-backdrop').addEventListener('click', () => {
    if ($('company-modal')) $('company-modal').hidden = true;
  });
}

// Copy Company X-Ray Snapshot Memo
if ($('copy-xray-memo-btn')) {
  $('copy-xray-memo-btn').addEventListener('click', async () => {
    if (!currentXRayData) return;
    const d = currentXRayData;
    const sign = (d.change_pct || 0) >= 0 ? '+' : '';
    let memo = `📊 *${d.name} (${d.symbol})* | Financial & Catalyst X-Ray\n`;
    memo += `• Live Quote: ${d.price} (${sign}${d.change} · ${sign}${d.change_pct}%)\n`;
    memo += `• 52W Envelope: Low ${d.low_52w} – High ${d.high_52w}\n`;
    memo += `• Valuation: Market Cap ${d.market_cap_cr} | P/E: ${d.pe_ratio ? d.pe_ratio + 'x' : 'N/A'}\n`;
    memo += `• Sector: ${d.sector}\n`;
    if (d.stories && d.stories.length) {
      memo += `• Active Catalysts:\n`;
      d.stories.slice(0, 3).forEach((s, idx) => {
        memo += `  ${idx + 1}. ${s.title}\n`;
      });
    }
    memo += `\nTrack institutional catalysts zero noise: https://newsland.in`;
    try {
      await navigator.clipboard.writeText(memo);
      const btn = $('copy-xray-memo-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch (_) {}
  });
}

// Global click delegation for .company-tag
document.addEventListener('click', e => {
  const companyBtn = e.target.closest('.company-tag');
  if (companyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const sym = companyBtn.dataset.symbol;
    if (sym) openCompanyXRay(sym);
    return;
  }
});

// Restore hidden stories
$('reset-feedback').addEventListener('click', () => {
  for (const id of Object.keys(feedback)) {
    if (feedback[id] === 'hide') delete feedback[id];
  }
  save('newsland.feedback', feedback);
  render();
});

// Keyboard shortcuts: '/' focuses search, 'Escape' closes drawer/modals
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('search-input') && document.activeElement !== $('watch-input')) {
    e.preventDefault();
    $('search-input').focus();
  }
  if (e.key === 'Escape') {
    if (document.activeElement === $('search-input')) {
      if ($('search-input').value) {
        $('search-input').value = '';
        searchQuery = '';
        $('search-clear').hidden = true;
        render();
      }
      $('search-input').blur();
      return;
    }
    if (isShortsOpen) {
      closeShorts();
      return;
    }
    $('drawer-modal').hidden = true;
    $('source-modal').hidden = true;
    if ($('company-modal')) $('company-modal').hidden = true;
  }
  if (isShortsOpen) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextShort();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      prevShort();
    }
  }
});

/* ========================================================
   9. MOBILE INSTAGRAM-STYLE SHORT NEWS STORIES (SHORTS)
   ======================================================== */

let shortsList = [];
let shortsActiveIndex = 0;
let isShortsOpen = false;
let isTransitioning = false;

function getLatestSortedStories(options = {}) {
  const unreadOnly = options.unreadOnly ?? shortsFilterUnreadOnly;
  const targetRegion = options.region ?? shortsRegion;

  const isMonday = new Date().toLocaleDateString('en-US', { ...ist, weekday: 'short' }) === 'Mon';
  const cutoff = Date.now() / 1000 - (horizon === 'week' ? 7 : isMonday ? 3 : 1) * 86400;

  let base = (briefing.stories || []).filter(s => {
    // 1. Hide filter
    if (feedback[s.id] === 'hide') return false;

    // 2. Unread filter
    if (unreadOnly && isStoryRead(s.id)) return false;

    // 3. Time cutoff (keep stories within horizon, but retain if published timestamp is slightly recent or unset)
    if (s.published && s.published < cutoff) return false;

    return true;
  });

  // If sector is selected
  if (activeSector !== 'all') {
    const kws = SECTOR_KEYWORDS[activeSector] || [];
    base = base.filter(s => {
      const titleLower = s.title.toLowerCase();
      const catLower = (s.category || '').toLowerCase();
      const assets = (s.impact_assets || []).map(a => a.toLowerCase());
      return kws.some(kw => titleLower.includes(kw) || catLower.includes(kw) || assets.includes(kw));
    });
  }

  // If region is selected
  if (targetRegion === 'Global') base = base.filter(s => s.region === 'Global');
  else if (targetRegion === 'India') base = base.filter(s => s.region === 'India');

  // Strict sorting: latest news first
  base.sort((a, b) => {
    const timeA = Number(a.published) || 0;
    const timeB = Number(b.published) || 0;
    if (timeB !== timeA) return timeB - timeA;
    return (viewScore(b) || 0) - (viewScore(a) || 0);
  });

  return base;
}

function updateShortsFilterCounts() {
  const unreadStories = getLatestSortedStories({ unreadOnly: true, region: shortsRegion });
  const count = unreadStories.length;
  const label = $('shorts-unread-label');
  if (label) {
    label.textContent = shortsFilterUnreadOnly ? `Unread (${count})` : 'All Stories';
  }
  const unreadBtn = $('shorts-filter-unread-btn');
  if (unreadBtn) {
    unreadBtn.classList.toggle('active', shortsFilterUnreadOnly);
    unreadBtn.title = shortsFilterUnreadOnly ? `Showing unread stories only (${count} available). Tap to show all.` : 'Showing all stories. Tap to filter unread only.';
  }
}

// Generate Card HTML adhering 100% to Newsland's Exact Broadsheet Page Styling
function generateShortCardHTML(s) {
  if (!s) return '';
  return cardHTML(s);
}

// Render Instagram-Style Progress Bar Segments
function renderShortProgressBar(index, total) {
  const pBar = $('shorts-progress-bar');
  if (!pBar) return;
  if (total <= 0) {
    pBar.innerHTML = '';
    return;
  }
  const maxVisibleSegments = 20;
  let segmentsHtml = '';

  if (total <= maxVisibleSegments) {
    for (let i = 0; i < total; i++) {
      const status = i < index ? 'completed' : i === index ? 'active' : '';
      segmentsHtml += `<div class="short-prog-seg ${status}"><span class="short-prog-fill"></span></div>`;
    }
  } else {
    const half = Math.floor(maxVisibleSegments / 2);
    let start = Math.max(0, Math.min(index - half, total - maxVisibleSegments));
    let end = start + maxVisibleSegments;
    for (let i = start; i < end; i++) {
      const status = i < index ? 'completed' : i === index ? 'active' : '';
      segmentsHtml += `<div class="short-prog-seg ${status}"><span class="short-prog-fill"></span></div>`;
    }
  }
  pBar.innerHTML = segmentsHtml;
}

// Update Footer Buttons & Header Counter
function updateShortsUI(index) {
  const total = shortsList.length;
  if (!total) {
    $('short-counter').textContent = 'Caught Up';
    const prevBtn = $('short-prev-btn');
    const nextBtn = $('short-next-btn');
    if (prevBtn) { prevBtn.disabled = true; prevBtn.style.opacity = '0.35'; }
    if (nextBtn) { nextBtn.disabled = true; nextBtn.style.opacity = '0.35'; }
    const readBtn = $('short-read-btn');
    if (readBtn) { readBtn.removeAttribute('href'); readBtn.style.pointerEvents = 'none'; }
    return;
  }

  const s = shortsList[index];
  if (!s) return;

  const modeTag = shortsFilterUnreadOnly ? ' unread' : '';
  $('short-counter').textContent = `${index + 1} / ${total}${modeTag}`;

  const readBtn = $('short-read-btn');
  if (readBtn) {
    readBtn.href = safeUrl(s.url);
    readBtn.style.pointerEvents = 'auto';
    readBtn.onclick = () => markStoryAsRead(s.id);
  }

  const usefulBtn = $('short-useful-btn');
  if (usefulBtn) {
    const isUseful = feedback[s.id] === 'useful';
    usefulBtn.classList.toggle('is-useful', isUseful);
    const icon = $('short-useful-icon');
    if (icon) icon.textContent = isUseful ? '★' : '☆';
  }

  const prevBtn = $('short-prev-btn');
  const nextBtn = $('short-next-btn');
  if (prevBtn) {
    prevBtn.disabled = (index === 0);
    prevBtn.style.opacity = index === 0 ? '0.35' : '1';
  }
  if (nextBtn) {
    nextBtn.disabled = (index === total - 1);
    nextBtn.style.opacity = index === total - 1 ? '0.35' : '1';
  }
}

// Open Shorts Mode
function openShorts(startIndex = 0) {
  updateShortsFilterCounts();
  shortsList = getLatestSortedStories({ unreadOnly: shortsFilterUnreadOnly, region: shortsRegion });

  const modal = $('shorts-modal');
  if (!modal) return;

  modal.hidden = false;
  isShortsOpen = true;
  document.body.style.overflow = 'hidden';

  // Update mobile mode switcher pills
  if ($('btn-mode-shorts')) $('btn-mode-shorts').classList.add('active');
  if ($('btn-mode-broadsheet')) $('btn-mode-broadsheet').classList.remove('active');

  if (!shortsList.length) {
    shortsActiveIndex = 0;
    renderCaughtUpDeck();
    renderShortProgressBar(0, 0);
    updateShortsUI(0);
    return;
  }

  shortsActiveIndex = Math.max(0, Math.min(startIndex, shortsList.length - 1));

  // Mark the displayed story as read
  if (shortsList[shortsActiveIndex]) {
    markStoryAsRead(shortsList[shortsActiveIndex].id);
  }

  renderDeck(shortsActiveIndex);
  renderShortProgressBar(shortsActiveIndex, shortsList.length);
  updateShortsUI(shortsActiveIndex);
}

// Render Caught Up Card when 0 unread stories
function renderCaughtUpDeck() {
  const activeCard = $('short-card-active');
  const underCard = $('short-card-underneath');
  if (!activeCard) return;

  activeCard.className = 'deck-card card-top';
  activeCard.style.transform = '';
  activeCard.style.opacity = '';
  activeCard.style.transition = '';
  activeCard.scrollTop = 0;

  const readCount = Object.keys(readStories).length;

  activeCard.innerHTML = `
    <article class="feed-card shorts-caught-up-card">
      <div class="caught-up-icon">🎉</div>
      <div class="card-eyebrow" style="justify-content: center; margin-bottom: 6px;">
        <span class="card-tag">ALL CAUGHT UP</span>
        <span class="card-dot">·</span>
        <span class="card-time">${esc(shortsRegion)} Edition</span>
      </div>
      <h2 class="caught-up-title">You've read all latest stories!</h2>
      <p class="caught-up-sub">
        No new unread stories right now in <strong>${esc(shortsRegion)}</strong>.
        Fresh market news will arrive here automatically as feeds update.
      </p>
      <div class="caught-up-stats">
        <span>✓ ${readCount} stories read</span>
      </div>
      <div class="caught-up-actions">
        <button id="btn-replay-all-shorts" class="short-read-action-btn caught-up-btn">
          <span>↺ Browse All Stories Anyway</span>
        </button>
        <button id="btn-reset-read-shorts" class="caught-up-secondary-btn">
          <span>Mark All as Unread</span>
        </button>
      </div>
    </article>
  `;

  if (underCard) {
    underCard.style.display = 'none';
    underCard.innerHTML = '';
  }

  const replayBtn = $('btn-replay-all-shorts');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      shortsFilterUnreadOnly = false;
      const unreadBtn = $('shorts-filter-unread-btn');
      if (unreadBtn) unreadBtn.classList.remove('active');
      openShorts(0);
    });
  }

  const resetBtn = $('btn-reset-read-shorts');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetReadStories();
      shortsFilterUnreadOnly = true;
      const unreadBtn = $('shorts-filter-unread-btn');
      if (unreadBtn) unreadBtn.classList.add('active');
      openShorts(0);
    });
  }
}

// Render Bumble-Style Dual Stacked Cards
function renderDeck(index) {
  const activeCard = $('short-card-active');
  const underCard = $('short-card-underneath');
  if (!activeCard) return;

  if (!shortsList.length) {
    renderCaughtUpDeck();
    return;
  }

  // Render top active card
  activeCard.className = 'deck-card card-top';
  activeCard.style.transform = '';
  activeCard.style.opacity = '';
  activeCard.style.transition = '';
  activeCard.innerHTML = generateShortCardHTML(shortsList[index]);
  activeCard.scrollTop = 0;

  // Render underneath card if a subsequent story exists
  if (underCard) {
    if (index + 1 < shortsList.length) {
      underCard.style.display = 'block';
      underCard.className = 'deck-card card-underneath';
      underCard.style.transform = '';
      underCard.style.opacity = '';
      underCard.style.transition = '';
      underCard.innerHTML = generateShortCardHTML(shortsList[index + 1]);
      underCard.scrollTop = 0;
    } else {
      underCard.style.display = 'none';
      underCard.innerHTML = '';
    }
  }
}

// Close Shorts Mode
function closeShorts() {
  const modal = $('shorts-modal');
  if (modal) modal.hidden = true;
  isShortsOpen = false;
  document.body.style.overflow = '';

  // Update mobile mode switcher pills
  if ($('btn-mode-broadsheet')) $('btn-mode-broadsheet').classList.add('active');
  if ($('btn-mode-shorts')) $('btn-mode-shorts').classList.remove('active');
}

// Bumble / Tinder Card Throw Navigation
function navigateBumble(direction) {
  if (!isShortsOpen || !shortsList.length || isTransitioning) return;

  const targetIndex = direction === 'next' ? shortsActiveIndex + 1 : shortsActiveIndex - 1;
  const activeCard = $('short-card-active');
  const underCard = $('short-card-underneath');

  // Boundary checks with rubber-band bump feedback
  if (targetIndex < 0 || targetIndex >= shortsList.length) {
    if (activeCard) {
      activeCard.classList.remove('bounce-left', 'bounce-right');
      void activeCard.offsetWidth;
      activeCard.classList.add(direction === 'next' ? 'bounce-left' : 'bounce-right');
      setTimeout(() => activeCard.classList.remove('bounce-left', 'bounce-right'), 220);
    }
    return;
  }

  isTransitioning = true;

  if (direction === 'next') {
    // Throw top card off to the left with rotation, revealing card underneath
    if (activeCard) {
      activeCard.style.transition = '';
      activeCard.className = 'deck-card card-top card-throw-left';
    }
    if (underCard) {
      underCard.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.26s ease';
      underCard.style.transform = 'scale(1) translate3d(0, 0, 0)';
      underCard.style.opacity = '1';
    }

    renderShortProgressBar(targetIndex, shortsList.length);
    const modeTag = shortsFilterUnreadOnly ? ' unread' : '';
    $('short-counter').textContent = `${targetIndex + 1} / ${shortsList.length}${modeTag}`;

    setTimeout(() => {
      shortsActiveIndex = targetIndex;
      if (shortsList[shortsActiveIndex]) {
        markStoryAsRead(shortsList[shortsActiveIndex].id);
      }
      renderDeck(shortsActiveIndex);
      updateShortsUI(shortsActiveIndex);
      isTransitioning = false;
    }, 300);

  } else {
    // Previous card rewinds back in from the left onto the top of the stack
    if (underCard && activeCard) {
      underCard.innerHTML = activeCard.innerHTML;
      underCard.style.display = 'block';
      underCard.className = 'deck-card card-underneath';
      underCard.style.transform = 'scale(0.94) translate3d(0, 14px, 0)';
      underCard.style.opacity = '0.72';
    }
    if (activeCard) {
      activeCard.innerHTML = generateShortCardHTML(shortsList[targetIndex]);
      activeCard.scrollTop = 0;
      activeCard.style.transition = '';
      activeCard.className = 'deck-card card-top card-enter-left';
    }

    renderShortProgressBar(targetIndex, shortsList.length);
    const modeTag = shortsFilterUnreadOnly ? ' unread' : '';
    $('short-counter').textContent = `${targetIndex + 1} / ${shortsList.length}${modeTag}`;

    setTimeout(() => {
      shortsActiveIndex = targetIndex;
      if (shortsList[shortsActiveIndex]) {
        markStoryAsRead(shortsList[shortsActiveIndex].id);
      }
      renderDeck(shortsActiveIndex);
      updateShortsUI(shortsActiveIndex);
      isTransitioning = false;
    }, 300);
  }
}

function nextShort() {
  navigateBumble('next');
}

function prevShort() {
  navigateBumble('prev');
}

// Attach Shorts event listeners
if ($('shorts-floating-btn')) {
  $('shorts-floating-btn').addEventListener('click', () => openShorts(0));
}
if ($('nav-shorts-btn')) {
  $('nav-shorts-btn').addEventListener('click', () => openShorts(0));
}
if ($('btn-mode-shorts')) {
  $('btn-mode-shorts').addEventListener('click', () => openShorts(0));
}
if ($('btn-mode-broadsheet')) {
  $('btn-mode-broadsheet').addEventListener('click', closeShorts);
}
if ($('drawer-shorts-btn')) {
  $('drawer-shorts-btn').addEventListener('click', () => {
    $('drawer-modal').hidden = true;
    openShorts(0);
  });
}
if ($('close-shorts')) {
  $('close-shorts').addEventListener('click', closeShorts);
}
if ($('shorts-backdrop')) {
  $('shorts-backdrop').addEventListener('click', closeShorts);
}
if ($('short-prev-btn')) {
  $('short-prev-btn').addEventListener('click', e => {
    e.stopPropagation();
    prevShort();
  });
}
if ($('short-next-btn')) {
  $('short-next-btn').addEventListener('click', e => {
    e.stopPropagation();
    nextShort();
  });
}

// Filter tabs inside Shorts
if ($('shorts-region-tabs')) {
  $('shorts-region-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.s-tab-btn');
    if (!btn) return;
    $('shorts-region-tabs').querySelectorAll('.s-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sReg = btn.dataset.sregion || btn.dataset.region || 'All';
    shortsRegion = sReg;
    openShorts(0);
  });
}

// Unread filter pill toggle
if ($('shorts-filter-unread-btn')) {
  $('shorts-filter-unread-btn').addEventListener('click', () => {
    shortsFilterUnreadOnly = !shortsFilterUnreadOnly;
    $('shorts-filter-unread-btn').classList.toggle('active', shortsFilterUnreadOnly);
    openShorts(0);
  });
}

// Reset read stories button
if ($('shorts-reset-read-btn')) {
  $('shorts-reset-read-btn').addEventListener('click', () => {
    resetReadStories();
    shortsFilterUnreadOnly = true;
    if ($('shorts-filter-unread-btn')) $('shorts-filter-unread-btn').classList.add('active');
    openShorts(0);
  });
}

// Feedback toggle within shorts
if ($('short-useful-btn')) {
  $('short-useful-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (!shortsList[shortsActiveIndex]) return;
    const s = shortsList[shortsActiveIndex];
    if (feedback[s.id] === 'useful') {
      delete feedback[s.id];
    } else {
      feedback[s.id] = 'useful';
    }
    save('newsland.feedback', feedback);
    updateShortsUI(shortsActiveIndex);
    render();
  });
}

// Interactive Real-Time Touch Drag & Bumble Swipe Gestures
(function initShortsSwipe() {
  const stage = $('shorts-deck-stage');
  if (!stage) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isDragging = false;
  let isHorizontal = false;
  let hasDragged = false;

  function getActiveCard() { return $('short-card-active'); }
  function getUnderCard() { return $('short-card-underneath'); }

  stage.addEventListener('touchstart', e => {
    if (!isShortsOpen || isTransitioning) return;
    if (e.target.closest('a, button, .company-tag, .source-link, .related-toggle-btn, .card-btn, [data-ticker]')) return;

    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
    isDragging = true;
    isHorizontal = false;
    hasDragged = false;

    const activeCard = getActiveCard();
    const underCard = getUnderCard();
    if (activeCard) activeCard.style.transition = 'none';
    if (underCard) underCard.style.transition = 'none';
  }, { passive: true });

  stage.addEventListener('touchmove', e => {
    if (!isDragging || !isShortsOpen || isTransitioning) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!isHorizontal) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        isHorizontal = true;
      } else if (Math.abs(dy) > 10) {
        // Natural vertical scroll within story
        isDragging = false;
        return;
      }
    }

    if (isHorizontal) {
      hasDragged = true;
      if (e.cancelable) e.preventDefault();

      const activeCard = getActiveCard();
      const underCard = getUnderCard();
      const rot = Math.max(-25, Math.min(25, dx * 0.08));

      if (activeCard) {
        activeCard.style.transform = `translate3d(${dx}px, ${dy * 0.2}px, 0) rotate(${rot}deg)`;
      }
      if (underCard && shortsActiveIndex + 1 < shortsList.length) {
        const progress = Math.min(1, Math.abs(dx) / 220);
        underCard.style.transform = `scale(${0.94 + 0.06 * progress}) translate3d(0, ${14 * (1 - progress)}px, 0)`;
        underCard.style.opacity = `${0.72 + 0.28 * progress}`;
      }
    }
  }, { passive: false });

  function endSwipe(endX) {
    if (!isDragging || !isShortsOpen || isTransitioning) return;
    isDragging = false;

    const activeCard = getActiveCard();
    const underCard = getUnderCard();
    if (activeCard) activeCard.style.transition = '';
    if (underCard) underCard.style.transition = '';

    if (isHorizontal) {
      const dx = endX - startX;
      const dt = Math.max(1, Date.now() - startTime);
      const velocity = Math.abs(dx) / dt;

      const isSwipeLeft = (dx < -48) || (dx < -20 && velocity > 0.35);
      const isSwipeRight = (dx > 48) || (dx > 20 && velocity > 0.35);

      if (isSwipeLeft) {
        navigateBumble('next');
      } else if (isSwipeRight) {
        navigateBumble('prev');
      } else {
        // Snap back
        if (activeCard) {
          activeCard.style.transition = 'transform 0.24s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.2s ease';
          activeCard.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
        }
        if (underCard) {
          underCard.style.transition = 'transform 0.24s ease, opacity 0.2s ease';
          underCard.style.transform = '';
          underCard.style.opacity = '';
        }
        setTimeout(() => {
          if (activeCard) activeCard.style.transition = '';
          if (underCard) underCard.style.transition = '';
        }, 250);
      }
    }
    isHorizontal = false;
  }

  stage.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    endSwipe(t.clientX);
  }, { passive: true });

  stage.addEventListener('touchcancel', () => {
    if (!isDragging) return;
    isDragging = false;
    isHorizontal = false;
    const activeCard = getActiveCard();
    const underCard = getUnderCard();
    if (activeCard) { activeCard.style.transition = ''; activeCard.style.transform = ''; }
    if (underCard) { underCard.style.transition = ''; underCard.style.transform = ''; underCard.style.opacity = ''; }
  });

  // Mouse drag support for desktop testing & review
  let mouseStartX = 0;
  let mouseStartY = 0;
  let isMouseDown = false;

  stage.addEventListener('mousedown', e => {
    if (!isShortsOpen || isTransitioning) return;
    if (e.target.closest('a, button, .company-tag, .source-link, .card-btn, [data-ticker]')) return;
    isMouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    startTime = Date.now();
    hasDragged = false;
    const activeCard = getActiveCard();
    const underCard = getUnderCard();
    if (activeCard) activeCard.style.transition = 'none';
    if (underCard) underCard.style.transition = 'none';
  });

  window.addEventListener('mousemove', e => {
    if (!isMouseDown || !isShortsOpen || isTransitioning) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    if (Math.abs(dx) > 6) {
      hasDragged = true;
      const rot = Math.max(-25, Math.min(25, dx * 0.08));
      const activeCard = getActiveCard();
      const underCard = getUnderCard();
      if (activeCard) {
        activeCard.style.transform = `translate3d(${dx}px, ${dy * 0.2}px, 0) rotate(${rot}deg)`;
      }
      if (underCard && shortsActiveIndex + 1 < shortsList.length) {
        const progress = Math.min(1, Math.abs(dx) / 220);
        underCard.style.transform = `scale(${0.94 + 0.06 * progress}) translate3d(0, ${14 * (1 - progress)}px, 0)`;
        underCard.style.opacity = `${0.72 + 0.28 * progress}`;
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (!isMouseDown) return;
    isMouseDown = false;
    const dx = e.clientX - mouseStartX;
    const activeCard = getActiveCard();
    const underCard = getUnderCard();
    if (activeCard) activeCard.style.transition = '';
    if (underCard) underCard.style.transition = '';

    if (dx < -45) {
      navigateBumble('next');
    } else if (dx > 45) {
      navigateBumble('prev');
    } else if (hasDragged) {
      if (activeCard) {
        activeCard.style.transition = 'transform 0.24s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.2s ease';
        activeCard.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      }
      if (underCard) {
        underCard.style.transition = 'transform 0.24s ease, opacity 0.2s ease';
        underCard.style.transform = '';
        underCard.style.opacity = '';
      }
      setTimeout(() => {
        if (activeCard) activeCard.style.transition = '';
        if (underCard) underCard.style.transition = '';
      }, 250);
    }
  });

  // Stage click navigation (only when not dragged)
  stage.addEventListener('click', e => {
    if (hasDragged) {
      hasDragged = false;
      return;
    }
    if (e.target.closest('a, button, .company-tag, .source-link, .related-toggle-btn, .card-btn, [data-ticker]')) return;

    const rect = stage.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    if (clickX < width * 0.28) {
      navigateBumble('prev');
    } else {
      navigateBumble('next');
    }
  });
})();

// 60-Second Audio Morning/Evening Desk Brief (Web Speech API)
let isAudioPlaying = false;

function stopAudioBrief() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  isAudioPlaying = false;
  const btn = $('audio-brief-btn');
  const wave = $('audio-soundwave');
  if (btn) {
    btn.classList.remove('is-playing');
    const label = btn.querySelector('.audio-label');
    const icon = btn.querySelector('.audio-icon');
    if (label) label.textContent = '60s Audio Brief';
    if (icon) icon.textContent = '▶';
  }
  if (wave) wave.hidden = true;

  const digestPlayBtn = $('digest-play-btn');
  if (digestPlayBtn) {
    digestPlayBtn.classList.remove('playing');
    const dLabel = $('digest-play-label');
    const dIcon = $('digest-play-icon');
    if (dLabel) dLabel.textContent = 'Listen to 60s Brief';
    if (dIcon) dIcon.textContent = '▶';
  }
}

function playAudioBrief() {
  if (!('speechSynthesis' in window)) {
    alert('Web Speech API is not supported in this browser.');
    return;
  }
  window.speechSynthesis.cancel();

  const parts = [];
  const session = typeof getISTSession === 'function' ? getISTSession() : { tag: 'Market Briefing', isPostMarket: false };
  const isPost = session.isPostMarket || session.phase === 'postmarket' || session.phase === 'overnight';

  if (isPost) {
    parts.push(`Good evening. Here is your Newsland post-market commodities, corporate earnings, and global macro wrap for the ${session.tag}.`);
  } else {
    parts.push(`Good day. Here is your Newsland 60-second financial desk brief for the ${session.tag}.`);
  }

  if (premarketData) {
    if (premarketData.live_nifty_price && premarketData.live_nifty_price !== '--') {
      const pts = premarketData.live_pts;
      const dir = (pts != null && pts >= 0) ? 'up' : 'down';
      const ptsAbs = pts != null ? Math.abs(pts) : '';
      const pct = premarketData.live_pct ? Math.abs(premarketData.live_pct) : '';
      if (isPost) {
        parts.push(`Benchmark Nifty closed at ${premarketData.live_nifty_price}, ${dir} ${ptsAbs} points or ${pct} percent.`);
      } else {
        parts.push(`Benchmark Nifty is trading at ${premarketData.live_nifty_price}, ${dir} ${ptsAbs} points or ${pct} percent.`);
      }
    }

    if (premarketData.vix) {
      parts.push(`India VIX is at ${premarketData.vix.price}, reflecting ${premarketData.vix.regime || 'observed volatility'}.`);
    }

    if (premarketData.fii_dii) {
      const fii = Math.round(premarketData.fii_dii.fii_net_cr || 0);
      const dii = Math.round(premarketData.fii_dii.dii_net_cr || 0);
      const net = Math.round(premarketData.fii_dii.net_cr || (fii + dii));
      const fiiAct = fii >= 0 ? `bought ${fii} crores` : `sold ${Math.abs(fii)} crores`;
      const diiAct = dii >= 0 ? `bought ${dii} crores` : `sold ${Math.abs(dii)} crores`;
      const netAct = net >= 0 ? `net buying of ${net} crores` : `net selling of ${Math.abs(net)} crores`;
      parts.push(`In institutional flows, Foreign institutional investors ${fiiAct}, while Domestic institutions ${diiAct}, closing with ${netAct}.`);
    }

    // Commodities & Earnings in Post-market
    if (isPost) {
      const comms = premarketData.postmarket_pillars?.commodities || {};
      const brentPrice = comms.brent?.price || premarketData.brent?.price;
      const wtiPrice = comms.wti?.price;
      const natgasPrice = comms.natgas?.price;
      if (brentPrice || natgasPrice) {
        let commScript = 'In commodities action: ';
        if (brentPrice) commScript += `Brent crude is trading at ${brentPrice} dollars per barrel. `;
        if (wtiPrice) commScript += `WTI crude is at ${wtiPrice} dollars. `;
        if (natgasPrice) commScript += `Natural Gas is at ${natgasPrice} dollars. `;
        parts.push(commScript.trim());
      }

      const earnings = premarketData.postmarket_pillars?.earnings || [];
      if (earnings.length) {
        const topEarn = earnings.slice(0, 2).map(e => e.title.replace(/[\(\)\[\]"]/g, '').trim()).join('. And ');
        parts.push(`On corporate earnings: ${topEarn}.`);
      }
    }
  }

  // Pre-market catalysts
  if (!isPost) {
    const topStories = (briefing?.stories || [])
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 2);

    if (topStories.length) {
      parts.push("Top catalysts driving today's session include:");
      topStories.forEach((s, idx) => {
        const cleanTitle = s.title.replace(/[\(\)\[\]"]/g, '').trim();
        parts.push(`Catalyst ${idx + 1}: ${cleanTitle}.`);
      });
    }
  }

  // Key Floor Pivots
  if (premarketData?.pivots?.nifty?.pivot) {
    parts.push(`Nifty key floor pivot sits at ${premarketData.pivots.nifty.pivot}, with support one at ${premarketData.pivots.nifty.s1} and resistance one at ${premarketData.pivots.nifty.r1}.`);
  }

  parts.push(isPost ? 'Stay informed, analyze risk, and have a restful evening.' : 'Trade your plan, manage risk strictly, and have a profitable session.');

  const speechText = parts.join(' ');
  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith('en-IN')) ||
                       voices.find(v => v.name.includes('Natural') && v.lang.startsWith('en')) ||
                       voices.find(v => v.lang.startsWith('en-US')) ||
                       voices.find(v => v.lang.startsWith('en'));
  if (englishVoice) {
    utterance.voice = englishVoice;
  }

  utterance.onstart = () => {
    isAudioPlaying = true;
    const btn = $('audio-brief-btn');
    const wave = $('audio-soundwave');
    if (btn) {
      btn.classList.add('is-playing');
      const label = btn.querySelector('.audio-label');
      const icon = btn.querySelector('.audio-icon');
      if (label) label.textContent = 'Playing Brief';
      if (icon) icon.textContent = '⏹';
    }
    if (wave) wave.hidden = false;

    const digestPlayBtn = $('digest-play-btn');
    if (digestPlayBtn) {
      digestPlayBtn.classList.add('playing');
      const dLabel = $('digest-play-label');
      const dIcon = $('digest-play-icon');
      if (dLabel) dLabel.textContent = 'Stop Brief';
      if (dIcon) dIcon.textContent = '⏹';
    }
  };

  utterance.onend = () => {
    stopAudioBrief();
  };

  utterance.onerror = () => {
    stopAudioBrief();
  };

  window.speechSynthesis.speak(utterance);
}

function initAudioBrief() {
  const btn = $('audio-brief-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (isAudioPlaying) {
      stopAudioBrief();
    } else {
      playAudioBrief();
    }
  });

  if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }
}

// ==========================================
// Phase 4: Smart Signal Digest Engine
// ==========================================

function getSignalDigestData(data, stories) {
  const d = data || {};
  const sList = stories || [];
  const session = typeof getISTSession === 'function' ? getISTSession() : { tag: 'Market Briefing', isPostMarket: false };
  const isPost = session.isPostMarket || session.phase === 'postmarket' || session.phase === 'overnight';

  // Pillar 1: Benchmark Stance & Regime
  const niftyPrice = d.live_nifty_price || '--';
  const pts = d.live_pts;
  const ptsFmt = pts != null ? (pts >= 0 ? `+${pts}` : `${pts}`) : '';
  const pctFmt = d.live_pct != null ? (d.live_pct >= 0 ? `+${d.live_pct}%` : `${d.live_pct}%`) : '';
  const posture = d.posture || {};
  const vix = d.vix || {};
  
  const p1Badge = pts >= 0 ? 'bullish' : 'caution';
  const p1BadgeText = pts >= 0 ? 'BULLISH BIAS' : (posture.regime || 'CORRECTIVE TREND');

  // Pillar 2: Institutional Transmission
  const fiiDii = d.fii_dii || {};
  const fiiCr = fiiDii.fii_net_cr != null ? Math.round(fiiDii.fii_net_cr) : 0;
  const diiCr = fiiDii.dii_net_cr != null ? Math.round(fiiDii.dii_net_cr) : 0;
  const netCr = fiiDii.net_cr != null ? Math.round(fiiDii.net_cr) : (fiiCr + diiCr);
  const p2Badge = netCr >= 0 ? 'bullish' : 'caution';
  const p2BadgeText = netCr >= 0 ? 'NET BUYING' : 'NET OUTFLOW';

  // Pillar 3: Commodities & Macro Pulse
  const comms = d.postmarket_pillars?.commodities || {};
  const brent = comms.brent || d.brent || {};
  const wti = comms.wti || {};
  const natgas = comms.natgas || {};
  const gold = comms.gold || {};
  const silver = comms.silver || {};
  const over = d.overnight || {};
  const sp500 = over.SP500 || {};
  const us10y = over.US10Y || {};

  // Pillar 4: Tactical Setup & Catalysts
  const pivots = d.pivots || {};
  const niftyPiv = pivots.nifty || {};
  const bnPiv = pivots.banknifty || {};
  
  let topCat = null;
  if (isPost && d.postmarket_pillars?.earnings?.length) {
    topCat = d.postmarket_pillars.earnings[0];
  } else if (sList.length) {
    topCat = sList.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  }

  return {
    isPost,
    session,
    pillar1: {
      title: 'Benchmark Stance & Regime',
      badgeClass: p1Badge,
      badgeText: p1BadgeText,
      niftyPrice,
      ptsFmt,
      pctFmt,
      regime: posture.regime || 'Consolidation',
      dma50Pct: posture.pct_dma50 != null ? `${posture.pct_dma50}%` : '--',
      dma50Fmt: posture.dma50_fmt || '--',
      dma200Pct: posture.pct_dma200 != null ? `${posture.pct_dma200}%` : '--',
      dma200Fmt: posture.dma200_fmt || '--',
      vixPrice: vix.price || '--',
      vixRegime: vix.regime || 'Normal Volatility',
      range52: posture.low52_fmt && posture.high52_fmt ? `${posture.low52_fmt} – ${posture.high52_fmt}` : 'Broad Trading Range'
    },
    pillar2: {
      title: 'Institutional Transmission',
      badgeClass: p2Badge,
      badgeText: p2BadgeText,
      fiiCr,
      diiCr,
      netCr,
      trend: fiiDii.trend || (netCr >= 0 ? 'Domestic Absorption' : 'Foreign Profit Booking'),
      date: fiiDii.date || 'Latest Session'
    },
    pillar3: {
      title: isPost ? 'MCX Commodities & Global Macro' : 'Global Macro & Cross-Asset',
      badgeClass: 'neutral',
      badgeText: isPost ? 'ENERGY & METALS' : 'CROSS-ASSET PULSE',
      brentPrice: brent.price || '--',
      brentPct: brent.change_pct != null ? `${brent.change_pct}%` : '',
      wtiPrice: wti.price || '--',
      wtiPct: wti.change_pct != null ? `${wti.change_pct}%` : '',
      natgasPrice: natgas.price || '--',
      natgasPct: natgas.change_pct != null ? `${natgas.change_pct}%` : '',
      goldPrice: gold.price || '--',
      silverPrice: silver.price || '--',
      sp500Val: sp500.val || '--',
      sp500Pct: sp500.pct != null ? `${sp500.pct}%` : '',
      us10yVal: us10y.val || '--',
      usdinr: d.usdinr?.price || '83.95'
    },
    pillar4: {
      title: 'Tactical Setup & Catalysts',
      badgeClass: 'caution',
      badgeText: 'KEY PIVOTS',
      niftyPivot: niftyPiv.pivot || '--',
      niftyS1: niftyPiv.s1 || '--',
      niftyR1: niftyPiv.r1 || '--',
      bnPivot: bnPiv.pivot || '--',
      bnS1: bnPiv.s1 || '--',
      bnR1: bnPiv.r1 || '--',
      catalystTitle: topCat ? topCat.title : 'Focus on institutional liquidity dynamics and risk boundaries.',
      catalystMatters: topCat?.why_it_matters || 'Determines near-term volatility and positioning conviction.'
    }
  };
}

function generateSignalDigestMemo(digest) {
  const d = digest;
  const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

  const lines = [
    `⚡ NEWSLAND EXECUTIVE SIGNAL DIGEST`,
    `${dateStr} • ${timeStr} IST • ${d.session.tag}`,
    `----------------------------------------`,
    `🧭 BENCHMARK STANCE & REGIME`,
    `• Nifty 50: ${d.pillar1.niftyPrice} (${d.pillar1.ptsFmt} pts, ${d.pillar1.pctFmt})`,
    `• Posture: ${d.pillar1.regime} (${d.pillar1.dma50Pct} vs 50 DMA, ${d.pillar1.dma200Pct} vs 200 DMA)`,
    `• India VIX: ${d.pillar1.vixPrice} (${d.pillar1.vixRegime})`,
    ``,
    `🏛️ INSTITUTIONAL TRANSMISSION`,
    `• FII Net: ${d.pillar2.fiiCr >= 0 ? '+' : ''}${d.pillar2.fiiCr} Cr | DII Net: ${d.pillar2.diiCr >= 0 ? '+' : ''}${d.pillar2.diiCr} Cr`,
    `• Net Institutional: ${d.pillar2.netCr >= 0 ? '+' : ''}${d.pillar2.netCr} Cr`,
    `• Trend: ${d.pillar2.trend}`,
    ``,
    `🛢️ COMMODITIES & CROSS-ASSET`,
    `• Brent: $${d.pillar3.brentPrice} (${d.pillar3.brentPct}) | WTI: $${d.pillar3.wtiPrice}`,
    `• Natural Gas: $${d.pillar3.natgasPrice} | Gold: $${d.pillar3.goldPrice} | Silver: $${d.pillar3.silverPrice}`,
    `• US 10Y Yield: ${d.pillar3.us10yVal} | S&P 500: ${d.pillar3.sp500Val} (${d.pillar3.sp500Pct})`,
    `• USDINR: ${d.pillar3.usdinr}`,
    ``,
    `🎯 TACTICAL LEVELS & CATALYSTS`,
    `• Nifty Pivots: S1 ${d.pillar4.niftyS1} < Pivot ${d.pillar4.niftyPivot} < R1 ${d.pillar4.niftyR1}`,
    `• BankNifty: S1 ${d.pillar4.bnS1} < Pivot ${d.pillar4.bnPivot} < R1 ${d.pillar4.bnR1}`,
    `• Key Catalyst: ${d.pillar4.catalystTitle}`,
    `----------------------------------------`,
    `Synthesized by Newsland Financial Intelligence Desk • newsland.pages.dev`
  ];

  return lines.join('\n');
}

function renderSignalDigest() {
  const container = $('digest-cards-list');
  if (!container) return;
  const d = getSignalDigestData(premarketData, briefing?.stories || []);

  container.innerHTML = `
    <!-- Card 1: Benchmark Stance -->
    <div class="digest-card">
      <div class="digest-card-header">
        <span class="digest-card-title">🧭 ${escapeHtml(d.pillar1.title)}</span>
        <span class="digest-card-badge ${d.pillar1.badgeClass}">${escapeHtml(d.pillar1.badgeText)}</span>
      </div>
      <div class="digest-card-content">
        <div><strong>Nifty 50:</strong> ${escapeHtml(d.pillar1.niftyPrice)} <span style="font-weight:600; color:${d.pillar1.ptsFmt.startsWith('+') ? 'var(--green-ticker)' : 'var(--red-ticker)'};">(${escapeHtml(d.pillar1.ptsFmt)} pts, ${escapeHtml(d.pillar1.pctFmt)})</span></div>
        <div><strong>Posture:</strong> ${escapeHtml(d.pillar1.regime)} (${escapeHtml(d.pillar1.dma50Pct)} vs 50 DMA)</div>
        <div><strong>India VIX:</strong> ${escapeHtml(d.pillar1.vixPrice)} (${escapeHtml(d.pillar1.vixRegime)})</div>
      </div>
      <div class="digest-card-meta">52W Bounds: ${escapeHtml(d.pillar1.range52)}</div>
    </div>

    <!-- Card 2: Institutional Flows -->
    <div class="digest-card">
      <div class="digest-card-header">
        <span class="digest-card-title">🏛️ ${escapeHtml(d.pillar2.title)}</span>
        <span class="digest-card-badge ${d.pillar2.badgeClass}">${escapeHtml(d.pillar2.badgeText)}</span>
      </div>
      <div class="digest-card-content">
        <div><strong>FII Net:</strong> ₹${d.pillar2.fiiCr} Cr | <strong>DII Net:</strong> ₹${d.pillar2.diiCr} Cr</div>
        <div><strong>Net Cumulative:</strong> ₹${d.pillar2.netCr} Cr</div>
        <div style="color:var(--ink-muted); font-size:11px;">${escapeHtml(d.pillar2.trend)}</div>
      </div>
      <div class="digest-card-meta">As of ${escapeHtml(d.pillar2.date)}</div>
    </div>

    <!-- Card 3: Commodities & Macro -->
    <div class="digest-card">
      <div class="digest-card-header">
        <span class="digest-card-title">🛢️ ${escapeHtml(d.pillar3.title)}</span>
        <span class="digest-card-badge ${d.pillar3.badgeClass}">${escapeHtml(d.pillar3.badgeText)}</span>
      </div>
      <div class="digest-card-content">
        <div><strong>Brent:</strong> $${escapeHtml(d.pillar3.brentPrice)} <span style="font-size:10.5px;color:var(--ink-muted);">(${escapeHtml(d.pillar3.brentPct)})</span> | <strong>WTI:</strong> $${escapeHtml(d.pillar3.wtiPrice)}</div>
        <div><strong>NatGas:</strong> $${escapeHtml(d.pillar3.natgasPrice)} | <strong>Gold:</strong> $${escapeHtml(d.pillar3.goldPrice)} | <strong>Silver:</strong> $${escapeHtml(d.pillar3.silverPrice)}</div>
        <div><strong>US 10Y:</strong> ${escapeHtml(d.pillar3.us10yVal)} | <strong>S&P 500:</strong> ${escapeHtml(d.pillar3.sp500Val)} (${escapeHtml(d.pillar3.sp500Pct)})</div>
      </div>
      <div class="digest-card-meta">USDINR: ${escapeHtml(d.pillar3.usdinr)} • Active Futures Pulse</div>
    </div>

    <!-- Card 4: Tactical Setup & Catalysts -->
    <div class="digest-card">
      <div class="digest-card-header">
        <span class="digest-card-title">🎯 ${escapeHtml(d.pillar4.title)}</span>
        <span class="digest-card-badge ${d.pillar4.badgeClass}">${escapeHtml(d.pillar4.badgeText)}</span>
      </div>
      <div class="digest-card-content">
        <div><strong>Nifty Pivots:</strong> S1 ${escapeHtml(String(d.pillar4.niftyS1))} &lt; <strong style="color:var(--accent-red);">P ${escapeHtml(String(d.pillar4.niftyPivot))}</strong> &lt; R1 ${escapeHtml(String(d.pillar4.niftyR1))}</div>
        <div><strong>BankNifty:</strong> S1 ${escapeHtml(String(d.pillar4.bnS1))} &lt; <strong style="color:var(--accent-red);">P ${escapeHtml(String(d.pillar4.bnPivot))}</strong> &lt; R1 ${escapeHtml(String(d.pillar4.bnR1))}</div>
        <div style="font-size:11px; margin-top:2px;"><strong>Catalyst:</strong> ${escapeHtml(d.pillar4.catalystTitle)}</div>
      </div>
      <div class="digest-card-meta">Session Risk Boundaries & Support/Resistance</div>
    </div>
  `;
}

function openSignalDigestModal() {
  const modal = $('digest-modal');
  if (!modal) return;
  renderSignalDigest();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSignalDigestModal() {
  const modal = $('digest-modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function initSignalDigest() {
  const triggerBtn = $('signal-digest-btn');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', openSignalDigestModal);
  }

  const closeBtn = $('close-digest-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSignalDigestModal);
  }

  const backdrop = $('digest-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeSignalDigestModal);
  }

  // Digest Audio Play Button
  const digestPlayBtn = $('digest-play-btn');
  if (digestPlayBtn) {
    digestPlayBtn.addEventListener('click', () => {
      if (isAudioPlaying) {
        stopAudioBrief();
      } else {
        playAudioBrief();
      }
    });
  }

  // Copy Executive Memo Button
  const copyBtn = $('copy-digest-memo-btn');
  const statusEl = $('digest-copy-status');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const digest = getSignalDigestData(premarketData, briefing?.stories || []);
      const memo = generateSignalDigestMemo(digest);
      const showStatus = (msg, isErr) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.color = isErr ? 'var(--red-ticker)' : 'var(--green-ticker)';
        statusEl.hidden = false;
        setTimeout(() => { statusEl.hidden = true; }, 3500);
      };

      try {
        await navigator.clipboard.writeText(memo);
        showStatus('✓ Executive Signal Memo copied to clipboard!');
      } catch (err) {
        try {
          const ta = document.createElement('textarea');
          ta.value = memo;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showStatus('✓ Executive Signal Memo copied!');
        } catch (e) {
          showStatus('Failed to copy memo', true);
        }
      }
    });
  }

  // Share to WhatsApp
  const waBtn = $('share-digest-wa-btn');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const digest = getSignalDigestData(premarketData, briefing?.stories || []);
      const memo = generateSignalDigestMemo(digest);
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(memo)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // Share to X
  const xBtn = $('share-digest-x-btn');
  if (xBtn) {
    xBtn.addEventListener('click', () => {
      const digest = getSignalDigestData(premarketData, briefing?.stories || []);
      const dateStr = new Date().toLocaleDateString('en-IN', { ...ist, day: 'numeric', month: 'short' });
      const tweet = `⚡ Newsland Executive Signal Digest (${dateStr}):\n• Nifty: ${digest.pillar1.niftyPrice} (${digest.pillar1.ptsFmt} pts)\n• FII/DII Net: ₹${digest.pillar2.netCr} Cr (${digest.pillar2.trend})\n• VIX: ${digest.pillar1.vixPrice} | Brent: $${digest.pillar3.brentPrice}\n• Pivot: ${digest.pillar4.niftyPivot}\n\nInstitutional clarity. Zero noise 👇\n`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent('https://newsland.in')}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // Escape Key Handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('digest-modal');
      if (modal && !modal.hidden) closeSignalDigestModal();
    }
  });
}

// Initial boot
renderWatch();
load();
loadMarket();
initAudioBrief();
initShareModal();
initInstantTickerSearch();
initSignalDigest();
setInterval(load, 30000);
setInterval(loadMarket, 60000);


