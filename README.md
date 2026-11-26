# Paradox Dairy — Milk Collection & Payout Web App

A full-stack dairy milk collection management web application built with **HTML**, **CSS**, **JavaScript**, and **Node.js** (zero external runtime dependencies).

## Features

- **Log Farmer Milk Entries**: Record entries with Date, Shift (`Morning` / `Evening`), Farmer ID & Name, Quantity (L), Fat (%), and SNF (%).
- **Auto Rate Card Lookup**: Automatically looks up the per-liter price from the 2D `Fat % × SNF %` rate chart (exact match or nearest lower slab) with live preview before submission.
- **High-Quantity Bonus**: Automatically applies configurable bonus tiers (default: `+₹2.00/L` for `20+ L` and `+₹3.50/L` for `40+ L`) to qualifying deliveries.
- **Daily Collection Totals**: Displays total liters collected, total payout due, total bonus applied, weighted average Fat/SNF %, and an itemized daily register with search filtering.
- **Printable Payout Slips**: Generate formatted single-entry or multi-day farmer payout slips with itemized breakdowns, totals, and print/PDF support.
- **Editable Rate Chart & Bonus Rules**: Interactively edit any `Fat × SNF` cell, add/remove Fat rows or SNF columns, bulk-adjust all rates, customize high-quantity bonus slabs, or reset to defaults.

## Project Structure

```text
Paradox-/
├── public/
│   ├── index.html      # Single-page UI (Collection Log, Payout Slip, Rate Chart Editor)
│   ├── styles.css      # Responsive styling and @media print slip layout
│   └── app.js          # Frontend state, live rate preview, and API integration
├── src/
│   ├── pricing.js      # Pure rate lookup, bonus calculation, and summary aggregation
│   └── store.js        # JSON file persistence with starter seed data
├── tests/
│   └── pricing.test.js # Unit and HTTP API integration tests
├── server.js           # Node.js HTTP server and REST API
└── package.json
```

## Getting Started

Requires **Node.js 18+** (no `npm install` needed).

```bash
# Start the server
npm start
# or
node server.js
```

Open `http://localhost:3000` in your browser.

## Running Tests

```bash
npm test
```

## API Endpoints

- `GET /api/health` — Server health and current date
- `GET /api/entries?date=YYYY-MM-DD&farmerId=...` — List collection entries and summary
- `POST /api/entries` — Log a new farmer milk entry (calculates rate & bonus server-side)
- `DELETE /api/entries/:id` — Delete an entry
- `GET /api/summary?date=YYYY-MM-DD` — Daily collection KPIs and entries
- `GET /api/payout-slip?entryId=...` or `?farmerId=...&from=...&to=...` — Generate payout slip data
- `GET /api/rate-card` — Get current Fat × SNF rate matrix and bonus rules
- `PUT /api/rate-card` — Save updated rate matrix and bonus rules
- `POST /api/rate-card/reset` — Reset rate card and bonus rules to defaults
- `POST /api/calculate` — Live pricing calculation preview
