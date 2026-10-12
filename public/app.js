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
let events = [];
let searchQuery = '';
let activeTrendingWord = '';
let activeCatalystFilter = 'all';
let activeMarketMoversOnly = false;
let activeSector = 'all';
let premarketData = null;

const SECTOR_KEYWORDS = {
  banking: ['bank', 'banking', 'rbi', 'repo', 'hdfc', 'icici', 'sbi', 'axis', 'kotak', 'nbfc', 'loan', 'emi', 'deposit', 'fd', 'fintech', 'fino', 'credit', 'rate hike'],
  it: ['it', 'tech', 'tcs', 'infosys', 'infy', 'wipro', 'hcl', 'accenture', 'software', 'ai', 'chip', 'semiconductor', 'tsmc', 'nasdaq'],
  energy: ['crude', 'oil', 'brent', 'petroleum', 'omc', 'refinery', 'gas', 'reliance', 'ril', 'opec', 'fuel', 'bpcl', 'ioc', 'hpcl'],
  auto: ['auto', 'automotive', 'car', 'vehicle', 'tata motors', 'maruti', 'mahindra', 'bajaj', 'hero', 'ev', 'sales'],
  metals: ['metal', 'metals', 'steel', 'iron', 'copper', 'aluminum', 'mining', 'vedanta', 'tata steel', 'jsw', 'gold', 'silver', 'bullion']
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
  const ageHours = story.published ? (Date.now() / 1000 - story.published) / 3600 : 999;

  // Intraday freshness velocity curve: boost breaking news within today's session
  if (horizon === 'today') {
    if (ageHours < 1) score += 5;        // Breaking in last hour
    else if (ageHours < 3) score += 3.5; // Fresh morning catalyst
    else if (ageHours < 6) score += 1.5; // Active intraday session
    else if (ageHours < 10) score += 0;  // Normal day pace
    else if (ageHours < 16) score -= 3;  // Older overnight news
    else if (ageHours < 24) score -= 5.5;// Previous session
    else score -= 8;                     // Multi-day old
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

  // Keep the rule-based impact score ahead of recency; feedback/watchlist are small personal adjustments.
  base.sort((a, b) => {
    return (viewScore(b) - viewScore(a)) || ((b.published || 0) - (a.published || 0));
  });

  let filtered = base;
  if (region === 'Global') filtered = base.filter(s => s.region === 'Global');
  else if (region === 'India') filtered = base.filter(s => s.region === 'India');

  // Render trending keywords list
  renderTrendingKeywords(filtered);

  const narrowed = Boolean(searchQuery.trim() || activeTrendingWord || activeMarketMoversOnly || (activeSector !== 'all') || $('watch-only').checked || $('new-only').checked);
  const ranked = filtered.map(story => ({ story, tier: viewTier(story) }));

  const FRONT_PAGE_LIMIT = 18; // 6 balanced rows of 3 columns
  let primaryStories = [];
  let lowerStories = [];
  let fallbackUsed = false;

  if (narrowed) {
    primaryStories = filtered;
    lowerStories = [];
  } else {
    const priorityCandidates = ranked.filter(item => item.tier !== 'More').map(item => item.story);
    const pool = priorityCandidates.length ? priorityCandidates : filtered;

    primaryStories = pool.slice(0, FRONT_PAGE_LIMIT);
    const primaryIds = new Set(primaryStories.map(s => s.id));
    lowerStories = filtered.filter(s => !primaryIds.has(s.id));
    if (!priorityCandidates.length) fallbackUsed = true;
  }

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
  const heroCandidates = [...mustKnow].sort((a, b) => (heroRank(b) - heroRank(a)) || ((b.published || 0) - (a.published || 0)));
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

  if (activeSector !== 'all') {
    $('ranking-note').hidden = false;
    $('ranking-note').textContent = `Sector: ${activeSector.toUpperCase()} (${filtered.length} headlines matched)`;
  } else if (activeMarketMoversOnly) {
    $('ranking-note').hidden = false;
    $('ranking-note').textContent = `⚡ High-conviction market movers (${filtered.length} headlines matched)`;
  } else {
    $('ranking-note').hidden = narrowed || filtered.length === 0;
    $('ranking-note').textContent = fallbackUsed
      ? `No clear market drivers matched · showing ${primaryStories.length} recent headlines for review.`
      : `${primaryStories.length} higher-signal headlines · ${lowerStories.length} other headlines in More`;
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

// Pre-Market Trading Desk Brief Renderer
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
  if ($('pm-gift-sub')) {
    $('pm-gift-sub').textContent = `Quote session: ${data.quote_date || 'date unavailable'} · ${data.quote_source || 'source unavailable'} · Previous close ${data.nifty_prev_close || '--'} · Fetched ${data.quote_updated ? new Date(data.quote_updated).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'time unavailable'}`;
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
    if ($('pm-flows-sub')) {
      const net = data.fii_dii.net_cr ?? (fii + dii);
      const netSign = net >= 0 ? '+' : '-';
      const trend = `${data.fii_dii.date} · ${net >= 0 ? 'Net buying' : 'Net selling'}`;
      $('pm-flows-sub').textContent = `${trend} (${netSign}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')} Cr)`;
    }
  }

  else {
    if ($('pm-fii-val')) $('pm-fii-val').textContent = '--';
    if ($('pm-dii-val')) $('pm-dii-val').textContent = '--';
    if ($('pm-flows-sub')) $('pm-flows-sub').textContent = 'Unavailable · dated, verified source required';
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
    $('pm-takeaway-text').textContent = data.trader_take;
  }
}

// Helper to fetch live API with static /data fallback for Cloudflare Pages
async function safeFetch(primaryUrl, fallbackUrl) {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const first = isLocal ? primaryUrl : (fallbackUrl || primaryUrl);
  const second = isLocal ? fallbackUrl : primaryUrl;

  try {
    const res = await fetch(first);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && (ct.includes('json') || first.endsWith('.json'))) return res;
  } catch (_) {}

  if (second && second !== first) {
    try {
      const fb = await fetch(second);
      const ct = fb.headers.get('content-type') || '';
      if (fb.ok && (ct.includes('json') || second.endsWith('.json'))) return fb;
    } catch (_) {}
  }
  return fetch(first);
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
    if (briefing.premarket) {
      premarketData = briefing.premarket;
      renderPremarket(premarketData);
    }
    render();
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

// Pre-Market Brief Collapse/Expand
if ($('premarket-toggle')) {
  $('premarket-toggle').addEventListener('click', () => {
    const body = $('premarket-body');
    if (!body) return;
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    $('premarket-toggle').textContent = isHidden ? 'Collapse ▴' : 'Expand ▾';
    $('premarket-toggle').setAttribute('aria-expanded', String(isHidden));
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

// Copy Trading Desk Memo to Clipboard
if ($('copy-memo-btn')) {
  $('copy-memo-btn').addEventListener('click', async () => {
    if (!premarketData) return;
    const session = getISTSession();
    const dateStr = new Date().toLocaleDateString('en-IN', { ...ist, day: 'numeric', month: 'short', year: 'numeric' });
    const bias = 'Latest available quote';
    const price = premarketData.live_nifty_price || '--';
    const pts = premarketData.live_pts ?? '--';
    const pct = premarketData.live_pct ?? '--';
    const ptsSign = pts >= 0 ? '+' : '';
    const pctSign = pct >= 0 ? '+' : '';

    let text = `*Newsland ${session.tag}* (${dateStr})\n`;
    text += `• Bias / Benchmark: ${bias} (${price} · ${ptsSign}${pts} pts, ${pctSign}${pct}%)\n`;
    if (premarketData.fii_dii) {
      const fii = premarketData.fii_dii.fii_net_cr ?? 0;
      const dii = premarketData.fii_dii.dii_net_cr ?? 0;
      const net = premarketData.fii_dii.net_cr ?? 0;
      text += `• Institutional Flows (${premarketData.fii_dii.date}): FII ${fii >= 0 ? '+' : '-'}₹${Math.abs(Math.round(fii)).toLocaleString('en-IN')} Cr | DII ${dii >= 0 ? '+' : '-'}₹${Math.abs(Math.round(dii)).toLocaleString('en-IN')} Cr (Net ${net >= 0 ? '+' : '-'}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')} Cr)\n`;
    }
    if (premarketData.overnight) {
      const sp = premarketData.overnight.SP500;
      const brent = premarketData.brent;
      text += `• Macro Cues: S&P 500 (${sp?.val || '--'} · ${sp?.pct >= 0 ? '+' : ''}${sp?.pct ?? 0}%) | Brent Crude (${brent?.price || '--'} · ${brent?.change_pct >= 0 ? '+' : ''}${brent?.change_pct ?? 0}%)\n`;
    }
    if (premarketData.pivots?.nifty) {
      const np = premarketData.pivots.nifty;
      text += `• Nifty 50 Pivots: S2 ${np.s2} · S1 ${np.s1} · Pivot ${np.pivot} · R1 ${np.r1} · R2 ${np.r2}\n`;
    }
    if (premarketData.posture) {
      const p = premarketData.posture;
      text += `• Market Regime: ${p.regime} (${p.pct_from_high52}% from 52W peak · 50-DMA: ${p.dma50_fmt} · 200-DMA: ${p.dma200_fmt || '--'})\n`;
    }
    if (premarketData.sector_breadth) {
      const sb = premarketData.sector_breadth;
      const secSummary = sb.sectors ? sb.sectors.map(s => `${s.name} ${s.pct >= 0 ? '+' : ''}${s.pct}%`).join(', ') : '';
      text += `• Sector Breadth: ${sb.summary} [${secSummary}]\n`;
    }
    if (premarketData.session_drivers?.length) {
      text += `• Session Drivers:\n`;
      premarketData.session_drivers.forEach(d => {
        text += `  [${d.num}] ${d.title} (${d.bias}): ${d.desc}\n`;
      });
    }
    if (premarketData.trader_take) {
      text += `• Desk Take: ${premarketData.trader_take}\n`;
    }

    try {
      await navigator.clipboard.writeText(text);
      const btn = $('copy-memo-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch (err) {
      console.warn('Clipboard failed', err);
    }
  });
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

// Search input
$('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  $('search-clear').hidden = !searchQuery;
  render();
});
$('search-clear').addEventListener('click', () => {
  $('search-input').value = '';
  searchQuery = '';
  $('search-clear').hidden = true;
  $('search-input').focus();
  render();
});

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
});

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

  try {
    const cleanSym = String(symbolOrName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const res = await safeFetch(`/api/company?q=${encodeURIComponent(symbolOrName)}`, `/data/companies/${cleanSym}.json`);
    if (!res.ok) throw new Error('Failed to retrieve company data');
    const data = await res.json();

    $('xray-name').textContent = data.name || symbolOrName;
    $('xray-symbol').textContent = data.symbol || symbolOrName;
    $('xray-sector').textContent = data.sector || 'Equities';
    $('xray-sector-tag').textContent = data.sector || 'Equities';

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

function getLatestSortedStories() {
  const isMonday = new Date().toLocaleDateString('en-US', { ...ist, weekday: 'short' }) === 'Mon';
  const cutoff = Date.now() / 1000 - (horizon === 'week' ? 7 : isMonday ? 3 : 1) * 86400;

  let base = (briefing.stories || []).filter(s =>
    s.published &&
    s.published >= cutoff &&
    feedback[s.id] !== 'hide'
  );

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
  if (region === 'Global') base = base.filter(s => s.region === 'Global');
  else if (region === 'India') base = base.filter(s => s.region === 'India');

  // Strict sorting: latest news first
  base.sort((a, b) => (b.published || 0) - (a.published || 0));
  return base;
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
  const s = shortsList[index];
  if (!s) return;

  $('short-counter').textContent = `${index + 1} / ${total}`;

  const readBtn = $('short-read-btn');
  if (readBtn) readBtn.href = safeUrl(s.url);

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
  shortsList = getLatestSortedStories();
  if (!shortsList.length) {
    shortsList = (briefing.stories || [])
      .filter(s => feedback[s.id] !== 'hide')
      .sort((a, b) => (b.published || 0) - (a.published || 0));
  }
  if (!shortsList.length) {
    alert('No active stories available right now.');
    return;
  }

  shortsActiveIndex = Math.max(0, Math.min(startIndex, shortsList.length - 1));
  const modal = $('shorts-modal');
  if (!modal) return;

  modal.hidden = false;
  isShortsOpen = true;
  document.body.style.overflow = 'hidden';

  // Update mobile mode switcher pills
  if ($('btn-mode-shorts')) $('btn-mode-shorts').classList.add('active');
  if ($('btn-mode-broadsheet')) $('btn-mode-broadsheet').classList.remove('active');

  const activeCard = $('short-card-active');
  const incomingCard = $('short-card-incoming');
  if (activeCard) {
    activeCard.className = 'short-slide-card card-active';
    activeCard.innerHTML = generateShortCardHTML(shortsList[shortsActiveIndex]);
    activeCard.scrollTop = 0;
  }
  if (incomingCard) {
    incomingCard.className = 'short-slide-card card-incoming';
    incomingCard.style.display = 'none';
  }

  renderShortProgressBar(shortsActiveIndex, shortsList.length);
  updateShortsUI(shortsActiveIndex);
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

// Guaranteed Hardware-Accelerated Keyframe Transitions (Prev & Next)
function navigateShort(direction) {
  if (!isShortsOpen || !shortsList.length || isTransitioning) return;

  const targetIndex = direction === 'next' ? shortsActiveIndex + 1 : shortsActiveIndex - 1;
  const activeCard = $('short-card-active');
  const incomingCard = $('short-card-incoming');

  // Boundary check with subtle rubber-band feedback
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
  const targetStory = shortsList[targetIndex];

  // Stage incoming card
  incomingCard.innerHTML = generateShortCardHTML(targetStory);
  incomingCard.scrollTop = 0;

  // Clear animation classes and trigger reflow
  activeCard.classList.remove('anim-slide-out-left', 'anim-slide-out-right', 'bounce-left', 'bounce-right');
  incomingCard.classList.remove('anim-slide-in-right', 'anim-slide-in-left');
  void incomingCard.offsetWidth;

  if (direction === 'next') {
    activeCard.classList.add('anim-slide-out-left');
    incomingCard.classList.add('anim-slide-in-right');
  } else {
    activeCard.classList.add('anim-slide-out-right');
    incomingCard.classList.add('anim-slide-in-left');
  }

  // Pre-update progress indicator for snappy responsiveness
  renderShortProgressBar(targetIndex, shortsList.length);
  $('short-counter').textContent = `${targetIndex + 1} / ${shortsList.length}`;

  setTimeout(() => {
    shortsActiveIndex = targetIndex;
    activeCard.innerHTML = incomingCard.innerHTML;
    activeCard.className = 'short-slide-card card-active';
    incomingCard.className = 'short-slide-card card-incoming';
    incomingCard.style.display = 'none';
    activeCard.scrollTop = 0;

    updateShortsUI(shortsActiveIndex);
    isTransitioning = false;
  }, 280);
}

function nextShort() {
  navigateShort('next');
}

function prevShort() {
  navigateShort('prev');
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

// Clean Non-Blocking Tap Navigation (Edge taps)
if ($('shorts-slider-stage')) {
  $('shorts-slider-stage').addEventListener('click', e => {
    // Ignore clicks on interactive links, buttons, and company tags
    if (e.target.closest('a, button, .company-tag, .source-link, .related-toggle-btn, .card-btn')) return;

    const rect = $('shorts-slider-stage').getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    // Left 28% goes to previous story; right 72% advances to next story
    if (clickX < width * 0.28) {
      prevShort();
    } else {
      nextShort();
    }
  });
}

// Filter tabs inside Shorts
if ($('shorts-region-tabs')) {
  $('shorts-region-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.s-tab-btn');
    if (!btn) return;
    $('shorts-region-tabs').querySelectorAll('.s-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sReg = btn.dataset.sregion;
    region = sReg;
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

// Interactive Real-Time Touch Drag & Swipe Gestures
(function initShortsSwipe() {
  const stage = $('shorts-slider-stage');
  if (!stage) return;

  let startX = 0;
  let startY = 0;
  let isSwiping = false;

  stage.addEventListener('touchstart', e => {
    if (!isShortsOpen || isTransitioning) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    isSwiping = true;
  }, { passive: true });

  stage.addEventListener('touchmove', e => {
    if (!isSwiping || !isShortsOpen || isTransitioning) return;
  }, { passive: true });

  stage.addEventListener('touchend', e => {
    if (!isSwiping || !isShortsOpen || isTransitioning) return;
    isSwiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // Detect horizontal swipe if deltaX is significant and primarily horizontal
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      if (dx < 0) {
        nextShort(); // Swiped left -> next
      } else {
        prevShort(); // Swiped right -> prev
      }
    }
  }, { passive: true });

  // Mouse drag support for desktop testing & review
  let mouseStartX = 0;
  let isMouseDown = false;

  stage.addEventListener('mousedown', e => {
    if (!isShortsOpen || isTransitioning) return;
    if (e.target.closest('a, button, .company-tag, .source-link, .card-btn')) return;
    isMouseDown = true;
    mouseStartX = e.clientX;
  });

  window.addEventListener('mouseup', e => {
    if (!isMouseDown || !isShortsOpen || isTransitioning) return;
    isMouseDown = false;
    const dx = e.clientX - mouseStartX;
    if (Math.abs(dx) > 38) {
      if (dx < 0) nextShort();
      else prevShort();
    }
  });
})();

// Initial boot
renderWatch();
load();
loadMarket();
setInterval(load, 30000);
setInterval(loadMarket, 60000);
