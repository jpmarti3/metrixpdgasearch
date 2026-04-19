# Cloudflare Pages version of the Disc Golf Metrix finder

This project is ready for Cloudflare Pages deployment.

## Structure

- `public/index.html` - static frontend
- `functions/api/competitions.js` - Cloudflare Pages Function backend
- `wrangler.toml` - Pages config for local dev and deploy

## Local development

1. Install Node.js 18+.
2. Run:

```bash
npm install -g wrangler
wrangler login
wrangler pages dev public
```

3. Open the local URL that Wrangler prints, usually:

```text
http://localhost:8788
```

## Deploy

From this folder:

```bash
wrangler pages deploy
```

Or, if this is your first deploy and you want to be explicit:

```bash
wrangler pages deploy public --project-name metrix-helsinki
```

## Dashboard deploy

You can also push this folder to GitHub and import it into Cloudflare Pages.

Recommended settings:

- Framework preset: None
- Build command: `exit 0`
- Build output directory: `public`

## Notes

- The browser only talks to `/api/competitions`.
- External fetching happens server-side inside the Cloudflare Function.
- The app does not hardcode any competition IDs.
- Discovery still depends on public search results and public Disc Golf Metrix page structure, so if those change, the parser may need updates.
