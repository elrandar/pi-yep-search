# pi-yep-search

A [pi](https://github.com/mariozechner/pi) extension that adds a `web_search` tool backed by the [Yep Search API](https://platform.yep.com/).

## Install

```bash
# From git
pi install git:github.com/elrandar/pi-yep-search

# From a local checkout
pi install ~/perso/pi-yep-search

# Try without installing
pi -e ~/perso/pi-yep-search
```

Use `-l` on `pi install` to write to project settings (`.pi/settings.json`) instead of global (`~/.pi/agent/settings.json`).

## Authenticate

Either run `/login` inside pi and pick **Yep Search** (OAuth + PKCE flow), or set one of these env vars before launching pi:

```bash
export YEP_ACCESS_TOKEN=...   # preferred
# or
export YEP_API_KEY=...
# or
export YEP_TOKEN=...
```

Optional: override the base URL via `YEP_BASE_URL` (default `https://platform.yep.com`).

## Tool: `web_search`

Parameters (all optional except `query`):

| Name | Type | Notes |
|---|---|---|
| `query` | string | 1–1000 chars |
| `type` | `"basic"` \| `"highlights"` | Defaults to `highlights` |
| `limit` | integer 1–100 | Defaults to 10 server-side |
| `language` | string[] | ISO 639-1 codes, e.g. `["en"]` |
| `search_mode` | `"balanced"` \| `"advanced"` | |
| `content_type` | string | See Yep docs |
| `safe_search` | boolean | Exclude adult-classified pages |
| `include_domains` | string | Comma-separated full URLs |
| `exclude_domains` | string | Comma-separated full URLs |
| `start_published_date` / `end_published_date` | string | ISO 8601 |
| `start_crawl_date` / `end_crawl_date` | string | ISO 8601 |

The tool returns a human-readable summary (title / URL / snippet / highlights) in `content`, and the raw request + response in `details` for programmatic consumers.

## License

MIT
