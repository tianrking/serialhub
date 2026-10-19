import { useCallback, useEffect, useRef, useState } from "react";
import { hubApi } from "./api/client";
import type { ConnectionConfig, Endpoint, StatusSnapshot } from "./api/types";
import { validateConnection } from "./api/types";
import { connectStream, type StreamHandlers } from "./api/wsStream";

export type ConnectionPhase = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export type HubSession = {
  cfg: ConnectionConfig;
  bearerToken?: string;
  signal: AbortSignal;
  abort: () => void;
  deviceConnected: boolean;
  streamOpen: boolean;
};

/** One explicit connection owns its requests, socket, polling, and retry timers. */
export function useHubConnection() {
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [online, setOnline] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const current = useRef<HubSession | null>(null);
  const dispose = useRef<() => void>(() => {});

  const isCurrent = useCallback((session: HubSession) =>
    current.current === session && !session.signal.aborted, []);
  const activeSession = useCallback(() => current.current, []);

  const disconnect = useCallback(() => {
    current.current = null;
    dispose.current();
    dispose.current = () => {};
    setPhase("idle");
    setOnline(false);
    setWsOpen(false);
    setStatus(null);
    setEndpoints([]);
    setError(null);
    setRetryCount(0);
  }, []);

  const refreshMeta = useCallback(async () => {
    const session = current.current;
    if (!session || session.signal.aborted) return;
    const [nextStatus, nextEndpoints] = await Promise.all([
      hubApi.status(session.cfg, session.bearerToken, session.signal),
      hubApi.endpoints(session.cfg, session.bearerToken, session.signal),
    ]);
    if (!isCurrent(session)) return;
    if (!nextStatus?.port || typeof nextStatus.port.path !== "string"
        || typeof nextStatus.port.connected !== "boolean" || !Number.isFinite(nextStatus.port.baud)
        || !nextStatus.stats || ![nextStatus.stats.rx_bytes, nextStatus.stats.tx_bytes,
          nextStatus.stats.rx_drops, nextStatus.stats.tx_denies].every(Number.isFinite)
        || !Array.isArray(nextStatus.clients) || !Array.isArray(nextEndpoints?.endpoints)) {
      throw new Error("服务返回了不兼容的状态数据，请确认目标是 SerialHub Hub。");
    }
    setStatus(nextStatus);
    session.deviceConnected = nextStatus.port.connected;
    setEndpoints(nextEndpoints.endpoints);
    setOnline(true);
  }, [isCurrent]);

  const connect = useCallback(async (
    cfg: ConnectionConfig, bearerToken: string | undefined, handlers: StreamHandlers,
  ): Promise<boolean> => {
    disconnect();
    let validated: ConnectionConfig;
    try {
      validated = validateConnection(cfg);
      if (window.location.protocol === "https:" && validated.protocol !== "https") {
        throw new Error("HTTPS 页面请使用 HTTPS Hub，避免浏览器混合内容拦截。");
      }
    } catch (failure) {
      setPhase("error");
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
    const controller = new AbortController();
    const session: HubSession = {
      cfg: validated, bearerToken, signal: controller.signal, abort: () => controller.abort(),
      deviceConnected: false, streamOpen: false,
    };
    current.current = session;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(retryTimer);
      clearTimeout(openTimer);
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
    };
    dispose.current = cleanup;
    const fail = (failure: unknown) => {
      if (!isCurrent(session)) return;
      cleanup();
      setOnline(false);
      setWsOpen(false);
      setPhase("error");
      setError(failure instanceof Error ? failure.message : String(failure));
    };
    setPhase("connecting");
    const poll = async () => {
      if (!isCurrent(session)) return;
      try {
        await refreshMeta();
      } catch (failure) {
        fail(failure);
      }
      // Schedule after completion: slow requests never create overlapping polls.
      if (isCurrent(session)) pollTimer = setTimeout(() => void poll(), 2000);
    };
    const openStream = () => {
      if (!isCurrent(session)) return;
      let ws: WebSocket;
      const retry = () => {
        if (!isCurrent(session) || socket !== ws) return;
        clearTimeout(openTimer);
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
        session.streamOpen = false;
        setWsOpen(false);
        if (attempts >= 5) {
          fail(new Error("实时流连接中断，多次重连未成功。请检查 Hub 后重新连接。"));
          return;
        }
        setPhase("reconnecting");
        setRetryCount(++attempts);
        retryTimer = setTimeout(openStream, Math.min(1000 * 2 ** (attempts - 1), 10000));
        handlers.onClose?.();
      };
      try {
        ws = connectStream(validated, {
          onOpen: () => {
            if (!isCurrent(session) || socket !== ws) return;
            clearTimeout(openTimer);
            session.streamOpen = true;
            setWsOpen(true);
            setPhase("connected");
            setError(null);
            setRetryCount(0);
            attempts = 0;
            handlers.onOpen?.();
          },
          onClose: retry,
          onError: () => { /* close or the open deadline drives bounded retries. */ },
          onServerError: (message) => {
            if (isCurrent(session) && socket === ws) handlers.onServerError?.(message);
          },
          onBytes: (data, meta) => {
            if (isCurrent(session) && socket === ws) handlers.onBytes?.(data, meta);
          },
        }, bearerToken, true);
        socket = ws;
        openTimer = setTimeout(retry, 8000);
      } catch (failure) {
        fail(failure);
      }
    };
    try {
      const health = await hubApi.health(validated, controller.signal);
      if (!health.ok) throw new Error("Hub 健康检查未通过");
      await refreshMeta();
      if (!isCurrent(session)) return false;
      openStream();
      pollTimer = setTimeout(() => void poll(), 2000);
      return true;
    } catch (failure) {
      fail(failure);
      return false;
    }
  }, [disconnect, isCurrent, refreshMeta]);

  useEffect(() => () => {
    current.current = null;
    dispose.current();
  }, []);

  return { phase, online, wsOpen, status, endpoints, error, retryCount,
    connect, disconnect, refreshMeta, activeSession, isCurrent };
}
