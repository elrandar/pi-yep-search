import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum, type OAuthCredentials, type OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const searchParams = Type.Object({
  query: Type.String({
    description: "Search query string (1-1000 chars)",
    minLength: 1,
    maxLength: 1000,
  }),
  type: Type.Optional(
    StringEnum(["basic", "highlights"] as const, {
      description: 'Search type: "basic" (default) or "highlights"',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum number of results to return (default 10, max 100)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  language: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Filter by ISO 639-1 language codes, e.g. ["en"] or ["fr", "en"]',
    }),
  ),
  search_mode: Type.Optional(
    StringEnum(["balanced", "advanced"] as const, {
      description: 'Search mode: "balanced" (default) or "advanced"',
    }),
  ),
  content_type: Type.Optional(
    Type.String({
      description: "Optional content type filter from the Yep API docs",
    }),
  ),
  safe_search: Type.Optional(
    Type.Boolean({
      description: "Exclude adult-classified pages",
    }),
  ),
  include_domains: Type.Optional(
    Type.String({
      description: "Comma-separated full URLs to include, e.g. https://example.com,https://other.com",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.String({
      description: "Comma-separated full URLs to exclude",
    }),
  ),
  start_published_date: Type.Optional(Type.String({ description: "ISO 8601 start published date filter" })),
  end_published_date: Type.Optional(Type.String({ description: "ISO 8601 end published date filter" })),
  start_crawl_date: Type.Optional(Type.String({ description: "ISO 8601 start crawl date filter" })),
  end_crawl_date: Type.Optional(Type.String({ description: "ISO 8601 end crawl date filter" })),
});

type SearchParams = Static<typeof searchParams>;
type SearchResultLike = Record<string, unknown>;
type OAuthAuthEntry = {
  type: "oauth";
  access?: string;
  refresh?: string;
  expires?: number;
};

const YEP_PROVIDER_NAME = "yep-search";

function getAgentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function getAuthFilePath() {
  return join(getAgentDir(), "auth.json");
}

async function readAuthFile(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(getAuthFilePath(), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeAuthFile(data: Record<string, unknown>) {
  const path = getAuthFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

async function getYepToken() {
  const auth = await readAuthFile();
  const entry = auth[YEP_PROVIDER_NAME];
  if (entry && typeof entry === "object") {
    const oauth = entry as OAuthAuthEntry;
    if (oauth.type === "oauth") {
      if (typeof oauth.expires !== "number" || oauth.expires > Date.now()) {
        if (typeof oauth.access === "string" && oauth.access.trim()) {
          return oauth.access;
        }
      }
    }
  }

  return process.env.YEP_ACCESS_TOKEN || process.env.YEP_API_KEY || process.env.YEP_TOKEN;
}

function getYepBaseUrl() {
  return (process.env.YEP_BASE_URL || "https://platform.yep.com").replace(/\/$/, "");
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstString(obj: SearchResultLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = clean(obj[key]);
    if (value) return value;
  }
  return undefined;
}

function getHighlights(result: SearchResultLike): string[] {
  const candidates = [result.highlights, result.highlight, result.snippets, result.snippet];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return [candidate.trim()];
    }
  }
  return [];
}

function summarizeResult(result: SearchResultLike, index: number): string {
  const url = firstString(result, ["url", "link"]);
  const title = firstString(result, ["title", "meta_title", "metaTitle", "name"]) || url || `Result ${index}`;
  const description = firstString(result, [
    "description",
    "meta_description",
    "metaDescription",
    "snippet",
    "summary",
    "text",
  ]);
  const highlights = getHighlights(result);

  const lines = [`${index}. ${title}`];
  if (url) lines.push(`   URL: ${url}`);
  if (description) lines.push(`   Snippet: ${description}`);
  if (highlights.length > 0) {
    for (const highlight of highlights.slice(0, 2)) {
      lines.push(`   Highlight: ${highlight}`);
    }
  }
  return lines.join("\n");
}

function buildSummary(response: Record<string, unknown>): string {
  const query = clean(response.query) || "(unknown query)";
  const type = clean(response.type) || "basic";
  const language = clean(response.language);
  const requestId = clean(response.request_id);
  const responseTime = typeof response.response_time_ms === "number" ? response.response_time_ms : undefined;
  const apiCost =
    response.api_cost && typeof response.api_cost === "object" && response.api_cost !== null
      ? (response.api_cost as Record<string, unknown>)
      : undefined;
  const cost = typeof apiCost?.cost === "number" ? apiCost.cost : undefined;
  const costDetails = clean(apiCost?.details);
  const results = Array.isArray(response.results) ? (response.results as SearchResultLike[]) : [];

  const lines = [`Yep search results for: ${query}`];
  lines.push(`Type: ${type}`);
  if (language) lines.push(`Language: ${language}`);
  if (requestId) lines.push(`Request ID: ${requestId}`);
  if (responseTime !== undefined) lines.push(`Response time: ${responseTime} ms`);
  if (cost !== undefined) lines.push(`API cost: ${cost}${costDetails ? ` (${costDetails})` : ""}`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No results returned.");
    return lines.join("\n");
  }

  for (const [idx, result] of results.entries()) {
    lines.push(summarizeResult(result, idx + 1));
    if (idx < results.length - 1) lines.push("");
  }

  return lines.join("\n");
}

async function generatePKCE() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(hash)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { verifier, challenge };
}

const YEP_MANUAL_REDIRECT_URI = "https://localhost/yep-oauth-callback";

function parseYepCallbackInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("No callback URL or code provided.");

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) throw new Error("Callback URL does not contain a code parameter.");
    if (!returnedState) throw new Error("Callback URL does not contain a state parameter.");
    return { code, returnedState };
  }

  return { code: trimmed, returnedState: undefined };
}

