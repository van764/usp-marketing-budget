# USP Budget Dashboard

Marketing budget dashboard for USP (5 home services brands: LEVEL, TITAN, TRADEMARK, PAPPAS, PRO).

## Quick Start

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install
npm start
# Open http://localhost:3000
```

## Architecture

- `server/index.js` - Express backend with expense classification API
- `public/index.html` - Self-contained React dashboard (React 18 + Recharts + PapaParse via CDN, Babel for JSX)
- Budget data: embedded in frontend, can sync from Google Sheets (settings gear icon)
- Expenses: stored in-memory on server, classified by Claude API

## API Endpoints

- `POST /api/expenses` - Add single expense (auto-classifies via Claude)
- `POST /api/expenses/upload` - Upload CSV of expenses (bulk classify)
- `GET /api/expenses?branch=LEVEL&month=2` - List expenses with filters
- `PATCH /api/expenses/:id` - Update expense (manual override)
- `DELETE /api/expenses/:id` - Delete expense
- `POST /api/expenses/:id/reclassify` - Re-run AI classification
- `GET /api/health` - Health check

## Key Decisions

- Frontend is a single HTML file with inline JSX (not a build step app) for simplicity and portability
- Google Sheets integration uses published CSV URLs (no API key needed for read-only)
- Expense classification uses Claude Sonnet for speed/cost balance
- In-memory expense storage (no DB yet) - replace with SQLite or Google Sheets write-back

## What Needs Building Next

1. Persist expenses to a database (SQLite or Google Sheets API write-back)
2. Receipt PDF upload with OCR extraction before classification
3. Expense-vs-budget reconciliation view (compare classified expenses against budget line items)
4. User auth if deploying publicly
5. Google Sheets API write-back for budget edits from the dashboard

## Brands

| Brand | Revenue Target | Budget |
|-------|---------------|--------|
| LEVEL | $12M | $396.7K |
| TITAN | $8M | $356.4K |
| TRADEMARK | $20M | $601.2K |
| PAPPAS | $13M | $257K |
| PRO | $34M | $383.4K |

All brands use Scorpion as primary digital/social vendor. Status options: Active, Trial, Unapproved, Ended.
