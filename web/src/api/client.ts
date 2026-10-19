import type {
  ConnectionConfig,
  ControlResponse,
  EndpointsResponse,
  HealthResponse,
  LedgerEventsQuery,
  LedgerEventsResponse,
  LedgerStatus,
  LockResponse,
  StatusSnapshot,
  WriteResponse,
} from "./types.ts";
import { httpBase } from "./types.ts";

function authHeaders(bearerToken?: string): Record<string, string> {
  return bearerToken ? { authorization: `Bearer ${bearerToken}` } : {};
}

export const REQUEST_TIMEOUT_MS = 8000;

async function request<T>(url: string, init: RequestInit, decode: (response: Response) => Promise<T>, mutation = false): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
          detail = body.error.slice(0, 512);
        }
      } catch { /* An upstream proxy may return HTML instead of JSON. */ }
      throw new Error(`HTTP ${response.status}：${detail}`);
    }
    // Keep body consumption inside the deadline too: headers alone are not a response.
    return await decode(response);
  } catch (error) {
    if (timeout.aborted && !init.signal?.aborted) {
      throw new Error(mutation
        ? "请求超时，设备可能已执行。请核对事件记录后再决定是否重试。"
        : "连接超时，请检查 Hub 地址和网络。");
    }
    throw error;
  }
}

async function getJson<T>(url: string, bearerToken?: string, signal?: AbortSignal): Promise<T> {
  return request(url, { method: "GET", headers: authHeaders(bearerToken), signal }, response => response.json() as Promise<T>);
}

async function getText(url: string, bearerToken?: string, signal?: AbortSignal): Promise<string> {
  return request(url, { method: "GET", headers: authHeaders(bearerToken), signal }, response => response.text());
}

async function sendJson<T>(
  url: string, method: string, body?: unknown, bearerToken?: string, signal?: AbortSignal,
): Promise<T> {
  return request(url, {
    method,
    headers: {
      ...authHeaders(bearerToken),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  }, response => response.json() as Promise<T>, true);
}

function eventQueryString(query: LedgerEventsQuery): string {
  const params = new URLSearchParams();
  if (query.afterSeq !== undefined) params.set("after_seq", String(query.afterSeq));
  if (query.throughSeq !== undefined) params.set("through_seq", String(query.throughSeq));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.types?.length) params.set("type", query.types.join(","));
  if (query.connectionEpoch !== undefined) {
    params.set("connection_epoch", String(query.connectionEpoch));
  }
  if (query.actor) params.set("actor", query.actor);
  if (query.containsHex) params.set("contains_hex", query.containsHex);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export const hubApi = {
  health: (cfg: ConnectionConfig, signal?: AbortSignal) =>
    getJson<HealthResponse>(`${httpBase(cfg)}/v1/health`, undefined, signal),

  status: (cfg: ConnectionConfig, bearerToken?: string, signal?: AbortSignal) =>
    getJson<StatusSnapshot>(`${httpBase(cfg)}/v1/status`, bearerToken, signal),

  endpoints: (cfg: ConnectionConfig, bearerToken?: string, signal?: AbortSignal) =>
    getJson<EndpointsResponse>(`${httpBase(cfg)}/v1/endpoints`, bearerToken, signal),

  clients: (cfg: ConnectionConfig, bearerToken?: string) =>
    getJson<StatusSnapshot["clients"]>(`${httpBase(cfg)}/v1/clients`, bearerToken),

  eventsStatus: (
    cfg: ConnectionConfig,
    bearerToken?: string,
    signal?: AbortSignal,
  ) =>
    getJson<LedgerStatus>(
      `${httpBase(cfg)}/v1/events/status`,
      bearerToken,
      signal,
    ),

  events: (
    cfg: ConnectionConfig,
    query: LedgerEventsQuery,
    bearerToken?: string,
    signal?: AbortSignal,
  ) =>
    getJson<LedgerEventsResponse>(
      `${httpBase(cfg)}/v1/events${eventQueryString(query)}`,
      bearerToken,
      signal,
    ),

  eventsExport: (cfg: ConnectionConfig, bearerToken?: string, signal?: AbortSignal) =>
    getText(`${httpBase(cfg)}/v1/events/export`, bearerToken, signal),

  metrics: (cfg: ConnectionConfig, bearerToken?: string, signal?: AbortSignal) =>
    getText(`${httpBase(cfg)}/v1/metrics`, bearerToken, signal),

  writeText: (
    cfg: ConnectionConfig,
    text: string,
    opts?: {
      newline?: boolean;
      as_client?: string;
      lease_token?: string;
      bearer_token?: string;
      signal?: AbortSignal;
    },
  ) =>
    sendJson<WriteResponse>(
      `${httpBase(cfg)}/v1/write`,
      "POST",
      {
        text,
        newline: opts?.newline ?? true,
        as_client: opts?.as_client ?? "web-ui",
        lease_token: opts?.lease_token,
      },
      opts?.bearer_token,
      opts?.signal,
    ),

  writeHex: (
    cfg: ConnectionConfig,
    hex: string,
    opts?: { as_client?: string; lease_token?: string; bearer_token?: string; signal?: AbortSignal },
  ) =>
    sendJson<WriteResponse>(
      `${httpBase(cfg)}/v1/write`,
      "POST",
      {
        hex,
        as_client: opts?.as_client ?? "web-ui",
        lease_token: opts?.lease_token,
      },
      opts?.bearer_token,
      opts?.signal,
    ),

  lock: (
    cfg: ConnectionConfig,
    as_client = "web-ui",
    lease_token?: string,
    bearerToken?: string,
    signal?: AbortSignal,
  ) =>
    sendJson<LockResponse>(
      `${httpBase(cfg)}/v1/lock`,
      "POST",
      { as_client, lease_token },
      bearerToken,
      signal,
    ),

  unlock: (cfg: ConnectionConfig, lease_token: string, bearerToken?: string, signal?: AbortSignal) =>
    sendJson<LockResponse>(
      `${httpBase(cfg)}/v1/lock`,
      "DELETE",
      { lease_token },
      bearerToken,
      signal,
    ),

  control: (
    cfg: ConnectionConfig,
    body:
      | { op: "dtr" | "rts"; level: boolean; as_client?: string; lease_token?: string }
      | { op: "break"; duration_ms: number; as_client?: string; lease_token?: string },
    bearerToken?: string,
    signal?: AbortSignal,
  ) =>
    sendJson<ControlResponse>(`${httpBase(cfg)}/v1/control`, "POST", body, bearerToken, signal),
};