async function exchangeYepOAuthToken(clientId: string, code: string, verifier: string, redirectUri: string) {
  const tokenResponse = await fetch(`${getYepBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Yep token exchange failed: ${await tokenResponse.text()}`);
  }

  return (await tokenResponse.json()) as {
    access_token: string;
    token_type?: string;
    expires_in?: number;
  };
}

async function registerYepOAuthClient(redirectUri: string) {
  const registerResponse = await fetch(`${getYepBaseUrl()}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "Pi Yep Search",
    }),
  });

  if (!registerResponse.ok) {
    throw new Error(`Yep client registration failed: ${await registerResponse.text()}`);
  }

  const registerData = (await registerResponse.json()) as { client_id?: string };
  if (!registerData.client_id) {
    throw new Error("Yep client registration did not return client_id.");
  }
  return registerData.client_id;
}

async function loginYepViaProvider(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  const clientId = await registerYepOAuthClient(YEP_MANUAL_REDIRECT_URI);

  const authUrl = new URL(`${getYepBaseUrl()}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", YEP_MANUAL_REDIRECT_URI);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  callbacks.onAuth({ url: authUrl.toString() });

  const pasted = await callbacks.onPrompt({
    message: "Paste the full callback URL (preferred) or just the authorization code:",
  });
  const callback = parseYepCallbackInput(pasted);
  if (callback.returnedState && callback.returnedState !== state) {
    throw new Error("OAuth state mismatch.");
  }

  const token = await exchangeYepOAuthToken(clientId, callback.code, verifier, YEP_MANUAL_REDIRECT_URI);
  return {
    access: token.access_token,
    refresh: token.access_token,
    expires: Date.now() + Math.max(60, token.expires_in ?? 31536000) * 1000 - 5 * 60 * 1000,
  };
}

export default function yepSearchExtension(pi: ExtensionAPI) {
  pi.registerProvider(YEP_PROVIDER_NAME, {
    oauth: {
      name: "Yep Search",
      login: loginYepViaProvider,
      async refreshToken(credentials) {
        if (typeof credentials.expires === "number" && credentials.expires > Date.now()) return credentials;
        throw new Error("Yep Search OAuth token expired. Please run /login and select Yep Search again.");
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web with Yep Search API",
    promptSnippet: "Search the live web via Yep when the user needs up-to-date external information.",
    promptGuidelines: [
      "Use this tool for current web information, external documentation, news, or sources outside the local repo.",
      "Prefer `type: highlights` when the user needs supporting excerpts from page content.",
    ],
    parameters: searchParams,
    async execute(_toolCallId, params: SearchParams, signal) {
      const token = await getYepToken();
      if (!token) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Missing Yep token. Run /login and select Yep Search, or set YEP_ACCESS_TOKEN / YEP_API_KEY before starting pi.",
            },
          ],
          details: {},
        };
      }

      const baseUrl = getYepBaseUrl();
      const payload: Record<string, unknown> = {
        query: params.query,
        type: params.type ?? "highlights",
      };
      for (const [key, value] of Object.entries(params)) {
        if (key !== "query" && value !== undefined) payload[key] = value;
      }

      try {
        const response = await fetch(`${baseUrl}/api/search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal,
        });

        const text = await response.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          data = { raw: text };
        }

        if (!response.ok) {
          const error = clean(data.error) || `Yep search failed with HTTP ${response.status}`;
          return {
            isError: true,
            content: [{ type: "text", text: `${error}\n\nResponse:\n${JSON.stringify(data, null, 2)}` }],
            details: {
              status: response.status,
              response: data,
              request: payload,
            },
          };
        }

        return {
          content: [{ type: "text", text: buildSummary(data) }],
          details: {
            request: payload,
            response: data,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Yep search request failed: ${message}` }],
          details: { request: payload },
        };
      }
    },
  });

}
