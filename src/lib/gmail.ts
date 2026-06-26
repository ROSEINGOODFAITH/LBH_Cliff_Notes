import { getEnv, integrations } from "@/lib/env";

/**
 * Gmail API client using refresh-token OAuth (server-side). Sends 1:1 outreach
 * and reads replies for sync. No SDK dependency. Token cached in-process.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "GmailError";
    this.status = status;
    this.body = body;
  }
}
export class GmailNotConfiguredError extends GmailError {
  constructor() {
    super("Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.");
    this.name = "GmailNotConfiguredError";
  }
}

export function gmailConfigured(): boolean {
  try {
    return integrations.gmail();
  } catch {
    return false;
  }
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const env = getEnv();
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new GmailNotConfiguredError();
  }
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new GmailError(`Gmail OAuth ${res.status}`, res.status, text.slice(0, 300));
  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function gmailFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new GmailError(`Gmail ${res.status}`, res.status, text.slice(0, 300));
  return (text ? JSON.parse(text) : null) as T;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeB64url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export interface SendResult {
  id: string;
  threadId: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string; // RFC822 Message-ID of the message being replied to
}): Promise<SendResult> {
  const env = getEnv();
  const from = env.GMAIL_SENDER ?? "me";
  const headers = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
    opts.inReplyTo ? `References: ${opts.inReplyTo}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean) as string[];
  const mime = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
  const payload: Record<string, string> = { raw: base64url(mime) };
  if (opts.threadId) payload.threadId = opts.threadId;
  return gmailFetch<SendResult>(`/messages/send`, { method: "POST", body: JSON.stringify(payload) });
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string | null;
  messageIdHeader: string | null;
  snippet: string;
  body: string;
}

export async function listRecentMessages(query: string, max = 50): Promise<{ id: string; threadId: string }[]> {
  const data = await gmailFetch<{ messages?: { id: string; threadId: string }[] }>(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
  );
  return data.messages ?? [];
}

function header(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractTextBody(payload: GmailPayload): string {
  if (payload.body?.data) return decodeB64url(payload.body.data);
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeB64url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractTextBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

export async function getMessage(id: string): Promise<GmailMessage> {
  const m = await gmailFetch<GmailRawMessage>(`/messages/${id}?format=full`);
  const headers = m.payload?.headers ?? [];
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(headers, "From"),
    to: header(headers, "To"),
    subject: header(headers, "Subject"),
    date: header(headers, "Date") || null,
    messageIdHeader: header(headers, "Message-ID") || null,
    snippet: m.snippet ?? "",
    body: m.payload ? extractTextBody(m.payload) : "",
  };
}

interface GmailPayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPayload[];
}
interface GmailRawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailPayload;
}
