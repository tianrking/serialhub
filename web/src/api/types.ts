/** serialhub hub API 型別（對應 PROTOCOL.zh-TW.md） */

export type EndpointKind = "http" | "websocket" | "tcp" | "pty" | string;

export interface PortStatus {
  path: string;
  baud: number;
  connected: boolean;
  detail: string;
  epoch: number;
}

export interface Endpoint {
  kind: EndpointKind;
  name: string;
  address: string;
  can_read: boolean;
  can_write: boolean;
  note: string;
}

export interface ClientInfo {
  id: string;
  name: string;
  kind: string;
  can_read: boolean;
  can_write: boolean;
  primary_eligible: boolean;
}

export interface Stats {
  rx_bytes: number;
  tx_bytes: number;
  rx_drops: number;
  tx_denies: number;
}

export interface StatusSnapshot {
  port: PortStatus;
  tx_mode: string;
  lock_owner: string | null;
  lock_expires_ms: number | null;
  endpoints: Endpoint[];
  clients: ClientInfo[];
  stats: Stats;
}

export interface EndpointsResponse {
  real: PortStatus;
  endpoints: Endpoint[];
  connected_clients: number;
}

export interface WriteResponse {
  ok: boolean;
  error?: string;
  bytes: number;
}

export interface LockResponse {
  ok: boolean;
  error?: string;
  lock?: { owner: string; expires_ms: number; lease_token: string };
}

export interface ControlResponse {
  ok: boolean;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
}

export type LedgerPersistenceState = "disabled" | "active" | "degraded" | "sealed";

export type LedgerEventType = "rx" | "tx" | "connection" | "control" | "gap";

export interface LedgerBytesPayload {
  data_base64: string;
  len: number;
}

interface LedgerEventBase {
  schema: "ohmyserial.event";
  version: 1;
  session_id: string;
  seq: number;
  ts_utc: string;
  mono_us: number;
  port_id: string;
  connection_epoch: number;
}

export type LedgerEvent =
  | (LedgerEventBase & {
      type: "rx";
      payload: LedgerBytesPayload;
    })
  | (LedgerEventBase & {
      type: "tx";
      payload: LedgerBytesPayload & {
        actor: string;
        client_id?: string;
      };
    })
  | (LedgerEventBase & {
      type: "connection";
      payload: {
        state: "connected" | "disconnected" | "reconnecting" | "open_failed";
        path: string;
        baud: number;
        detail?: string;
      };
    })
  | (LedgerEventBase & {
      type: "control";
      payload: {
        actor?: string;
        name: string;
        value?: string;
      };
    })
  | (LedgerEventBase & {
      type: "gap";
      payload: {
        scope: "rx_observation" | "tx_outcome" | "client_delivery" | "persistence";
        certainty: "unknown" | "partial_or_unknown" | "not_delivered";
        reason: string;
        bytes?: LedgerBytesPayload;
        actor?: string;
        client_ids?: string[];
      };
    });

export interface LedgerStatus {
  session_id: string;
  newest_seq: number;
  oldest_available_seq: number | null;
  retained_events: number;
  retained_bytes: number;
  evicted_events: number;
  persistence: LedgerPersistenceState;
  persistence_directory?: string;
  persistence_error?: string;
  sealed: boolean;
  recovery?: unknown;
  stale_recovery?: unknown;
}

export interface LedgerEventPage {
  events: LedgerEvent[];
  incomplete: boolean;
  missing_through_seq?: number;
  oldest_available_seq?: number;
  newest_seq: number;
  next_after_seq: number;
  has_more: boolean;
}

export interface LedgerEventsResponse {
  ok: true;
  session_id: string;
  page: LedgerEventPage;
}

export interface LedgerEventsQuery {
  afterSeq?: number;
  throughSeq?: number;
  limit?: number;
  types?: LedgerEventType[];
  connectionEpoch?: number;
  actor?: string;
  containsHex?: string;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  protocol?: "http" | "https";
}

export function validateConnection(value: ConnectionConfig): ConnectionConfig {
  const host = value.host.trim();
  if (!host || /[\s/?#@\\]/.test(host)) throw new Error("请输入有效主机名或 IP，不含协议和路径");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new Error("端口必须是 1 到 65535 之间的整数");
  }
  if (value.protocol !== undefined && value.protocol !== "http" && value.protocol !== "https") {
    throw new Error("连接协议仅支持 HTTP 或 HTTPS");
  }
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  try {
    new URL(`${value.protocol ?? "http"}://${authority}:${value.port}`);
  } catch {
    throw new Error("主机名或 IP 格式无效");
  }
  return { host, port: value.port, protocol: value.protocol ?? "http" };
}

export function httpBase(cfg: ConnectionConfig): string {
  const host = cfg.host.includes(":") && !cfg.host.startsWith("[") ? `[${cfg.host}]` : cfg.host;
  return `${cfg.protocol ?? "http"}://${host}:${cfg.port}`;
}

export function wsUrl(cfg: ConnectionConfig): string {
  return `${httpBase(cfg).replace(/^http/, "ws")}/v1/stream`;
}

export interface SerialSettings {
  baud: number;
  databits: number;
  parity: "none" | "odd" | "even";
  stopbits: number;
  flow: "none" | "software" | "hardware";
}
export interface SerialPortInfo { path: string; kind: string }
