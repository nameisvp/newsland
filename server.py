#!/usr/bin/env python3
"""Newsland: personal market briefing reader with live ticker.
Dependencies: yfinance (pip install yfinance) for market quotes; stdlib for everything else.
Binds to localhost."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse, parse_qs
import csv, glob, hashlib, html, io, json, os, re, sys, threading, time, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
for _p in glob.glob(str(ROOT / '.venv/lib/python*/site-packages')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
LOCK = threading.Lock()
CACHE = {'updated': None, 'stories': [], 'sources': [], 'refreshing': False}
INTERVAL = 600

# ── Market Data Configuration ──────────────────────────────────────────
MARKET_LOCK = threading.Lock()
MARKET_INTERVAL = 300  # 5 minutes
MARKET_SYMBOLS = {
    'SENSEX': {'yf': '^BSESN',  'label': 'Sensex',      'unit': ''},
    'NIFTY':  {'yf': '^NSEI',   'label': 'Nifty 50',    'unit': ''},
    'GOLD':   {'yf': 'GC=F',   'label': 'Gold',         'unit': 'USD/oz'},
    'SILVER': {'yf': 'SI=F',   'label': 'Silver',       'unit': 'USD/oz'},
    'BRENT':  {'yf': 'BZ=F',   'label': 'Brent Crude',  'unit': 'USD/bbl'},
    'USDINR': {'yf': 'INR=X',  'label': 'INR / USD',    'unit': ''},
}
# Google Sheets CSV fallback: set GSHEET_CSV_URL to a published sheet URL
# containing GOOGLEFINANCE() formulas.  Leave empty to disable.
GSHEET_CSV_URL = ''  # e.g. 'https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv'
MARKET_DATA = {'updated': None, 'tickers': [], 'source': None}

CALENDAR_URL = 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics'
CALENDAR = {'checked': None, 'status': 'pending', 'events': []}
RULES = [
 ('Monetary policy', r'\b(rbi|federal reserve|fed|fomc|repo|rate cut|rate hike|interest rates?|ecb|bank of japan|monetary policy)\b', 5, 'Rates and liquidity can influence valuations, borrowing costs and banks.'),
 ('Economic data', r'\b(cpi|inflation|payrolls?|jobs report|jobs data|employment situation|unemployment|gdp|pmi|producer price|job openings|nonfarm|economic indicators?)\b', 4, 'Compare the release with expectations; the surprise can affect rates and risk appetite.'),
 ('Regulation', r'\b(sebi|circular|derivatives|futures|margin rules|regulat\w*|tariffs?|sanctions?|exchange rules?|trade talks?|trade deals?|trade agreements?|trade negotiations?)\b', 4, 'Check who is covered, whether it is proposed or final, and its effective date.'),
 ('Earnings', r'\b(earnings|quarterly results|guidance|profit|revenue|q[1-4])\b', 3, 'Compare results and guidance with expectations for the company and its sector.'),
 ('Energy & geopolitics', r'\b(crude|oil|opec|war|missile|ceasefire|invasion|strait|shipping|geopolit\w*|hostilities)\b', 4, 'Energy costs and disruption can affect Indian inflation, import costs and exposed sectors.'),
 ('Market flows', r'\b(fii|fpi|dii|treasury|bond yields?|rupee|dollar|foreign investors|nifty|sensex|hang seng|nikkei|kospi|shanghai|msci|equity flows?|market indices|stock market)\b', 2, 'Flows, currency and yields provide context for Indian equity risk appetite.')
]
NOISE = re.compile(r'\b(stocks to buy|buy or sell|multibagger|target price|horoscope|stock recommendations|technical picks|box office|movie review|celebrity|sports betting|iphone deals?)\b', re.I)
MARKET_ACTION = re.compile(r'\b(cuts?|hikes?|holds?|keeps?|raises?|lowers?|beats?|misses?|surges?|jumps?|plunges?|falls?|drops?|rises?|dips?|slumps?|declin\w*|retreat\w*|weak\w*|strengthen\w*|weaken\w*|sell.?offs?|approves?|bans?|releases?|announces?|orders?|suspends?|delays?|tightens?|eases?)\b', re.I)
INDIA_LINK = re.compile(r'\b(india|indian|rbi|sebi|rupee|nifty|sensex|nse|bse|mumbai|new delhi)\b', re.I)
LOW_SIGNAL = re.compile(r'\b(opinion|explainer|what to know|what it means|top stocks|best stocks|should you|price target|analyst pick|reshaped markets|look back|year in review|retrospective|charts indicate|technical indicators|dead cat bounce)\b', re.I)
HISTORICAL = re.compile(r'\b(world war (ii|i|2|1)|century.old|war machine|history of|decades ago)\b', re.I)
GLOBAL_SECONDARY_CB = re.compile(r'\b(ecb|european central bank|bank of japan|boj)\b', re.I)
PERIPHERAL_ECONOMY = re.compile(r'\b(italy|italian|germany|german|france|french|spain|spanish|sweden|swedish|norway|norwegian|switzerland|swiss|netherlands|dutch|australia|australian|canada|canadian|britain|british|uk|united kingdom)\b', re.I)
GLOBAL_EARNINGS_FOCUS = re.compile(r'\b(apple|microsoft|nvidia|alphabet|google|amazon|meta|tesla|accenture|jpmorgan|berkshire|exxon|chevron|tsmc|samsung|walmart|boeing|caterpillar|coca.cola|pepsi)\b', re.I)
COMPANY_SHARE_MOVE = re.compile(r'\b(shares?|share price|stock)\b.{0,70}\b(soars?|surges?|jumps?|rall(?:y|ies)|rises?|falls?|drops?|crashes?|slumps?|plunges?|lower circuit|upper circuit|52.week low|record high)\b|\b(soars?|surges?|jumps?|rall(?:y|ies)|rises?|falls?|drops?|crashes?|slumps?|plunges?)\b.{0,70}\b(shares?|share price|stock)\b', re.I)
INDIA_MATERIAL_ORDER = re.compile(r'\b(order|orders|contract|contracts|wins?)\b', re.I)
LARGE_VALUE = re.compile(r'(₹|\brs\.?\s*|\binr\s*|\$|€)\s*\d|\b\d[\d,.]*\s*(crore|cr|billion|million)\b', re.I)
AVIATION_COST = re.compile(r'\b(airline|airlines|airfares?|fuel surcharge|fuel charges|atf prices?)\b', re.I)
STOP = set('the a an and or to of in for on as at with by is are from after amid says said market markets stock stocks news live updates today'.split())

def assess_story(title, region='Global', official=False):
    """Explainable title-only market relevance score; it is a triage aid, not a forecast."""
    matches = [rule for rule in RULES if re.search(rule[1], title, re.I)]
    if region == 'India' and not matches and COMPANY_SHARE_MOVE.search(title):
        matches.append(('Company move', r'', 3, 'A named company or share-price move may affect that stock and its peers.'))
    if region == 'India' and not matches and INDIA_MATERIAL_ORDER.search(title) and LARGE_VALUE.search(title):
        matches.append(('Company move', r'', 3, 'A large contract or order may affect the company and its sector; check execution and guidance.'))
    if region == 'India' and not matches and AVIATION_COST.search(title):
        matches.append(('Sector & corporate news', r'', 3, 'Airfares, fuel charges and aviation costs can affect airline demand and margins.'))
    if region == 'India' and not matches and GLOBAL_EARNINGS_FOCUS.search(title) and re.search(r'\b(growth beat|results?|guidance|revenue|profit|outlook)\b', title, re.I):
        matches.append(('Earnings', r'', 3, 'Compare results and guidance with expectations for the company and its sector.'))
    if HISTORICAL.search(title):
        matches = [rule for rule in matches if rule[0] != 'Energy & geopolitics']
    if re.search(r'criminal probe|doj|former fed chair', title, re.I):
        matches = [rule for rule in matches if rule[0] != 'Monetary policy']

    category = matches[0][0] if matches else 'Other news'
    score = max((rule[2] for rule in matches), default=0)
    if matches and official:
        score += 1
    if len(matches) > 1:
        score += 1
    if matches and MARKET_ACTION.search(title):
        score += 1
    if region == 'Global' and matches and INDIA_LINK.search(title):
        score += 1
    # Local foreign releases and ordinary overseas earnings rarely move the Indian session.
    if region == 'Global' and 'Economic data' in [rule[0] for rule in matches] and PERIPHERAL_ECONOMY.search(title) and not INDIA_LINK.search(title):
        score -= 3
    if region == 'Global' and 'Earnings' in [rule[0] for rule in matches] and not GLOBAL_EARNINGS_FOCUS.search(title) and not INDIA_LINK.search(title):
        score -= 2
    if region == 'Global' and 'Monetary policy' in [rule[0] for rule in matches] and GLOBAL_SECONDARY_CB.search(title) and not INDIA_LINK.search(title):
        score -= 1
    if LOW_SIGNAL.search(title):
        score -= 1
    if NOISE.search(title):
        score -= 5

    score = max(0, score)
    tier = 'Must know' if score >= 6 else 'Watch' if score >= 3 else 'More'
    if matches:
        reason = matches[0][3]
    elif NOISE.search(title):
        reason = 'Low direct market signal; retained in More for review.'
    else:
        reason = 'No strong market-driver rule matched; retained in More for review.'
    return {'score': score, 'category': category, 'matched': [rule[0] for rule in matches], 'tier': tier, 'reason': reason}

def rescore_story(story):
    """Upgrade cached headlines to the current rules without fetching their publisher again."""
    assessment = assess_story(story.get('title', ''), story.get('region', 'Global'), story.get('official', False))
    # Preserve the existing administrative-notice exception for cached SEBI items.
    source_names = {source.get('name') for source in story.get('sources', [])}
    if 'SEBI' in source_names and re.search(r'recovery certificate|remittance order|release order|settlement order|verification system', story.get('title', ''), re.I):
        assessment = {'score': 0, 'category': 'Other news', 'matched': [], 'tier': 'More', 'reason': 'Routine administrative notice; retained in More for review.'}
    story.update(assessment)
    return story

def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', value or ''))).strip()

def timestamp(value):
    try:
        dt = parsedate_to_datetime(value)
    except (ValueError, TypeError):
        try: dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (ValueError, TypeError): return None
    if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()

def field(item, name):
    return next((x.text or '' for x in item if x.tag.split('}')[-1] == name), '')

def fetch(source):
    status = dict(source, checked=datetime.now(timezone.utc).isoformat(), status='ok', count=0)
    try:
        raw = None
        try:
            from curl_cffi import requests as cffi_requests
            resp = cffi_requests.get(source['url'], impersonate='chrome120', timeout=15)
            if resp.status_code == 200:
                raw = resp.content
        except Exception:
            pass

        if raw is None:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Newsland)',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
            }
            request = Request(source['url'], headers=headers)
            with urlopen(request, timeout=15) as response:
                raw = response.read(3_000_001)

        if len(raw) > 3_000_000: raise ValueError('Feed exceeds size limit')
        root = ET.fromstring(raw)
        entries = [x for x in root.iter() if x.tag.split('}')[-1] in ('item', 'entry')]
        if not entries: raise ValueError('No RSS or Atom entries returned')
        stories = []
        for item in entries[:80]:
            title = clean(field(item, 'title'))
            link = field(item, 'link')
            if not link:
                link = next((x.attrib.get('href', '') for x in item if x.tag.split('}')[-1]=='link' and x.attrib.get('rel','alternate')=='alternate'), '')
            if not title or urlparse(link).scheme not in ('http','https'): continue
            date = timestamp(field(item, 'pubDate') or field(item, 'published') or field(item, 'updated') or field(item, 'date'))
            # Do not publish stale releases as today's news, or future-dated stories.
            if date and (date > time.time()+3600 or time.time()-date > 7*86400): continue
            assessment = assess_story(title, source['region'], source['official'])
            matches = [r for r in RULES if r[0] in assessment['matched']]
            if source['name'] == 'SEBI' and re.search(r'recovery certificate|remittance order|release order|settlement order|verification system', title, re.I):
                assessment = {'score': 0, 'category': 'Other news', 'matched': [], 'tier': 'More', 'reason': 'Routine administrative notice; retained in More for review.'}
            summary = clean(field(item, 'description') or field(item, 'summary') or '')[:350]
            stories.append({'id':hashlib.sha256(link.encode()).hexdigest()[:16], 'title': title,
                'url':link, 'published':date, 'region':source['region'], 'official':source['official'],
                'sources':[{'name':source['name'],'url':link}], 'score':assessment['score'], 'summary': summary,
                'category':assessment['category'], 'reason':assessment['reason'],
                'matched':assessment['matched'], 'tier':assessment['tier']})
        status['count'] = len(stories)
        return stories, status
    except Exception as exc:
        status.update(status='unavailable', error=str(exc)[:180])
        return [], status

# ── Information Intelligence: Entities, Asset Impact & Smart Clustering ──

STOP_WORDS = set('the a an and or to of in for on as at with by is are from after amid says said market markets stock stocks news live updates today what why how who when its their this that these those check here list into over under out up down than then'.split())

def extract_entities(title):
    """Identify macro policymakers, asset classes, and key companies in headline."""
    t = title.lower()
    ents = set()
    if re.search(r'\b(rbi|repo|mpc|shaktikanta|sanjay malhotra)\b', t): ents.add('RBI')
    if re.search(r'\b(fed|fomc|powell|federal reserve)\b', t): ents.add('FED')
    if re.search(r'\b(sebi|madhabi|buch)\b', t): ents.add('SEBI')
    if re.search(r'\b(ecb|lagarde)\b', t): ents.add('ECB')
    if re.search(r'\b(crude|oil|brent|opec)\b', t): ents.add('CRUDE')
    if re.search(r'\b(gold|bullion)\b', t): ents.add('GOLD')
    if re.search(r'\b(silver)\b', t): ents.add('SILVER')
    if re.search(r'\b(rupee|inr|dollar|dxy)\b', t): ents.add('FX')
    if re.search(r'\b(cpi|inflation|wpi)\b', t): ents.add('INFLATION')
    if re.search(r'\b(yields?|treasury|g-sec|bond)\b', t): ents.add('YIELDS')
    if re.search(r'\b(fii|fpi|dii|foreign outflow|foreign inflow)\b', t): ents.add('FLOWS')
    if re.search(r'\b(adani)\b', t): ents.add('ADANI')
    if re.search(r'\b(reliance|ril|jio)\b', t): ents.add('RELIANCE')
    if re.search(r'\b(tata|tcs)\b', t): ents.add('TCS_TATA')
    if re.search(r'\b(hdfc)\b', t): ents.add('HDFC')
    if re.search(r'\b(icici)\b', t): ents.add('ICICI')
    if re.search(r'\b(sbi|state bank)\b', t): ents.add('SBI')
    if re.search(r'\b(infosys|infy)\b', t): ents.add('INFOSYS')
    if re.search(r'\b(airtel|bharti)\b', t): ents.add('AIRTEL')
    if re.search(r'\b(fino payments)\b', t): ents.add('FINO')
    if re.search(r'\b(spacex)\b', t): ents.add('SPACEX')
    if re.search(r'\b(nvidia)\b', t): ents.add('NVIDIA')
    if re.search(r'\b(jefferies)\b', t): ents.add('JEFFERIES')
    if re.search(r'\b(nifty|sensex|dalal street|d-street)\b', t): ents.add('INDICES')
    return ents

def get_impact_assets(title, category, ents):
    """Determine asset classes directly moved by this catalyst."""
    assets = set()
    t = title.lower()
    if 'RBI' in ents or 'FED' in ents or 'YIELDS' in ents or category == 'Monetary policy':
        assets.add('Rates')
    if 'CRUDE' in ents or 'GOLD' in ents or 'SILVER' in ents or category == 'Energy & geopolitics':
        assets.add('Commodities')
    if 'FX' in ents or 'FLOWS' in ents or re.search(r'\b(rupee|inr|dollar|dxy)\b', t):
        assets.add('FX')
    if 'INDICES' in ents or category in ('Earnings', 'Monetary policy', 'Market flows') or any(e in ents for e in ['TCS_TATA', 'RELIANCE', 'ADANI', 'HDFC', 'SBI', 'INFOSYS', 'AIRTEL']):
        assets.add('Equities')
    order = ['Rates', 'Equities', 'Commodities', 'FX']
    return [a for a in order if a in assets] or ['Equities']

def synthesize_why_it_matters(title, category, ents):
    """Generate precise market catalyst explanation instead of generic boilerplate."""
    t = title.lower()
    if 'RBI' in ents and re.search(r'\b(rupee|forex|dollar|window)\b', t):
        return 'This RBI action concerns currency-market liquidity or dollar demand; it is not a repo-rate decision.'
    if 'RBI' in ents or (category == 'Monetary policy' and 'rbi' in t):
        return 'Directly shifts commercial bank cost of funds, repo borrowing rates, and rate-sensitive equity multiples (banks, real estate, auto).'
    if re.search(r'\blisa cook\b', t):
        return 'The dispute concerns Federal Reserve governance and independence; it does not itself announce an interest-rate decision.'
    if 'FED' in ents or (category == 'Monetary policy' and 'fed' in t):
        return 'Guides global liquidity dynamics, US Dollar Index (DXY) trajectory, and foreign institutional (FII) capital allocations.'
    if 'INFLATION' in ents or 'cpi' in t:
        return 'Key determinant of central bank interest rate paths; elevated prints restrict policy easing and compress real yields.'
    if 'CRUDE' in ents or 'oil' in t:
        direction = crude_direction(t)
        if direction == 'DROP':
            return 'Falling crude can ease India’s import bill and input costs for airlines and paints, while reducing upstream oil realizations.'
        if direction == 'SURGE':
            return 'Rising crude can increase India’s import bill and input costs, while supporting upstream oil realizations.'
        return 'Crude affects India’s import bill and energy-sensitive sectors; the headline does not establish a clear price direction.'
    if 'FLOWS' in ents or 'fii' in t:
        return 'Measures institutional risk appetite and liquidity; sustained foreign outflows cap benchmark equity upside.'
    if 'TCS_TATA' in ents or 'earnings' in t or 'q2' in t or category == 'Earnings':
        return 'Directly benchmarks valuation multiples against quarterly operational delivery and forward revenue guidance.'
    if 'SEBI' in ents or category == 'Regulation':
        return 'Alters market structure, compliance mandates, capital allocation rules, and retail derivative trading liquidity.'
    return 'Key market catalyst driving market liquidity and session volatility.'

IMPACT_GRAPH_PATH = DATA / 'impact_graph.json'
IMPACT_GRAPH = {}
if IMPACT_GRAPH_PATH.exists():
    try:
        IMPACT_GRAPH = json.loads(IMPACT_GRAPH_PATH.read_text())
    except Exception:
        pass

def crude_direction(title):
    t = title.lower()
    asset = r'(?:crude|oil|brent)(?: prices?)?'
    down = r'(?:falls?|drops?|slumps?|slides?|eases?|retreats?|dips?|declines?)'
    up = r'(?:rises?|gains?|surges?|jumps?|rallies|climbs?)'
    for direction, action in [('DROP', down), ('SURGE', up)]:
        if re.search(rf'\b{asset}\s+{action}\b|\b{action}\s+(?:in\s+)?{asset}\b', t):
            return direction
    return None


def get_impact_chain(title, category, ents):
    """Deterministic transmission from macro catalysts to winning and losing equity sectors."""
    t = str(title or '').lower()
    
    # 1. Crude Drop vs Surge
    has_oil = bool(re.search(r'\b(crude|brent|opec)\b', t) or (re.search(r'\boil\b', t) and not re.search(r'\b(sunflower|palm|mustard|cooking|edible|olive|soybean)\s+oil\b', t)))
    if has_oil:
        direction = crude_direction(t)
        rule_key = 'CRUDE_' + direction if direction else None
        if rule_key in IMPACT_GRAPH:
            rule = IMPACT_GRAPH[rule_key]
            return {'rule': rule_key, 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # Expected, negated and conditional rate language is not an announced decision.
    if re.search(r'\b(bets?|hopes?|may|might|could|unlikely|rules out|no|expected|expectations?)\b', t):
        return None

    # 2. Rate Cut vs Hike
    if re.search(r'\b(rate cut|repo rate cut|policy easing)\b', t) and not re.search(r'\b(no|unlikely|rules out)\s+rate cut', t):
        if 'RATE_CUT' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['RATE_CUT']
            return {'rule': 'RATE_CUT', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}
    if re.search(r'\b(rate hike|repo rate hike|monetary tightening|fed hike|mpc hike)\b', t) or re.search(r'\brate hikes\b', t):
        if 'RATE_HIKE' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['RATE_HIKE']
            return {'rule': 'RATE_HIKE', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # 3. Rupee Weak vs Strong
    if re.search(r'\b(rupee|inr)\b.{0,25}\b(falls?|drops?|slumps?|slides?|record low|weakens?)\b|\b(falls?|drops?|slumps?|slides?)\b.{0,25}\b(rupee|inr)\b', t):
        if 'INR_WEAK' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['INR_WEAK']
            return {'rule': 'INR_WEAK', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}
    if re.search(r'\b(rupee|inr)\b.{0,25}\b(gains?|rallies|rises?|strengthens?)\b', t):
        if 'INR_STRONG' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['INR_STRONG']
            return {'rule': 'INR_STRONG', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # 4. Gold / Bullion Rally
    if re.search(r'\b(gold|silver|bullion)\b', t) and re.search(r'\b(price|rises?|gains?|surges?|rally|high)\b', t):
        if 'GOLD_RALLY' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['GOLD_RALLY']
            return {'rule': 'GOLD_RALLY', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # 5. Defence Orders & Capex
    if re.search(r'\b(defence|defense)\b', t) and re.search(r'\b(order|orders|procurement|contract|missile|warship)\b', t):
        if 'DEFENCE_ORDERS' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['DEFENCE_ORDERS']
            return {'rule': 'DEFENCE_ORDERS', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # 6. AI & Semiconductor Tech Boom
    if re.search(r'\b(ai chip|ai demand|ai boom|semiconductor|cloud capex)\b', t):
        if 'AI_TECH_BOOM' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['AI_TECH_BOOM']
            return {'rule': 'AI_TECH_BOOM', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    # 7. Metals Spike
    if re.search(r'\b(steel|copper|aluminium|iron ore)\b', t) and re.search(r'\b(prices?|rally|surge|rises?)\b', t):
        if 'METALS_SPIKE' in IMPACT_GRAPH:
            rule = IMPACT_GRAPH['METALS_SPIKE']
            return {'rule': 'METALS_SPIKE', 'catalyst': rule['label'], 'tailwinds': rule['tailwinds'], 'headwinds': rule['headwinds'], 'rationale': rule['rationale']}

    return None

COMPANY_DISPLAY_MAP = {
    'tcs': 'TCS',
    'infosys': 'Infosys',
    'infy': 'Infosys',
    'wipro': 'Wipro',
    'tata elxsi': 'Tata Elxsi',
    'persistent systems': 'Persistent',
    'reliance': 'Reliance',
    'ril': 'Reliance',
    'ongc': 'ONGC',
    'oil india': 'Oil India',
    'bpcl': 'BPCL',
    'asian paints': 'Asian Paints',
    'indigo': 'IndiGo',
    'interglobe aviation': 'IndiGo',
    'mrf': 'MRF',
    'apollo tyres': 'Apollo Tyres',
    'sbi': 'SBI',
    'icici bank': 'ICICI Bank',
    'icici': 'ICICI Bank',
    'hdfc bank': 'HDFC Bank',
    'hdfc': 'HDFC Bank',
    'dlf': 'DLF',
    'godrej properties': 'Godrej Prop',
    'tata motors': 'Tata Motors',
    'bajaj finance': 'Bajaj Finance',
    'sun pharma': 'Sun Pharma',
    'cipla': 'Cipla',
    'voltas': 'Voltas',
    'dixon tech': 'Dixon Tech',
    'havells': 'Havells',
    'titan': 'Titan',
    'kalyan jewellers': 'Kalyan Jewellers',
    'senco gold': 'Senco Gold',
    'muthoot finance': 'Muthoot Fin',
    'tata steel': 'Tata Steel',
    'jsw steel': 'JSW Steel',
    'hindalco': 'Hindalco',
    'vedanta': 'Vedanta',
    'maruti suzuki': 'Maruti Suzuki',
    'maruti': 'Maruti Suzuki',
    'l&t': 'L&T',
    'bel': 'BEL',
    'bharat electronics': 'BEL',
    'hal': 'HAL',
    'mazagon dock': 'Mazagon Dock',
    'solar industries': 'Solar Ind',
    'adani': 'Adani',
    'fino payments': 'Fino Payments',
    'itc': 'ITC',
    'tech mahindra': 'Tech Mahindra',
    'hcl tech': 'HCL Tech',
    'ntpc': 'NTPC',
    'ioc': 'IOC',
    'tsmc': 'TSMC',
    'nvidia': 'Nvidia',
    'apple': 'Apple',
}

def extract_company_entities(title):
    """Extract named corporate entities from headline for instant X-Ray inspection."""
    t_low = str(title or '').lower()
    found = []
    seen = set()
    for k in sorted(COMPANY_DISPLAY_MAP.keys(), key=lambda x: -len(x)):
        pattern = r'\b' + re.escape(k) + r'\b'
        if re.search(pattern, t_low):
            disp = COMPANY_DISPLAY_MAP[k]
            if disp not in seen:
                found.append({'name': disp, 'symbol': k})
                seen.add(disp)
    return found

COMMON_FILLER_WORDS = set('''
the a an and or to of in for on as at with by is are was were from after amid says said market markets stock stocks news live updates today what why how who when its their this that these those check here list into over under out up down than then share shares price prices point points gain gains jump jumps surge surges rally rallies rise rises slump slumps drop drops crash crashes tank tanks fall falls details ahead lies strong weak best top decode vs experts expert buzz buzzing trend trending key factors reasons behind buck trend day
'''.split())

def normalize_title(title):
    t = str(title or '').lower()
    t = re.sub(r'\bbiz\b', 'business', t)
    t = re.sub(r'\bpts?\b', 'points', t)
    t = re.sub(r'\bresults?\b', 'earnings', t)
    t = re.sub(r'\brs\.?\b', '', t)
    t = re.sub(r'₹', '', t)
    t = re.sub(r'\bcrores?\b', 'cr', t)
    t = re.sub(r'[^\w\s%]', ' ', t)
    return t

def extract_primary_subject(title):
    t = str(title or '').lower()
    companies = [
        ('senco gold', r'senco\s*gold'),
        ('fino payments', r'fino(\s*payments)?(\s*bank)?'),
        ('pc jeweller', r'pc\s*jeweller'),
        ('tcs', r'\btcs\b'),
        ('infosys', r'\b(infosys|infy)\b'),
        ('hcl tech', r'hcl\s*tech'),
        ('tech mahindra', r'tech\s*mahindra'),
        ('wipro', r'\bwipro\b'),
        ('hdfc bank', r'\bhdfc(\s*bank)?\b'),
        ('icici bank', r'\bicici(\s*bank)?\b'),
        ('sbi', r'\b(sbi|state\s*bank)\b'),
        ('axis bank', r'axis\s*bank'),
        ('kotak bank', r'kotak(\s*mahindra)?\s*bank'),
        ('adani', r'\badani\b'),
        ('reliance', r'\b(reliance|ril|jio)\b'),
        ('tata motors', r'tata\s*motors'),
        ('maruti', r'\bmaruti\b'),
        ('l&t', r'\b(l&t|larson)\b'),
        ('vedanta', r'\bvedanta\b'),
        ('tsmc', r'\btsmc\b'),
        ('samsung', r'\bsamsung\b'),
        ('nvidia', r'\bnvidia\b'),
        ('apple', r'\bapple\b'),
        ('accenture', r'\baccenture\b'),
        ('ifci', r'\bifci\b'),
        ('gm breweries', r'gm\s*breweries'),
    ]
    for name, pat in companies:
        if re.search(pat, t):
            return name
    return None

def substantive_tokens(title):
    t = normalize_title(title)
    words = re.findall(r'[a-z0-9]+', t)
    return {w for w in words if w not in COMMON_FILLER_WORDS and len(w) > 2 and not w.endswith('%')}

def sig_words(title):
    return substantive_tokens(title)

def should_cluster(s1, s2):
    """Intelligently check if two stories from different outlets report the same market event."""
    t1 = s1.get('published') or 0
    t2 = s2.get('published') or 0
    if abs(t1 - t2) > 48 * 3600:
        return False

    # Protection for distinct numerical policy rate changes (e.g. 5.5% vs 5.0%)
    r1 = re.findall(r'(?:repo rate|policy rate|interest rate)\s*(\d+(?:\.\d+)?%?)', s1.get('title', '').lower())
    r2 = re.findall(r'(?:repo rate|policy rate|interest rate)\s*(\d+(?:\.\d+)?%?)', s2.get('title', '').lower())
    if r1 and r2 and r1 != r2:
        return False

    subj1 = extract_primary_subject(s1.get('title', ''))
    subj2 = extract_primary_subject(s2.get('title', ''))

    # If both specifically name different companies, they must never cluster
    if subj1 and subj2 and subj1 != subj2:
        return False
    if (subj1 is not None) != (subj2 is not None):
        return False

    w1 = substantive_tokens(s1.get('title', ''))
    w2 = substantive_tokens(s2.get('title', ''))
    if not w1 or not w2:
        return False

    inter = w1 & w2
    min_len = min(len(w1), len(w2))
    jaccard = len(inter) / len(w1 | w2)

    # 1. Same named company/corporate entity
    if subj1 and subj2 and subj1 == subj2:
        if len(inter) >= 2 or jaccard >= 0.25:
            return True
        return False

    # 2. Key Macro / Benchmark Event Domains
    t1_low = s1.get('title', '').lower()
    t2_low = s2.get('title', '').lower()

    # Conflicting oil directions should not be presented as corroborating coverage.
    oil1, oil2 = crude_direction(t1_low), crude_direction(t2_low)
    if oil1 and oil2 and oil1 != oil2:
        return False

    # Same named governance dispute, with matching event intent.
    if all(re.search(r'\bcook\b', t) and 'fed' in t and 'trump' in t and re.search(r'\b(hearing|inquiry)\b', t) for t in (t1_low, t2_low)):
        return True

    # Energy / Crude Oil
    if bool(re.search(r'\b(crude|brent|oil|opec)\b', t1_low)) and bool(re.search(r'\b(crude|brent|oil|opec)\b', t2_low)):
        if len(inter) >= 2 or jaccard >= 0.25:
            return True

    # Precious Metals (Gold / Silver)
    if bool(re.search(r'\b(gold|silver|bullion)\b', t1_low)) and bool(re.search(r'\b(gold|silver|bullion)\b', t2_low)):
        if len(inter) >= 2 or jaccard >= 0.25:
            return True

    # Central Bank / RBI / Fed Rate Decision
    if bool(re.search(r'\b(rbi|repo|mpc|fed|fomc)\b', t1_low)) and bool(re.search(r'\b(rbi|repo|mpc|fed|fomc)\b', t2_low)):
        if bool(re.search(r'\b(rate hike|rate cut|repo rate|policy rate|interest rate|rates|tightening)\b', t1_low)) and bool(re.search(r'\b(rate hike|rate cut|repo rate|policy rate|interest rate|rates|tightening)\b', t2_low)):
            if len(inter) >= 2 or jaccard >= 0.25:
                return True

    # Intraday Benchmark Crash / Market Fall Live Coverage
    if bool(re.search(r'\b(sensex|nifty|market)\b', t1_low)) and bool(re.search(r'\b(sensex|nifty|market)\b', t2_low)):
        if any(re.search(rf'\b{w}\b', t1_low) for w in ['crash', 'down', 'slump', 'tank', 'fall', 'live']) and any(re.search(rf'\b{w}\b', t2_low) for w in ['crash', 'down', 'slump', 'tank', 'fall', 'live']):
            return True

    # Regulatory Mandates (e.g. Risk-o-meter for debt)
    if 'risk-o-meter' in t1_low and 'risk-o-meter' in t2_low:
        return True

    # 3. General Cross-Outlet Wire Deduplication
    if jaccard >= 0.38 or (min_len >= 4 and len(inter) / min_len >= 0.60):
        return True

    return False

def group(stories):
    """Intelligently cluster multi-source stories, deduplicate coverage, and enrich with market context."""
    # Sort by initial score and recency
    sorted_stories = sorted(stories, key=lambda s: (s.get('score', 0) or 0, s.get('published', 0) or 0), reverse=True)
    clusters = []

    for story in sorted_stories:
        matched = None
        for c in clusters:
            if should_cluster(story, c):
                matched = c
                break

        if matched:
            # Merge sources (avoiding duplicate names)
            existing_names = {src['name'] for src in matched['sources']}
            for src in story.get('sources', []):
                if src['name'] not in existing_names:
                    matched['sources'].append(src)
                    existing_names.add(src['name'])

            # Add alternative reporting angles
            if 'related' not in matched:
                matched['related'] = []
            if story['title'] != matched['title'] and not any(r['title'] == story['title'] for r in matched['related']):
                src_name = story['sources'][0]['name'] if story.get('sources') else ''
                matched['related'].append({
                    'title': story['title'],
                    'url': story.get('url', '') or (story.get('sources', [{}])[0].get('url', '')),
                    'source': src_name,
                    'published': story.get('published')
                })
        else:
            clusters.append(dict(story, related=[]))

    # Enrich clusters with Multi-Source Confirmation Boost & Catalyst Intelligence
    for c in clusters:
        num_sources = len(c.get('sources', []))
        c['cluster_count'] = num_sources
        
        # Multi-Source Confirmation Boost:
        # Multiple independent newsrooms reporting on an event signals high market velocity
        boost = 0
        if num_sources >= 4:
            boost = 5
        elif num_sources >= 3:
            boost = 4
        elif num_sources >= 2:
            boost = 2

        c['score'] = (c.get('score', 0) or 0) + boost
        c['tier'] = 'Must know' if c['score'] >= 6 else 'Watch' if c['score'] >= 3 else 'More'

        ents = extract_entities(c['title'])
        c['impact_assets'] = get_impact_assets(c['title'], c.get('category'), ents)
        c['why_it_matters'] = synthesize_why_it_matters(c['title'], c.get('category'), ents)
        c['impact_chain'] = get_impact_chain(c['title'], c.get('category'), ents)
        c['companies'] = extract_company_entities(c['title'])
        # Upgrade reason to the rich synthesized context if it is stronger
        if not c.get('reason') or 'No strong market-driver' in c['reason'] or 'Rates and liquidity can influence' in c['reason']:
            c['reason'] = c['why_it_matters']

    # Final sort: composite score + confirmation boost + session freshness
    def _cluster_rank(s):
        score = float(s.get('score', 0) or 0)
        pub = s.get('published') or 0
        age_h = (time.time() - pub) / 3600 if pub else 999
        if age_h < 1: rec = 5.0
        elif age_h < 3: rec = 3.5
        elif age_h < 6: rec = 1.5
        elif age_h < 10: rec = 0.0
        elif age_h < 16: rec = -3.0
        elif age_h < 24: rec = -5.5
        else: rec = -8.0
        return score + rec

    return sorted(clusters, key=lambda s: (_cluster_rank(s), s.get('published', 0) or 0), reverse=True)

def refresh():
    global CACHE
    if not LOCK.acquire(blocking=False): return
    CACHE['refreshing']=True
    try:
        sources=json.loads((ROOT/'sources.json').read_text())
        with ThreadPoolExecutor(max_workers=5) as pool: results=list(pool.map(fetch, sources))
        stories=[story for items,_ in results for story in items]
        # Retain prior feed entries on an outage, never mark them freshly fetched.
        failed={status['name'] for _,status in results if status['status']!='ok'}
        for old in CACHE['stories']:
            if any(src['name'] in failed for src in old['sources']):
                retained=dict(old, stale=True)
                if not retained['published'] or time.time()-retained['published'] <=7*86400: stories.append(retained)
        CACHE={'updated':datetime.now(timezone.utc).isoformat(), 'stories':group(stories), 'sources':[s for _,s in results], 'refreshing':False}
        temp=DATA/'cache.tmp'
        temp.write_text(json.dumps(CACHE)); temp.replace(DATA/'cache.json')
    finally:
        CACHE['refreshing']=False
        LOCK.release()

def refresh_calendar():
    global CALENDAR
    if CALENDAR['checked'] and time.time()-CALENDAR['checked'] < 3600: return
    try:
        with urlopen(Request(CALENDAR_URL, headers={'User-Agent':'Newsland/0.1 (personal calendar reader)'}), timeout=15) as response:
            raw = response.read(1_000_000).decode('utf-8')
        raw = re.sub(r'\r?\n[ \t]', '', raw)
        events=[]
        for block in raw.split('BEGIN:VEVENT')[1:]:
            title=re.search(r'^SUMMARY:(.*)$', block, re.M)
            start=re.search(r'^DTSTART[^:]*:(\d{8}T\d{6}Z)', block, re.M)
            if not title or not start: continue
            dt=datetime.strptime(start[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
            if time.time()-86400 <= dt.timestamp() <= time.time()+35*86400:
                events.append({'title':clean(title[1].replace('\\,', ',').replace('\\;', ';')), 'at':dt.isoformat(), 'source':CALENDAR_URL, 'verified':True})
        CALENDAR={'checked':time.time(), 'status':'ok', 'events':events}
        (DATA/'calendar.json').write_text(json.dumps(CALENDAR))
    except Exception as exc:
        CALENDAR=dict(CALENDAR, checked=time.time(), status='unavailable', error=str(exc)[:180])


# ── Market Data Refresh ────────────────────────────────────────────────

def _fmt_price(val, key):
    """Format price for display: integers for indices, 2 decimals otherwise."""
    if key in ('SENSEX', 'NIFTY'):
        return f'{val:,.0f}'
    return f'{val:,.2f}'

def _fetch_yfinance():
    """Primary: fetch all 6 instruments via yfinance."""
    import yfinance as yf
    tickers_data = []
    for key, cfg in MARKET_SYMBOLS.items():
        t = yf.Ticker(cfg['yf'])
        fi = t.fast_info
        history = t.history(period='5d')
        quote_date = str(history.index[-1].date()) if not history.empty else None
        price = fi.last_price
        prev = fi.previous_close
        if price is None or prev is None or prev == 0:
            continue
        chg = price - prev
        pct = (chg / prev) * 100

        # Tipsheet-style 52-week range & position context
        year_high = getattr(fi, 'year_high', None)
        year_low = getattr(fi, 'year_low', None)
        range_52w = None
        if year_high is not None and year_low is not None and year_high > year_low and price is not None:
            pos_pct = round(max(0.0, min(100.0, (price - year_low) / (year_high - year_low) * 100)), 1)
            pct_from_high = round((price - year_high) / year_high * 100, 2)
            range_52w = {
                'low': round(year_low, 2),
                'high': round(year_high, 2),
                'low_fmt': _fmt_price(year_low, key),
                'high_fmt': _fmt_price(year_high, key),
                'pos_pct': pos_pct,
                'pct_from_high': pct_from_high,
            }

        tickers_data.append({
            'key': key,
            'quote_date': quote_date,
            'label': cfg['label'],
            'price': _fmt_price(price, key),
            'price_raw': round(price, 4),
            'prev_close': round(prev, 4),
            'prev_close_fmt': _fmt_price(prev, key),
            'change': round(chg, 4),
            'change_pct': round(pct, 2),
            'direction': 'up' if pct >= 0 else 'down',
            'unit': cfg['unit'],
            'range_52w': range_52w,
        })
    return tickers_data

def _fetch_gsheet():
    """Fallback: fetch market data from a published Google Sheet CSV."""
    if not GSHEET_CSV_URL:
        return []
    req = Request(GSHEET_CSV_URL, headers={'User-Agent': 'Newsland/0.1'})
    with urlopen(req, timeout=15) as resp:
        raw = resp.read().decode('utf-8')
    reader = csv.DictReader(io.StringIO(raw))
    tickers_data = []
    for row in reader:
        key = row.get('key', '').strip().upper()
        if key not in MARKET_SYMBOLS:
            continue
        cfg = MARKET_SYMBOLS[key]
        try:
            price = float(row.get('price', 0))
            pct = float(row.get('change_pct', 0))
        except (ValueError, TypeError):
            continue
        prev = price / (1 + pct / 100) if pct != 0 else price
        chg = price - prev
        tickers_data.append({
            'key': key,
            'label': cfg['label'],
            'price': _fmt_price(price, key),
            'price_raw': round(price, 4),
            'prev_close': round(prev, 4),
            'prev_close_fmt': _fmt_price(prev, key),
            'change': round(chg, 4),
            'change_pct': round(pct, 2),
            'direction': 'up' if pct >= 0 else 'down',
            'unit': cfg['unit'],
        })
    return tickers_data

def refresh_market():
    """Refresh market ticker data: yfinance primary, Google Sheets fallback."""
    global MARKET_DATA
    if not MARKET_LOCK.acquire(blocking=False):
        return
    try:
        tickers = []
        source = None
        # Primary: yfinance
        try:
            tickers = _fetch_yfinance()
            source = 'yfinance'
        except Exception as exc:
            print(f'[market] yfinance failed: {exc}', flush=True)
        # Fallback: Google Sheets CSV
        if not tickers and GSHEET_CSV_URL:
            try:
                tickers = _fetch_gsheet()
                source = 'gsheet'
            except Exception as exc:
                print(f'[market] Google Sheets fallback failed: {exc}', flush=True)
        if tickers:
            MARKET_DATA = {
                'updated': datetime.now(timezone.utc).isoformat(),
                'tickers': tickers,
                'source': source,
            }
            temp = DATA / 'market.tmp'
            temp.write_text(json.dumps(MARKET_DATA))
            temp.replace(DATA / 'market.json')
            print(f'[market] Updated {len(tickers)} tickers via {source}', flush=True)
        else:
            print('[market] No ticker data available from any source', flush=True)
    finally:
        MARKET_LOCK.release()


# ── Pre-Market Trading Desk Brief ─────────────────────────────────────
PREMARKET_DATA = {}

def flow_context(flows):
    if not flows:
        return 'Institutional flows unavailable: a dated source is required.'
    fii, dii = flows['fii_net_cr'], flows['dii_net_cr']
    net = fii + dii
    offset = ' DII buying partially offsets FII selling.' if fii < 0 < dii and net < 0 else ''
    return f"FII {fii:+,.0f} crore; DII {dii:+,.0f} crore. Combined net {'buying' if net >= 0 else 'selling'} ₹{abs(net):,.0f} crore.{offset}"


def pivot_context(price, levels):
    if not levels:
        return 'Pivot levels unavailable.'
    relation = 'above' if price > levels['pivot'] else 'below' if price < levels['pivot'] else 'at'
    overhead = [levels[k] for k in ('r1', 'r2') if levels[k] > price]
    return (f"Latest Nifty reading is {relation} the {levels['pivot']:,} pivot. " +
            (f"Next calculated resistance above this reading: {min(overhead):,}." if overhead else
             'The reading is above both calculated resistance levels.') +
            ' Pivots are calculated references, not confirmed support or resistance.')


def refresh_premarket():
    """Build a dated briefing from observed data; never substitute modelled quotes."""
    global PREMARKET_DATA
    now = datetime.now(timezone.utc)
    ist = now.astimezone(timezone(timedelta(hours=5, minutes=30)))
    tickers = {x['key']: x for x in MARKET_DATA.get('tickers', [])}
    nifty = tickers.get('NIFTY')
    overnight, pivots = {}, {}
    posture = None
    sector_breadth = None
    try:
        import yfinance as yf
        for key, symbol in [('SP500', '^GSPC'), ('NASDAQ', '^IXIC'), ('US10Y', '^TNX')]:
            try:
                history = yf.Ticker(symbol).history(period='5d')
                if len(history) < 2:
                    continue
                price, prev = float(history.iloc[-1]['Close']), float(history.iloc[-2]['Close'])
                overnight[key] = {'val': f'{price:,.0f}' if key != 'US10Y' else f'{price:.2f}%',
                                  'pct': round((price / prev - 1) * 100, 2),
                                  'date': str(history.index[-1].date())}
            except Exception:
                pass
        for key, symbol in [('nifty', '^NSEI'), ('banknifty', '^NSEBANK')]:
            try:
                history = yf.Ticker(symbol).history(period='5d')
                # Use the last completed daily candle, including Friday on weekends.
                completed = history[[d.date() < ist.date() or (d.date() == ist.date() and ist.hour * 60 + ist.minute >= 930) for d in history.index]]
                if completed.empty:
                    continue
                row = completed.iloc[-1]
                high, low, close = float(row['High']), float(row['Low']), float(row['Close'])
                pivot = (high + low + close) / 3
                pivots[key] = dict(pivot=round(pivot), s1=round(2*pivot-high), r1=round(2*pivot-low),
                                   s2=round(pivot-high+low), r2=round(pivot+high-low),
                                   date=str(completed.index[-1].date()))
            except Exception:
                pass

        # Tipsheet-style Market Regime & Moving Averages for Nifty 50
        try:
            nifty_hist = yf.Ticker('^NSEI').history(period='1y')
            if not nifty_hist.empty and len(nifty_hist) >= 50:
                c = float(nifty_hist['Close'].iloc[-1])
                dma50 = float(nifty_hist['Close'].tail(50).mean())
                dma200 = float(nifty_hist['Close'].tail(200).mean()) if len(nifty_hist) >= 200 else None
                high52 = float(nifty_hist['High'].max())
                low52 = float(nifty_hist['Low'].min())
                pct_50 = round((c / dma50 - 1) * 100, 2)
                pct_200 = round((c / dma200 - 1) * 100, 2) if dma200 else None
                pct_high52 = round((c - high52) / high52 * 100, 2)
                pos_52 = round(max(0.0, min(100.0, (c - low52) / (high52 - low52) * 100)), 1) if high52 > low52 else None

                if dma200:
                    if c >= dma50 and c >= dma200:
                        regime = 'STRUCTURAL UPTREND'
                    elif c < dma50 and c >= dma200:
                        regime = 'PULLBACK IN UPTREND'
                    elif c >= dma50 and c < dma200:
                        regime = 'COUNTER-TREND RALLY'
                    else:
                        regime = 'CORRECTIVE TREND'
                else:
                    regime = 'ABOVE 50-DMA' if c >= dma50 else 'BELOW 50-DMA'

                posture = {
                    'dma50': round(dma50),
                    'dma50_fmt': f'{round(dma50):,}',
                    'pct_dma50': pct_50,
                    'dma200': round(dma200) if dma200 else None,
                    'dma200_fmt': f'{round(dma200):,}' if dma200 else None,
                    'pct_dma200': pct_200,
                    'high52': round(high52),
                    'high52_fmt': f'{round(high52):,}',
                    'low52': round(low52),
                    'low52_fmt': f'{round(low52):,}',
                    'pct_from_high52': pct_high52,
                    'pos_52w': pos_52,
                    'regime': regime
                }
        except Exception:
            pass

        # Tipsheet-style Sector Breadth across core NSE sectors
        try:
            sector_symbols = {'Bank': '^NSEBANK', 'IT': '^CNXIT', 'Auto': '^CNXAUTO', 'FMCG': '^CNXFMCG', 'Metal': '^CNXMETAL'}
            sector_list = []
            for s_name, s_sym in sector_symbols.items():
                try:
                    s_fi = yf.Ticker(s_sym).fast_info
                    sp, sprev = s_fi.last_price, s_fi.previous_close
                    if sp and sprev:
                        spct = round((sp / sprev - 1) * 100, 2)
                        sector_list.append({'name': s_name, 'pct': spct})
                except Exception:
                    pass
            if sector_list:
                up_c = sum(1 for s in sector_list if s['pct'] > 0)
                sector_list.sort(key=lambda s: s['pct'], reverse=True)
                sector_breadth = {
                    'advances': up_c,
                    'total': len(sector_list),
                    'sectors': sector_list,
                    'summary': f'{up_c}/{len(sector_list)} sectors in green'
                }
        except Exception:
            pass
    except ImportError:
        pass
    flows = None
    try:
        candidate = json.loads((DATA / 'flows.json').read_text())
        if candidate.get('verified') is True and candidate.get('date') and str(candidate.get('source', '')).startswith('https://'):
            if all(isinstance(candidate.get(k), (int, float)) for k in ('fii_net_cr', 'dii_net_cr')):
                flows = dict(candidate, net_cr=candidate['fii_net_cr']+candidate['dii_net_cr'])
    except (OSError, ValueError):
        pass
    drivers = [{'num': '01', 'title': 'Institutional flows', 'bias': 'Context', 'desc': flow_context(flows)}]
    brent = tickers.get('BRENT')
    if brent:
        drivers.append({'num': '02', 'title': 'Crude and input costs', 'bias': 'Context',
                        'desc': f"Latest Brent quote: {brent['price']} USD/bbl ({brent['change_pct']:+.2f}%). Higher crude can raise import and input costs; lower crude can ease them. This quote alone does not establish the cause of the move."})
    takeaway = 'Benchmark data unavailable.'
    if nifty:
        takeaway = f"Latest available Nifty quote: {nifty['price']} ({nifty['change_pct']:+.2f}% versus previous close). "
        takeaway += pivot_context(nifty['price_raw'], pivots.get('nifty'))
        if posture:
            dma200_part = f", {posture['pct_dma200']:+.1f}% vs 200-DMA" if posture.get('pct_dma200') is not None else ''
            takeaway += f" Market regime: {posture['regime']} ({posture['pct_from_high52']:+.1f}% from 52W peak{dma200_part})."
        if sector_breadth:
            takeaway += f" Sector breadth: {sector_breadth['summary']}."

        if posture and sector_breadth:
            lead = sector_breadth['sectors'][0]
            dma_desc = f"{abs(posture['pct_dma200']):.1f}% {'above' if (posture['pct_dma200'] or 0) >= 0 else 'below'} 200-DMA ({posture['dma200_fmt']})" if posture.get('dma200') else f"{abs(posture['pct_dma50']):.1f}% vs 50-DMA ({posture['dma50_fmt']})"
            drivers.append({'num': '03', 'title': 'Market posture & breadth', 'bias': 'Context',
                            'desc': f"Nifty is {abs(posture['pct_from_high52']):.1f}% below 52W high ({posture['high52_fmt']}), trading {dma_desc}. Sector participation: {sector_breadth['summary']} (Top: {lead['name']} {lead['pct']:+.2f}%)."})
        else:
            drivers.append({'num': '03', 'title': 'Benchmark change', 'bias': 'Context',
                            'desc': 'The index change measures benchmark performance. Breadth and buyer identity cannot be inferred from this quote.'})
    PREMARKET_DATA = dict(updated=now.isoformat(), schema_version=2, is_live=False,
        quote_updated=MARKET_DATA.get('updated'), quote_date=nifty.get('quote_date') if nifty else None,
        quote_source=MARKET_DATA.get('source'), live_bias_label='LATEST AVAILABLE QUOTE', bias_label='LATEST AVAILABLE QUOTE',
        live_nifty_price=nifty['price'] if nifty else '--', live_pts=round(nifty['change']) if nifty else None,
        live_pct=nifty['change_pct'] if nifty else None, nifty_prev_close=nifty.get('prev_close_fmt', '--') if nifty else '--',
        fii_dii=flows, overnight=overnight, brent=brent, usdinr=tickers.get('USDINR'), pivots=pivots,
        posture=posture, sector_breadth=sector_breadth,
        session_drivers=drivers, trader_take=takeaway)
    temp = DATA / 'premarket.tmp'
    temp.write_text(json.dumps(PREMARKET_DATA))
    temp.replace(DATA / 'premarket.json')



def scheduled():
    refresh_market()
    refresh_premarket()
    while True:
        refresh(); refresh_calendar(); time.sleep(INTERVAL)

def market_scheduled():
    """Separate loop for market data on its own cadence."""
    while True:
        time.sleep(MARKET_INTERVAL)
        refresh_market()
        refresh_premarket()

def get_all_events():
    """Return unified, verified financial catalysts sorted chronologically."""
    events = json.loads((DATA/'events.json').read_text()) if (DATA/'events.json').exists() else []
    seen = {e['title'].lower().strip() for e in events}
    for e in CALENDAR.get('events', []):
        t = e.get('title', '').lower().strip()
        if t not in seen:
            events.append({
                'id': f"bea-{hashlib.md5(t.encode()).hexdigest()[:8]}",
                'title': e.get('title'),
                'at': e.get('at'),
                'category': 'Macro Data',
                'country': 'US',
                'country_code': 'US',
                'impact': 'HIGH' if ('gdp' in t or 'personal income' in t) else 'MEDIUM',
                'assets': ['Rates', 'Equities', 'FX'],
                'what_to_watch': 'Official U.S. Bureau of Economic Analysis release; tracks consumer demand and quarterly GDP revisions.',
                'source': e.get('source', 'https://www.bea.gov'),
                'verified': True
            })
            seen.add(t)
    return sorted(events, key=lambda x: x.get('at', ''))

# ── Company Financial X-Ray Engine ────────────────────────────────────
COMPANY_TICKERS = {
    'tcs': ('TCS.NS', 'Tata Consultancy Services Ltd', 'IT Services'),
    'infosys': ('INFY.NS', 'Infosys Ltd', 'IT Services'),
    'infy': ('INFY.NS', 'Infosys Ltd', 'IT Services'),
    'wipro': ('WIPRO.NS', 'Wipro Ltd', 'IT Services'),
    'tata elxsi': ('TATAELXSI.NS', 'Tata Elxsi Ltd', 'IT / ER&D'),
    'persistent systems': ('PERSISTENT.NS', 'Persistent Systems Ltd', 'IT Services'),
    'reliance': ('RELIANCE.NS', 'Reliance Industries Ltd', 'Oil & Conglomerate'),
    'ril': ('RELIANCE.NS', 'Reliance Industries Ltd', 'Oil & Conglomerate'),
    'ongc': ('ONGC.NS', 'Oil & Natural Gas Corp', 'Upstream Oil & Gas'),
    'oil india': ('OIL.NS', 'Oil India Ltd', 'Upstream Oil & Gas'),
    'bpcl': ('BPCL.NS', 'Bharat Petroleum Corp', 'Oil Marketing (OMC)'),
    'asian paints': ('ASIANPAINT.NS', 'Asian Paints Ltd', 'Paints & Coatings'),
    'indigo': ('INDIGO.NS', 'InterGlobe Aviation Ltd', 'Airlines / Aviation'),
    'interglobe aviation': ('INDIGO.NS', 'InterGlobe Aviation Ltd', 'Airlines / Aviation'),
    'mrf': ('MRF.NS', 'MRF Ltd', 'Tyres & Rubber'),
    'apollo tyres': ('APOLLOTYRE.NS', 'Apollo Tyres Ltd', 'Tyres & Rubber'),
    'sbi': ('SBIN.NS', 'State Bank of India', 'Public Sector Banking'),
    'icici bank': ('ICICIBANK.NS', 'ICICI Bank Ltd', 'Private Banking'),
    'hdfc bank': ('HDFCBANK.NS', 'HDFC Bank Ltd', 'Private Banking'),
    'hdfc': ('HDFCBANK.NS', 'HDFC Bank Ltd', 'Private Banking'),
    'dlf': ('DLF.NS', 'DLF Ltd', 'Real Estate Development'),
    'godrej properties': ('GODREJPROP.NS', 'Godrej Properties Ltd', 'Real Estate Development'),
    'tata motors': ('TATAMOTORS.NS', 'Tata Motors Ltd', 'Automobile OEM'),
    'bajaj finance': ('BAJFINANCE.NS', 'Bajaj Finance Ltd', 'NBFC / Lending'),
    'sun pharma': ('SUNPHARMA.NS', 'Sun Pharmaceutical Inds', 'Pharmaceuticals'),
    'cipla': ('CIPLA.NS', 'Cipla Ltd', 'Pharmaceuticals'),
    'voltas': ('VOLTAS.NS', 'Voltas Ltd', 'Consumer Durables'),
    'dixon tech': ('DIXON.NS', 'Dixon Technologies Ltd', 'Electronics Manufacturing'),
    'havells': ('HAVELLS.NS', 'Havells India Ltd', 'Electrical & Consumer'),
    'titan': ('TITAN.NS', 'Titan Company Ltd', 'Gems & Jewellery'),
    'kalyan jewellers': ('KALYANKJIL.NS', 'Kalyan Jewellers India', 'Gems & Jewellery'),
    'senco gold': ('SENCO.NS', 'Senco Gold Ltd', 'Gems & Jewellery'),
    'muthoot finance': ('MUTHOOTFIN.NS', 'Muthoot Finance Ltd', 'Gold Loan NBFC'),
    'tata steel': ('TATASTEEL.NS', 'Tata Steel Ltd', 'Metals & Mining'),
    'jsw steel': ('JSWSTEEL.NS', 'JSW Steel Ltd', 'Metals & Mining'),
    'hindalco': ('HINDALCO.NS', 'Hindalco Industries Ltd', 'Metals & Aluminium'),
    'vedanta': ('VEDL.NS', 'Vedanta Ltd', 'Diversified Natural Resources'),
    'maruti suzuki': ('MARUTI.NS', 'Maruti Suzuki India Ltd', 'Automobile OEM'),
    'maruti': ('MARUTI.NS', 'Maruti Suzuki India Ltd', 'Automobile OEM'),
    'l&t': ('LT.NS', 'Larsen & Toubro Ltd', 'Infrastructure & Defence'),
    'bel': ('BEL.NS', 'Bharat Electronics Ltd', 'Defence Electronics'),
    'bharat electronics': ('BEL.NS', 'Bharat Electronics Ltd', 'Defence Electronics'),
    'hal': ('HAL.NS', 'Hindustan Aeronautics Ltd', 'Aerospace & Defence'),
    'mazagon dock': ('MAZDOCK.NS', 'Mazagon Dock Shipbuilders', 'Defence Shipbuilding'),
    'solar industries': ('SOLARINDS.NS', 'Solar Industries India', 'Defence Explosives'),
    'adani': ('ADANIENT.NS', 'Adani Enterprises Ltd', 'Infrastructure & Energy'),
    'fino payments': ('FINOPB.NS', 'Fino Payments Bank', 'Fintech / Banking'),
    'itc': ('ITC.NS', 'ITC Ltd', 'FMCG & Conglomerate'),
    'tech mahindra': ('TECHM.NS', 'Tech Mahindra Ltd', 'IT Services'),
    'hcl tech': ('HCLTECH.NS', 'HCL Technologies Ltd', 'IT Services'),
    'ntpc': ('NTPC.NS', 'NTPC Ltd', 'Power Generation'),
    'ioc': ('IOC.NS', 'Indian Oil Corp', 'Oil Marketing (OMC)'),
    'tsmc': ('TSM', 'Taiwan Semiconductor Mfg', 'Semiconductors'),
    'nvidia': ('NVDA', 'NVIDIA Corporation', 'AI Semiconductors'),
    'apple': ('AAPL', 'Apple Inc', 'Consumer Electronics')
}

COMPANY_CACHE = {}

def get_company_xray(query):
    """Retrieve financial metrics, 52-week envelope, and Newsland coverage for a company."""
    global COMPANY_CACHE
    q = (query or '').strip().lower()
    if not q:
        return {'error': 'No company specified'}

    now = time.time()
    if q in COMPANY_CACHE and (now - COMPANY_CACHE[q]['time'] < 300):
        return COMPANY_CACHE[q]['data']

    symbol_info = COMPANY_TICKERS.get(q)
    if not symbol_info:
        for k, v in COMPANY_TICKERS.items():
            if q == k or q in k or k in q:
                symbol_info = v
                break

    if symbol_info:
        symbol, name, sector = symbol_info
    else:
        base = q.upper().replace('.NS', '').replace('.BO', '')
        symbol = f"{base}.NS"
        name = query.title()
        sector = 'Equities'

    is_inr = symbol.endswith('.NS') or symbol.endswith('.BO')
    currency_prefix = '₹' if is_inr else '$'

    result = {
        'symbol': symbol,
        'name': name,
        'sector': sector,
        'price': '--',
        'price_raw': 0,
        'change': 0,
        'change_pct': 0,
        'direction': 'neutral',
        'prev_close': '--',
        'high_52w': '--',
        'low_52w': '--',
        'high_52w_raw': None,
        'low_52w_raw': None,
        'pe_ratio': None,
        'market_cap_cr': '--',
        'stories': []
    }

    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        fi = t.fast_info
        price = fi.last_price
        prev = fi.previous_close
        if price is not None and prev is not None and prev > 0:
            chg = price - prev
            pct = (chg / prev) * 100
            result['price'] = f"{currency_prefix}{price:,.2f}"
            result['price_raw'] = round(price, 2)
            result['change'] = round(chg, 2)
            result['change_pct'] = round(pct, 2)
            result['direction'] = 'up' if pct >= 0 else 'down'
            result['prev_close'] = f"{currency_prefix}{prev:,.2f}"

        y_high = fi.year_high
        y_low = fi.year_low
        if y_high is not None and y_low is not None:
            result['high_52w'] = f"{currency_prefix}{y_high:,.2f}"
            result['low_52w'] = f"{currency_prefix}{y_low:,.2f}"
            result['high_52w_raw'] = round(y_high, 2)
            result['low_52w_raw'] = round(y_low, 2)

        mcap = fi.market_cap
        if mcap:
            if is_inr:
                result['market_cap_cr'] = f"₹{round(mcap / 1e7):,} Cr"
            else:
                result['market_cap_cr'] = f"${round(mcap / 1e9, 1)}B"

        try:
            pe = t.info.get('trailingPE')
            if pe and pe > 0:
                result['pe_ratio'] = round(pe, 1)
        except Exception:
            pass

    except Exception as exc:
        print(f"[company_xray] yfinance query error for {symbol}: {exc}", flush=True)

    # Search for matching news in CACHE['stories']
    matched_stories = []
    tokens = {q, name.lower(), symbol.lower().replace('.ns', '')}
    for s in CACHE.get('stories', []):
        t_low = s.get('title', '').lower()
        if any(tok in t_low for tok in tokens if len(tok) >= 3):
            matched_stories.append({
                'id': s.get('id'),
                'title': s.get('title'),
                'url': s.get('url'),
                'published': s.get('published'),
                'sources': s.get('sources', []),
                'category': s.get('category'),
                'score': s.get('score')
            })
            if len(matched_stories) >= 6:
                break
    result['stories'] = matched_stories

    COMPANY_CACHE[q] = {'time': now, 'data': result}
    return result

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'public'),**kwargs)
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path=='/api/briefing':
            body=json.dumps(dict(CACHE, calendar={k:v for k,v in CALENDAR.items() if k!='events'}, premarket=PREMARKET_DATA)).encode(); self.send_response(200)
            self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        elif path=='/api/events':
            events = get_all_events()
            body=json.dumps(events).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body)
        elif path=='/api/market':
            body=json.dumps(MARKET_DATA).encode(); self.send_response(200)
            self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        elif path=='/api/premarket':
            body=json.dumps(PREMARKET_DATA).encode(); self.send_response(200)
            self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        elif path=='/api/company':
            query = parse_qs(parsed.query).get('q', [''])[0]
            data = get_company_xray(query)
            body = json.dumps(data).encode(); self.send_response(200)
            self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','max-age=60')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        else: super().do_GET()
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=8765); parser.add_argument('--refresh-only', action='store_true'); args=parser.parse_args()
    if (DATA/'cache.json').exists():
        try:
            cached_raw = json.loads((DATA/'cache.json').read_text())
            CACHE.update(cached_raw)
            rescored = [rescore_story(story) for story in CACHE.get('stories', [])]
            CACHE['stories'] = group(rescored)
            (DATA/'cache.json').write_text(json.dumps(dict(CACHE, refreshing=False)))
        except (ValueError, OSError): pass
    if (DATA/'calendar.json').exists():
        try: CALENDAR.update(json.loads((DATA/'calendar.json').read_text()))
        except (ValueError,OSError): pass
    if (DATA/'market.json').exists():
        try: MARKET_DATA.update(json.loads((DATA/'market.json').read_text()))
        except (ValueError,OSError): pass
    if (DATA/'premarket.json').exists():
        try:
            saved_brief = json.loads((DATA/'premarket.json').read_text())
            if saved_brief.get('schema_version') == 2: PREMARKET_DATA.update(saved_brief)
        except (ValueError,OSError): pass
    if args.refresh_only:
        refresh(); refresh_calendar(); refresh_market(); refresh_premarket(); print(json.dumps({'stories':len(CACHE['stories']),'sources':CACHE['sources'],'market':len(MARKET_DATA.get('tickers',[])),'premarket':bool(PREMARKET_DATA)},indent=2))
    else:
        threading.Thread(target=scheduled,daemon=True).start()
        threading.Thread(target=refresh_premarket,daemon=True).start()
        threading.Thread(target=market_scheduled,daemon=True).start()
        print(f'Newsland is running at http://localhost:{args.port}',flush=True)
        ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()

