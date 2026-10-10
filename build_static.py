#!/usr/bin/env python3
"""Newsland Static Site Builder.
Generates static JSON payloads for Cloudflare Pages / static hosting:
- public/data/briefing.json
- public/data/events.json
- public/data/market.json
- public/data/premarket.json
- public/data/companies/*.json
"""
import sys, os, json, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
DATA_OUT = PUBLIC / 'data'
DATA_OUT.mkdir(parents=True, exist_ok=True)
COMPANIES_OUT = DATA_OUT / 'companies'
COMPANIES_OUT.mkdir(parents=True, exist_ok=True)

# Add virtual environment if present
for _p in glob.glob(str(ROOT / '.venv/lib/python*/site-packages')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import server

def main():
    print("[1/5] Collecting latest news and stories...")
    server.refresh()

    print("[2/5] Collecting calendar events...")
    server.refresh_calendar()

    print("[3/5] Collecting live market benchmarks...")
    server.refresh_market()

    print("[4/5] Generating desk briefing...")
    server.refresh_premarket()

    # Write briefing.json
    briefing_payload = dict(
        server.CACHE,
        calendar={k: v for k, v in server.CALENDAR.items() if k != 'events'},
        premarket=server.PREMARKET_DATA
    )
    (DATA_OUT / 'briefing.json').write_text(json.dumps(briefing_payload, ensure_ascii=False, indent=2))
    print(f" -> Wrote public/data/briefing.json ({len(server.CACHE.get('stories', []))} stories)")

    # Write events.json
    events_payload = server.get_all_events()
    (DATA_OUT / 'events.json').write_text(json.dumps(events_payload, ensure_ascii=False, indent=2))
    print(f" -> Wrote public/data/events.json ({len(events_payload)} events)")

    # Write market.json
    (DATA_OUT / 'market.json').write_text(json.dumps(server.MARKET_DATA, ensure_ascii=False, indent=2))
    print(f" -> Wrote public/data/market.json ({len(server.MARKET_DATA.get('tickers', []))} tickers)")

    # Write premarket.json
    (DATA_OUT / 'premarket.json').write_text(json.dumps(server.PREMARKET_DATA, ensure_ascii=False, indent=2))
    print(f" -> Wrote public/data/premarket.json")

    # [5/5] Pre-render top companies for Company X-Ray
    top_stocks = [
        ('RELIANCE.NS', 'Reliance Industries'),
        ('HDFCBANK.NS', 'HDFC Bank'),
        ('ICICIBANK.NS', 'ICICI Bank'),
        ('INFY.NS', 'Infosys'),
        ('TCS.NS', 'Tata Consultancy Services'),
        ('ITC.NS', 'ITC Limited'),
        ('LT.NS', 'Larsen & Toubro'),
        ('SBIN.NS', 'State Bank of India'),
        ('BHARTIARTL.NS', 'Bharti Airtel'),
        ('KOTAKBANK.NS', 'Kotak Mahindra Bank'),
        ('TATAMOTORS.NS', 'Tata Motors'),
        ('HINDUNILVR.NS', 'Hindustan Unilever'),
        ('BAJFINANCE.NS', 'Bajaj Finance'),
        ('AXISBANK.NS', 'Axis Bank'),
        ('MARUTI.NS', 'Maruti Suzuki'),
        ('SUNPHARMA.NS', 'Sun Pharmaceutical'),
        ('TITAN.NS', 'Titan Company'),
        ('WIPRO.NS', 'Wipro'),
        ('ADANIENT.NS', 'Adani Enterprises'),
        ('NTPC.NS', 'NTPC Limited')
    ]
    print(f"[5/5] Pre-rendering Company X-Ray for {len(top_stocks)} core companies...")
    for sym, name in top_stocks:
        try:
            xdata = server.get_company_xray(sym)
            if xdata:
                sym_clean = sym.split('.')[0].lower()
                (COMPANIES_OUT / f"{sym_clean}.json").write_text(json.dumps(xdata, ensure_ascii=False))
                name_clean = ''.join(c for c in name.lower() if c.isalnum())
                (COMPANIES_OUT / f"{name_clean}.json").write_text(json.dumps(xdata, ensure_ascii=False))
        except Exception as e:
            print(f"  Warning: could not pre-render {sym}: {e}")

    print("\n✓ Static build completed successfully!")

if __name__ == '__main__':
    main()
