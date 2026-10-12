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
8. **Mobile Short News Stories (Bumble/Tinder-style Card Swipe Feed)**:
   - Mobile mode switch strip (`[ 📰 Broadsheet | ⚡ Insta Shorts ]`), section tab (`⚡ Shorts`), floating pill button, and drawer toggle.
   - Adopts the exact page theme ground (`Paper`, `Sepia`, `Slate`, `Night`), typography mode (`Book Serif` / `Modern Sans`), and user text size scaling (`sm` / `md` / `lg`).
   - Features the Newsland masthead (`newsland.`) with signature terracotta ink dot and segmented story progress indicators.
   - **Bumble-style Stacked Dual-Card Deck**:
     - Real-time touch & mouse drag tracking with dynamic card rotation (`rotate(${dx * 0.08}deg) translate3d(${dx}px, ...)`).
     - Underneath card is stacked behind the top card (`scale(0.94) translateY(14px)`), scaling up smoothly to full size as the top card is dragged away.
     - Physical card throw animations (`bumbleThrowLeft` / `bumbleEnterFromLeft` with rotational toss) when advancing or rewinding.
     - Edge tap navigation (left 28% for previous, right 72% for next) and keyboard arrow navigation (`←` / `→`).
   - Strict chronological ordering: sorted by latest news first.
   - 100% Broadsheet page card fidelity: exact category pill, relative time, publisher badge, editorial headline, takeaway summary, impact asset badges, and direct "Read Full Story ↗" action.

