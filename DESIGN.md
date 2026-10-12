# Newsland Visual System

## Surface and purpose
A personal financial reading surface for Indian market participants scanning today's session and the week ahead. Combines the market utility of live benchmark tickers with a front-page lead story carousel and a clean 3-column broadsheet feed.

## Visual architecture
1. **Live Market Ticker Strip (Top)**:
   - Pins key Indian and global benchmarks: Sensex, Nifty, Gold, Silver, Brent Crude, and INR/USD.
   - Clean tabular values with subtle green (`▲`) and red (`▼`) delta percentages separated by delicate vertical hairpins.
   - Micro 52-week horizontal range rulers with interquartile band and pinpoint dot indicating current positioning.
2. **Top Masthead & Centered Search**:
   - `newsland.` wordmark with signature terracotta dot.
   - Centered pill search bar with instant live filtering.
   - Session date indicator and hamburger menu (`☰`) for quick settings.
3. **Trading Desk Brief (Premarket / Session Pulse)**:
   - Indicated open benchmark stat with full 52-week range ruler and peak drawdown.
   - Institutional flow tracking (FII & DII net flows).
   - Overnight global macro cues and calculated classic floor pivots (S2, S1, Pivot, R1, R2).
   - Market Regime & Sector Breadth strip: 50-DMA/200-DMA distance, 52-week peak drawdown, and live sector advance/decline chips.
   - Sourced session drivers and copyable desk takeaway memo.
4. **Trending Bar & Section Navigation**:
   - Terracotta `Trending` indicator with clickable keywords (`Shares`, `Growth`, `Sensex`, `Nifty`, `Gold`, `Prices`, `Data`, `Fed`, `War`, `Yields`, `Business`).
   - Section tabs (`All`, `India`, `Global`, `Catalysts`) with active underline indicator.
5. **Lead Story Hero Carousel**:
   - Commanding front-page presentation for the session's top breaking market catalyst.
   - 40px editorial headline in refined book serif (`Charter` / `Iowan Old Style` / `Georgia`).
   - Bold uppercase terracotta category eyebrow tag (`GLOBAL MARKETS`, `INDIA`, etc.) and relative timestamp.
   - Smooth slide controls (`←` and `→`) and dot indicators to cycle through the top 5 priority drivers.
6. **Lower 3-Column Feed**:
   - 3 balanced columns with category tags in bold terracotta (`INDIA`, `GLOBAL`, `RESULTS`, `MARKETS`, `COMMODITIES`, `COMPANIES`).
   - Semi-bold 16px headlines with right-aligned interactive chevron (`›`).
   - Clean 1–2 line market connection context notes.
   - Dividers separating cards with zero heavy boxes or drop shadows.
7. **Off-Canvas Drawer (`☰`)**:
   - Holds reading surface themes (`Paper`, `Sepia`, `Slate`, `Night`), typography mode (`Book Serif` / `Modern Sans`), font size stepping (`A-` / `A+`), time horizon toggle (`Today` / `This week`), watchlist management, and feed registry health.
8. **Mobile Short News Stories (Instagram-style Swipe View)**:
   - Floating action pill button (`⚡ Shorts`) and drawer menu toggle to launch a focused swipeable briefing.
   - Adopts the exact page theme ground (`Paper`, `Sepia`, `Slate`, `Night`), book serif / modern sans typography mode, and text size scaling.
   - Features the Newsland masthead (`newsland.`) with signature terracotta ink dot.
   - Segmented story progress indicator at top (Instagram Stories style).
   - Dual-card sliding stage with hardware-accelerated slide transitions (`cubic-bezier(0.2, 0.9, 0.3, 1)`) when navigating to next or previous stories.
   - Horizontal swipe gesture with direct touch tracking plus edge tap navigation (left 25% for previous, right 75% for next).
   - Strict chronological order: latest news first.
   - Each card highlights category pill, relative time, publisher badge, clear editorial headline, dedicated Market Takeaway summary box, asset impact chips, and a direct "Read Full Story ↗" action.

