# DiscGolfMetrix Pages App

This is the **Cloudflare Pages + Functions** version.

## Included

- static UI in `public/index.html`
- backend scraping function in `functions/api/search.js`
- dynamic event search using the search criteria
- repeated search batching to collect all matching events
- scrape of event page and registration page for each event
- JSON download
- CSV export

## Deploy to Cloudflare Pages

```bash
npm install
npm run deploy
```

## Run locally

```bash
npm install
npm run dev
```

## Project layout

- `public/index.html`
- `functions/api/search.js`
- `wrangler.toml`

## Notes

- This is Cloudflare deployable.
- It does not use Express.
- It is built for Pages Functions, not plain Node hosting.
- CSV export is flattened at entrant level: one row per entrant, with event fields repeated.
