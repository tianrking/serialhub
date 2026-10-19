import { t, getFormattingLocale, translate } from "./i18n/index.ts";
import { LanguageSelector } from "./i18n/LanguageSelector";
import { useLocale } from "./i18n/useLocale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hubApi } from "./api/client";
import type {
  ConnectionConfig,
  LedgerEvent,
  LedgerStatus,
} from "./api/types";
import { httpBase, wsUrl, validateConnection } from "./api/types";
import { bytesToHex, bytesToText } from "./api/wsStream";
import {
  appendLineEnding,
  CONNECTION_PROFILES_STORAGE_KEY,
  loadConnectionProfiles,
  loadQuickCommands,
  newCommandId,
  newProfileId,
  QUICK_COMMANDS_STORAGE_KEY,
  type CommandMode,
  type ConnectionProfile,
  type LineEnding,
  type QuickCommand,
} from "./commandUtils";
import EventLedgerPanel from "./EventLedgerPanel";
import MetricsPanel from "./MetricsPanel";
import ProtocolInspectorPanel from "./ProtocolInspectorPanel";
import WaveformPanel from "./WaveformPanel";
import SignalWorkbench from "./signals/SignalWorkbench";
import { SignalStore } from "./signals/store";
import Icon from "./Icon";
import WorkspaceDialog from "./WorkspaceDialog";
import SerialToolsPanel from "./SerialToolsPanel";
import SerialSettingsPanel from "./SerialSettingsPanel";
import TrafficCounters from "./TrafficCounters";
import { RawCapture, abortableDelay, commandBytes, fullHex, type RunSerialJob, type TextEncoding } from "./serialTools";
import { LogBuffer } from "./logBuffer";
import { useHubConnection, type HubSession } from "./useHubConnection";
import {
  appendHexChecksum,
  checksumLabel,
  type HexChecksum,
} from "./checksumUtils";
import {
  parseCobs,
  parseModbusRtu,
  parseNmea0183,
  parseSlip,
  protocolLabel,
  type ProtocolFrame,
  type StreamProtocol,
} from "./protocolUtils";
import "./App.css";
import "./signals/signals.css";
import "./workspace.css";

type Tab = "monitor" | "signals" | "events" | "endpoints" | "protocol";

type LogLine = {
  id: number;
  ts: string;
  kind: "rx" | "sys" | "tx" | "err";
  text: string;
  hex?: string;
};

const STORAGE_KEY = "ohmyserial.web.conn";
const CLIENT_NAME = "web-ui";
const RECENT_EVENT_LIMIT = 200;
const MAX_QUICK_COMMANDS = 200;
const MAX_LOG_LINES = 2000;

function defaultConn(): ConnectionConfig {
  // 同源：由 hub 提供 http://127.0.0.1:8787/ 時自動連同一主機埠
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "127.0.0.1";
    const portStr = window.location.port;
    const port = portStr
      ? Number(portStr)
      : window.location.protocol === "https:"
        ? 443
        : 80;
    // Vite 開發伺服器 → 仍連預設 hub
    if (port === 5173 || port === 4173) {
      return { host: "127.0.0.1", port: 8787 };
    }
    if (host) {
      return { host, port: port || 8787, protocol: window.location.protocol === "https:" ? "https" : "http" };
    }
  }
  return { host: "127.0.0.1", port: 8787 };
}

function loadConn(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return validateConnection(JSON.parse(raw) as ConnectionConfig);
  } catch {
    /* ignore */
  }
  return defaultConn();
}

function nowTs(): string {
  return new Date().toLocaleTimeString(getFormattingLocale(), { hour12: false });
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Let the browser enqueue the download before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function App({ managedConnection }: { managedConnection?: ConnectionConfig } = {}) {
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("monitor");
  const [dockTab, setDockTab] = useState("device");
  const [conn, setConn] = useState<ConnectionConfig>(() => managedConnection ?? loadConn());
  const [hostInput, setHostInput] = useState(conn.host);
  const [portInput, setPortInput] = useState(String(conn.port));
  const [protocolInput, setProtocolInput] = useState<"http" | "https">(conn.protocol ?? "http");
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(
    loadConnectionProfiles,
  );
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  // Optional remote-API bearer. It is deliberately never persisted.
  const [apiTokenInput, setApiTokenInput] = useState("");
  const inputBearerToken = apiTokenInput.trim() || undefined;
  const { phase, online, wsOpen, status, endpoints, error, retryCount,
    connect: startConnection, disconnect: stopConnection, refreshMeta,
    activeSession, isCurrent } = useHubConnection();
  const apiBearerToken = activeSession()?.bearerToken;
  const endpointAddress = (address: string) => address.startsWith("/sessions/")
    ? new URL(address, httpBase(conn)).href.replace(/^http/, "ws") : address;
  const canWrite = online && phase === "connected" && status?.port.connected === true;

  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);
  const [ledgerEvents, setLedgerEvents] = useState<LedgerEvent[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const ledgerAbortRef = useRef<AbortController | null>(null);
  const [metricsText, setMetricsText] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const metricsAbortRef = useRef<AbortController | null>(null);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logBuffer] = useState(() => new LogBuffer<LogLine>((batch) => {
    setLogs((previous) => [...previous, ...batch].slice(-MAX_LOG_LINES));
  }, MAX_LOG_LINES));
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logId = useRef(0);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  const [capture] = useState(() => new RawCapture());
  const trafficRef = useRef({ rx: 0, tx: 0 });
  const jobRef = useRef<AbortController | null>(null);
  const [jobLabel, setJobLabel] = useState("");
  const [textEncoding, setTextEncoding] = useState<TextEncoding>("utf-8");
  const [receiveEncoding, setReceiveEncoding] = useState("utf-8");
  const receiveEncodingRef = useRef(receiveEncoding);
  receiveEncodingRef.current = receiveEncoding;
  const [sendText, setSendText] = useState("");
  const [sendHistory, setSendHistory] = useState<{ mode: CommandMode; payload: string; ending: LineEnding; checksum: HexChecksum; encoding: TextEncoding; start: number; end: number }[]>([]);
  const [sendMode, setSendMode] = useState<CommandMode>("text");
  const [sendHex, setSendHex] = useState("");
  const [hexChecksum, setHexChecksum] = useState<HexChecksum>("none");
  const [checksumStart, setChecksumStart] = useState(1);
  const [checksumEnd, setChecksumEnd] = useState(0);
  const [lineEnding, setLineEnding] = useState<LineEnding>("lf");
  const [autoSend, setAutoSend] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] = useState(1000);
  const [autoMode, setAutoMode] = useState<CommandMode>("text");
  const [displayMode, setDisplayMode] = useState<"text" | "hex" | "both">("both");
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [streamProtocol, setStreamProtocol] = useState<StreamProtocol>("raw");
  const [signalStore] = useState(() => new SignalStore());
  const [protocolFrames, setProtocolFrames] = useState<ProtocolFrame[]>([]);
  const streamProtocolRef = useRef<StreamProtocol>(streamProtocol);
  const nmeaBufferRef = useRef("");
  const slipBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const cobsBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const modbusBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>(loadQuickCommands);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickMode, setQuickMode] = useState<CommandMode>("text");
  const [quickPayload, setQuickPayload] = useState("");
  const [quickLineEnding, setQuickLineEnding] = useState<LineEnding>("lf");
  const [breakDurationMs, setBreakDurationMs] = useState(100);
  const [busy, setBusy] = useState(false);
  // A write lease is a bearer credential: keep it in memory only and never log it.
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState(0);
  const [leaseRemaining, setLeaseRemaining] = useState(0);
  const operationRef = useRef<HubSession | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [logKind, setLogKind] = useState("all");

  const resetStreamParsers = useCallback(() => {
    nmeaBufferRef.current = "";
    slipBufferRef.current = new Uint8Array();
    cobsBufferRef.current = new Uint8Array();
    modbusBufferRef.current = new Uint8Array();
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    try {
      localStorage.setItem(QUICK_COMMANDS_STORAGE_KEY, JSON.stringify(quickCommands));
    } catch {
      // A private browsing context may deny localStorage. The editor still works in memory.
    }
  }, [quickCommands]);

  useEffect(() => {
    try {
      localStorage.setItem(CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(connectionProfiles));
    } catch {
      // Keep profiles usable in memory when storage is unavailable.
    }
  }, [connectionProfiles]);

  const pushLog = useCallback((line: Omit<LogLine, "id" | "ts"> & { ts?: string }) => {
    logBuffer.push({
      id: ++logId.current,
      ts: line.ts ?? nowTs(),
      kind: line.kind,
      text: line.text.length > 4096 ? t("{p0} … [display truncated]", { p0: String(line.text.slice(0, 4096)) }) : line.text,
      hex: line.hex && line.hex.length > 512 ? `${line.hex.slice(0, 512)} …` : line.hex,
    });
  }, [logBuffer]);

  useEffect(() => () => logBuffer.clear(), [logBuffer]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (jobRef.current || capture.active) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [capture]);

  const saveConnectionProfile = () => {
    const name = profileName.trim();
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      pushLog({ kind: "err", text: t("A profile needs a name, host and valid port") });
      return;
    }
    const profile: ConnectionProfile = {
      id: selectedProfileId || newProfileId(),
      name,
      host,
      port,
      protocol: protocolInput,
    };
    setConnectionProfiles((previous) => [profile, ...previous.filter((item) => item.id !== profile.id)].slice(0, 50));
    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    pushLog({ kind: "sys", text: t("Connection profile saved: {p0}", { p0: String(profile.name) }) });
  };

  const loadConnectionProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = connectionProfiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    setHostInput(profile.host);
    setPortInput(String(profile.port));
    setProtocolInput(profile.protocol ?? "http");
    pushLog({ kind: "sys", text: t("Connection profile loaded: {p0}", { p0: String(profile.name) }) });
  };

  const deleteConnectionProfile = () => {
    if (!selectedProfileId) return;
    const profile = connectionProfiles.find((item) => item.id === selectedProfileId);
    setConnectionProfiles((previous) => previous.filter((item) => item.id !== selectedProfileId));
    setSelectedProfileId("");
    setProfileName("");
    if (profile) pushLog({ kind: "sys", text: t("Connection profile deleted: {p0}", { p0: String(profile.name) }) });
  };

  const consumeProtocolBytes = useCallback((data: Uint8Array) => {
    const currentProtocol = streamProtocolRef.current;
    if (currentProtocol === "nmea0183") {
      const incoming = new TextDecoder().decode(data);
      const parsed = parseNmea0183(nmeaBufferRef.current, incoming);
      nmeaBufferRef.current = parsed.remainder;
      if (parsed.frames.length) setProtocolFrames((previous) => [...previous, ...parsed.frames].slice(-100));
      return;
    }
    if (currentProtocol === "slip") {
      const parsed = parseSlip(slipBufferRef.current, data);
      slipBufferRef.current = parsed.remainder;
      if (parsed.frames.length) setProtocolFrames((previous) => [...previous, ...parsed.frames].slice(-100));
      return;
    }
    if (currentProtocol === "cobs") {
      const parsed = parseCobs(cobsBufferRef.current, data);
      cobsBufferRef.current = parsed.remainder;
      if (parsed.frames.length) setProtocolFrames((previous) => [...previous, ...parsed.frames].slice(-100));
      return;
    }
    if (currentProtocol === "modbusrtu") {
      const parsed = parseModbusRtu(modbusBufferRef.current, data);
      modbusBufferRef.current = parsed.remainder;
      if (parsed.frames.length) setProtocolFrames((previous) => [...previous, ...parsed.frames].slice(-100));
    }
  }, []);

  useEffect(() => {
    streamProtocolRef.current = streamProtocol;
    signalStore.setProtocol(streamProtocol);
    resetStreamParsers();
    setProtocolFrames([]);
  }, [streamProtocol, resetStreamParsers, signalStore]);

  const refreshLedger = useCallback(async (cfg: ConnectionConfig, bearerToken?: string) => {
    const session = activeSession();
    if (!session || !isCurrent(session)) return;
    ledgerAbortRef.current?.abort();
    const controller = new AbortController();
    ledgerAbortRef.current = controller;
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      // The status high-water mark is required before asking for a stable
      // recent window, so this dependency is intentionally sequential.
      const nextStatus = await hubApi.eventsStatus(cfg, bearerToken, AbortSignal.any([controller.signal, session.signal]));
      if (!Number.isSafeInteger(nextStatus.newest_seq) || nextStatus.newest_seq < 0) {
        throw new Error(t("Event sequence exceeds the browser's safe integer range"));
      }
      const oldestCursor = Math.max(0, (nextStatus.oldest_available_seq ?? 1) - 1);
      const recentCursor = Math.max(0, nextStatus.newest_seq - RECENT_EVENT_LIMIT);
      const response = await hubApi.events(
        cfg,
        {
          afterSeq: Math.max(oldestCursor, recentCursor),
          throughSeq: nextStatus.newest_seq,
          limit: RECENT_EVENT_LIMIT,
        },
        bearerToken,
        AbortSignal.any([controller.signal, session.signal]),
      );
      if (response.session_id !== nextStatus.session_id) {
        throw new Error(t("Ledger session changed; refresh the status"));
      }
      if (!isCurrent(session) || controller.signal.aborted) return;
      setLedgerStatus(nextStatus);
      setLedgerEvents(response.page.events);
    } catch (ledgerFailure) {
      if (isCurrent(session) && !controller.signal.aborted && !(ledgerFailure instanceof DOMException && ledgerFailure.name === "AbortError")) {
        setLedgerError(
          t("Cannot read the event ledger: {p0}", { p0: String(ledgerFailure instanceof Error ? ledgerFailure.message : String(ledgerFailure)) }),
        );
      }
    } finally {
      if (ledgerAbortRef.current === controller) {
        ledgerAbortRef.current = null;
        setLedgerLoading(false);
      }
    }
  }, [activeSession, isCurrent]);

  const refreshMetrics = useCallback(async (cfg: ConnectionConfig, bearerToken?: string) => {
    const session = activeSession();
    if (!session || !isCurrent(session)) return;
    metricsAbortRef.current?.abort();
    const controller = new AbortController();
    metricsAbortRef.current = controller;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const text = await hubApi.metrics(cfg, bearerToken, AbortSignal.any([controller.signal, session.signal]));
      if (isCurrent(session) && !controller.signal.aborted) setMetricsText(text);
    } catch (metricsFailure) {
      if (isCurrent(session) && !controller.signal.aborted && !(metricsFailure instanceof DOMException && metricsFailure.name === "AbortError")) {
        setMetricsError(metricsFailure instanceof Error ? metricsFailure.message : String(metricsFailure));
      }
    } finally {
      if (metricsAbortRef.current === controller) {
        metricsAbortRef.current = null;
        setMetricsLoading(false);
      }
    }
  }, [activeSession, isCurrent]);

  useEffect(() => {
    if (tab !== "events" || !online) return;
    const session = activeSession();
    if (!session) return;
    void refreshLedger(session.cfg, session.bearerToken);
    void refreshMetrics(session.cfg, session.bearerToken);
    return () => { ledgerAbortRef.current?.abort(); metricsAbortRef.current?.abort(); };
  }, [tab, online, activeSession, refreshLedger, refreshMetrics]);

  const disconnect = useCallback(() => {
    if (operationRef.current) pushLog({ kind: "err", text: t("Session ended. An in-flight operation may have reached the device. Check events before retrying.") });
    jobRef.current?.abort(new Error(t("Session disconnected")));
    capture.stop(t("Session disconnected; recording stopped"));
    signalStore.close(t("Browser session disconnected"));
    stopConnection();
    operationRef.current = null;
    setBusy(false);
    setAutoSend(false);
    ledgerAbortRef.current?.abort();
    ledgerAbortRef.current = null;
    metricsAbortRef.current?.abort();
    metricsAbortRef.current = null;
    setLeaseToken(null);
    setLedgerStatus(null);
    setLedgerEvents([]);
    setLedgerError(null);
    setLedgerLoading(false);
    setMetricsText("");
    setMetricsError(null);
    setMetricsLoading(false);
  }, [stopConnection, pushLog, capture, signalStore]);

  const connect = useCallback(async () => {
    disconnect();
    const cfg: ConnectionConfig = managedConnection ?? {
      host: hostInput.trim(), port: Number(portInput), protocol: protocolInput,
    };
    trafficRef.current = { rx: 0, tx: 0 };
    let decoderEncoding = receiveEncodingRef.current;
    let textDecoder = new TextDecoder(decoderEncoding);
    const connected = await startConnection(cfg, inputBearerToken, {
      onOpen: () => {
        decoderEncoding = receiveEncodingRef.current;
        textDecoder = new TextDecoder(decoderEncoding);
        resetStreamParsers();
        signalStore.open();
        setProtocolFrames([]);
        pushLog({ kind: "sys", text: t("Live stream connected {p0}", { p0: String(wsUrl(cfg)) }) });
      },
      onClose: () => {
        jobRef.current?.abort(new Error(t("Live stream interrupted")));
        capture.stop(t("Stream interrupted; recording stopped"));
        signalStore.close();
        pushLog({ kind: "err", text: t("Stream interrupted; reconnecting. Automatic sending stopped. The first packet may contain history.") });
      },
      onServerError: (message) => pushLog({ kind: "err", text: `Hub：${message}` }),
      onBytes: (data, meta) => {
        trafficRef.current.rx += data.byteLength;
        capture.add(data, meta.isHistoryHint);
        signalStore.feed(data, meta.isHistoryHint);
        if (decoderEncoding !== receiveEncodingRef.current) {
          decoderEncoding = receiveEncodingRef.current;
          textDecoder = new TextDecoder(decoderEncoding);
        }
        if (pausedRef.current) {
          textDecoder = new TextDecoder(receiveEncodingRef.current);
          resetStreamParsers();
          return;
        }
        consumeProtocolBytes(data);
        pushLog({ kind: "rx", text: `${meta.isHistoryHint ? `${t("[may contain history]")} ` : ""}${bytesToText(data, textDecoder).replace(/\n/g, "\\n")}`, hex: bytesToHex(data) });
      },
    });
    if (!connected) return;
    setConn(cfg);
    try { if (!managedConnection) localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* Memory-only still works. */ }
  }, [managedConnection, disconnect, hostInput, portInput, protocolInput, inputBearerToken, startConnection,
    consumeProtocolBytes, pushLog, resetStreamParsers, capture, signalStore]);

  const managedConnect = useRef(connect);
  managedConnect.current = connect;
  useEffect(() => {
    if (!managedConnection) return;
    void managedConnect.current();
    return disconnect;
  }, [managedConnection, disconnect]);

  useEffect(() => {
    if (!canWrite) {
      setAutoSend(false);
      jobRef.current?.abort(new Error(t("Device or live stream offline")));
      capture.stop(t("Device or stream offline; recording stopped"));
    }
    if (!online || phase === "reconnecting" || !status?.port.connected) {
      setLeaseToken(null);
      setLeaseExpiresAt(0);
    }
  }, [canWrite, online, phase, status?.port.connected, capture]);

  useEffect(() => {
    setLeaseToken(null);
    setLeaseExpiresAt(0);
    jobRef.current?.abort(new Error(t("Device connection epoch changed")));
    capture.stop(t("Device connection changed; recording stopped"));
    if (signalStore.getSnapshot().source === "live") signalStore.clear(t("Device connection changed"));
  }, [status?.port.epoch, capture, signalStore]);

  useEffect(() => {
    if (!leaseToken) { setLeaseRemaining(0); return; }
    const update = () => {
      const remaining = Math.max(0, leaseExpiresAt - Date.now());
      setLeaseRemaining(remaining);
      if (!remaining) setLeaseToken(null);
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [leaseToken, leaseExpiresAt]);

  const beginOperation = useCallback(() => {
    const session = activeSession();
    if (!canWrite || !session || !isCurrent(session) || !session.streamOpen
        || !session.deviceConnected || operationRef.current) return null;
    operationRef.current = session;
    setBusy(true);
    return session;
  }, [activeSession, canWrite, isCurrent]);

  const endOperation = useCallback((session: HubSession) => {
    if (operationRef.current !== session) return;
    operationRef.current = null;
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!autoScroll || !logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs, autoScroll]);

  useEffect(
    () => () => {
      ledgerAbortRef.current?.abort();
      metricsAbortRef.current?.abort();
      jobRef.current?.abort(new Error(t("Page closed")));
      capture.stop(t("Page closed"));
      signalStore.dispose();
    },
    [capture, signalStore],
  );

  const transmit = useCallback(async (
    mode: CommandMode, payload: string, ending: LineEnding, checksum: HexChecksum = "none",
  ): Promise<boolean> => {
    if (!payload.length || (mode === "hex" && !payload.trim())) return false;
    const session = beginOperation();
    if (!session) return false;
    try {
      const bytes = commandBytes({ id: "current", name: t("Current command"), mode, payload, lineEnding: ending }, textEncoding, checksum, { start: checksumStart - 1, end: checksumEnd || undefined });
      if (bytes.length > 65536) throw new Error(t("Commands are limited to 65,536 bytes; use file transfer"));
      const wire = fullHex(bytes);
      const response = await hubApi.writeHex(session.cfg, wire, { as_client: CLIENT_NAME, lease_token: leaseToken ?? undefined,
        bearer_token: session.bearerToken, signal: session.signal });
      if (!isCurrent(session)) return false;
      if (!response.ok || response.bytes !== bytes.length) throw new Error(response.error || t("Write length not fully acknowledged; sending stopped"));
      trafficRef.current.tx += response.bytes;
      setSendHistory(previous => [{ mode, payload, ending, checksum, encoding: textEncoding, start: checksumStart, end: checksumEnd },
        ...previous.filter(item => item.mode !== mode || item.payload !== payload || item.ending !== ending || item.checksum !== checksum || item.encoding !== textEncoding)].slice(0, 20));
      const display = mode === "text" ? appendLineEnding(payload, ending) : wire;
      pushLog({ kind: "tx", text: t("Host acknowledged {p0} bytes · {p1}{p2}", { p0: String(response.bytes), p1: String(display.replace(/\r/g, "\\r").replace(/\n/g, "\\n")), p2: String(checksum !== "none" ? ` · ${checksumLabel(checksum)}` : "") }) });
      return true;
    } catch (failure) {
      if (isCurrent(session)) {
        setAutoSend(false);
        pushLog({ kind: "err", text: t("Write not acknowledged: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) });
      }
      return false;
    } finally { endOperation(session); }
  }, [beginOperation, endOperation, isCurrent, leaseToken, pushLog, textEncoding, checksumStart, checksumEnd]);

  const runJob: RunSerialJob = async (name, task) => {
    const session = beginOperation();
    if (!session) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    jobRef.current = controller;
    setAutoSend(false); setJobLabel(name);
    // Freeze the lease and connection for the entire job. Never retry a chunk.
    const lease = leaseToken ?? undefined;
    let renewAt = 0;
    const maintainLease = async () => {
      signal.throwIfAborted();
      if (!lease || Date.now() < renewAt) return;
      const response = await hubApi.lock(session.cfg, CLIENT_NAME, lease, session.bearerToken, session.signal);
      signal.throwIfAborted();
      if (!isCurrent(session) || !response.ok || !response.lock || response.lock.lease_token !== lease) {
        throw new Error(response.error || t("Existing write lease renewal failed"));
      }
      renewAt = Date.now() + Math.max(1, response.lock.expires_ms / 2);
      setLeaseToken(lease);
      setLeaseExpiresAt(Date.now() + response.lock.expires_ms);
    };
    try {
      await task({ signal,
        pause: async ms => {
          const until = performance.now() + ms;
          do {
            await maintainLease();
            const remaining = Math.max(0, until - performance.now());
            await abortableDelay(Math.min(remaining, lease ? Math.max(1, renewAt - Date.now()) : remaining), signal);
          } while (performance.now() < until);
        },
        write: async bytes => {
          await maintainLease();
          signal.throwIfAborted();
          if (!isCurrent(session) || !session.streamOpen || !session.deviceConnected) throw new Error(t("Device or live stream offline"));
          if (!bytes.length || bytes.length > 65536) throw new Error(t("Send blocks must contain 1–65,536 bytes"));
          // A user stop waits for this ACK: aborting HTTP does not undo serial TX.
          const response = await hubApi.writeHex(session.cfg, fullHex(bytes), { as_client: CLIENT_NAME,
            lease_token: lease, bearer_token: session.bearerToken, signal: session.signal });
          if (!response.ok || response.bytes !== bytes.length) throw new Error(response.error || t("Write length not fully acknowledged"));
          if (isCurrent(session)) trafficRef.current.tx += response.bytes;
        },
      });
      if (isCurrent(session)) pushLog({ kind: "sys", text: t("{p0} · completed", { p0: String(name) }) });
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: t("{p0} · stopped: {p1}. Confirmed bytes cannot be undone; check the ledger for unconfirmed writes.", { p0: String(name), p1: String(failure instanceof Error ? failure.message : String(failure)) }) });
    } finally {
      if (jobRef.current === controller) { jobRef.current = null; setJobLabel(""); }
      endOperation(session);
    }
  };

  const inspectSerial = async () => {
    const session = activeSession();
    if (!session) return null;
    const [settings, ports] = await Promise.all([
      hubApi.serialSettings(session.cfg, session.bearerToken, session.signal),
      hubApi.serialPorts(session.cfg, session.bearerToken, session.signal),
    ]);
    return isCurrent(session) ? { settings: settings.settings, ports: ports.ports } : null;
  };
  const applySerial = async (settings: import("./api/types").SerialSettings) => {
    const session = beginOperation();
    if (!session) return false;
    try {
      if (!leaseToken) throw new Error(t("Acquire a write lease first"));
      const response = await hubApi.configureSerial(session.cfg, settings, CLIENT_NAME, leaseToken, session.bearerToken, session.signal);
      if (!response.ok) throw new Error(response.error || t("Serial settings not acknowledged"));
      if (!isCurrent(session)) return false;
      pushLog({ kind: "sys", text: t("Serial settings acknowledged: {p0} / {p1} / {p2} / {p3} / {p4}", { p0: String(settings.baud), p1: String(settings.databits), p2: String(settings.parity), p3: String(settings.stopbits), p4: String(settings.flow) }) });
      await refreshMeta();
      return true;
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: t("Settings update failed: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) });
      return false;
    } finally { endOperation(session); }
  };

  const onSendText = () => void transmit("text", sendText, lineEnding);

  const onSendHex = () => void transmit("hex", sendHex, "none", hexChecksum);

  const hexPreview = useMemo(() => {
    if (!sendHex.trim()) return { text: "", invalid: false };
    try {
      return { text: appendHexChecksum(sendHex, hexChecksum, { start: checksumStart - 1, end: checksumEnd || undefined }), invalid: false };
    } catch (e) {
      return { text: translate(locale, "Error: {p0}", { p0: e instanceof Error ? e.message : String(e) }), invalid: true };
    }
  }, [hexChecksum, sendHex, checksumStart, checksumEnd, locale]);

  useEffect(() => {
    if (!autoSend || !canWrite || autoIntervalMs < 50 || !Number.isFinite(autoIntervalMs)) return;
    const timer = window.setInterval(() => {
      if (busy) return;
      const payload = autoMode === "text" ? sendText : sendHex;
      void transmit(
        autoMode,
        payload,
        autoMode === "text" ? lineEnding : "none",
        autoMode === "hex" ? hexChecksum : "none",
      );
    }, autoIntervalMs);
    return () => window.clearInterval(timer);
  }, [autoIntervalMs, autoMode, autoSend, busy, hexChecksum, lineEnding, canWrite, sendHex, sendText, transmit]);

  const resetQuickEditor = () => {
    setEditingCommandId(null);
    setQuickName("");
    setQuickMode("text");
    setQuickPayload("");
    setQuickLineEnding("lf");
  };

  const saveQuickCommand = () => {
    const name = quickName.trim();
    if (!name || !quickPayload.trim()) {
      pushLog({ kind: "err", text: t("A shortcut needs a name and content") });
      return;
    }
    const next: QuickCommand = {
      ...quickCommands.find(command => command.id === editingCommandId),
      id: editingCommandId ?? newCommandId(),
      name,
      mode: quickMode,
      payload: quickPayload,
      lineEnding: quickMode === "text" ? quickLineEnding : "none",
    };
    setQuickCommands((previous) => {
      const withoutCurrent = previous.filter((command) => command.id !== next.id);
      return [next, ...withoutCurrent].slice(0, MAX_QUICK_COMMANDS);
    });
    pushLog({ kind: "sys", text: t("{p0} shortcut: {p1}", { p0: String(editingCommandId ? t("Updated") : t("Saved")), p1: String(name) }) });
    resetQuickEditor();
  };

  const editQuickCommand = (command: QuickCommand) => {
    setEditingCommandId(command.id);
    setQuickName(command.name);
    setQuickMode(command.mode);
    setQuickPayload(command.payload);
    setQuickLineEnding(command.lineEnding);
  };

  const deleteQuickCommand = (command: QuickCommand) => {
    setQuickCommands((previous) => previous.filter((item) => item.id !== command.id));
    if (editingCommandId === command.id) resetQuickEditor();
    pushLog({ kind: "sys", text: t("Shortcut deleted: {p0}", { p0: String(command.name) }) });
  };

  const visibleLogs = useMemo(() => logs.filter((line) =>
    (logKind === "all" || line.kind === logKind)
    && (!logSearch.trim() || `${line.text} ${line.hex ?? ""}`.toLowerCase().includes(logSearch.trim().toLowerCase())),
  ), [logs, logKind, logSearch]);

  const exportVisibleLogs = () => {
    const text = visibleLogs
      .map((line) => `${line.ts}\t${line.kind.toUpperCase()}\t${line.text}${line.hex ? `\t${line.hex}` : ""}`)
      .join("\n");
    downloadTextFile(`serialhub-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, text);
    pushLog({ kind: "sys", text: t("Exported {p0} page log entries", { p0: String(visibleLogs.length) }) });
  };

  const exportLedger = async () => {
    try {
      const session = activeSession();
      if (!session || !isCurrent(session)) return;
      const ndjson = await hubApi.eventsExport(session.cfg, session.bearerToken, session.signal);
      if (!isCurrent(session)) return;
      downloadTextFile(
        `serialhub-events-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`,
        ndjson,
        "application/x-ndjson;charset=utf-8",
      );
      pushLog({ kind: "sys", text: t("Exported {p0} event records", { p0: String(ndjson.split("\n").filter(Boolean).length) }) });
    } catch (exportFailure) {
      pushLog({ kind: "err", text: t("Event export failed: {p0}", { p0: String(exportFailure instanceof Error ? exportFailure.message : String(exportFailure)) }) });
    }
  };

  const exportMetrics = () => {
    downloadTextFile(
      `serialhub-metrics-${new Date().toISOString().replace(/[:.]/g, "-")}.prom`,
      metricsText,
      "text/plain;charset=utf-8",
    );
  };

  const onLock = async () => {
    const session = beginOperation();
    if (!session) return;
    try {
      const response = await hubApi.lock(session.cfg, CLIENT_NAME, leaseToken ?? undefined, session.bearerToken, session.signal);
      if (!isCurrent(session)) return;
      if (!response.ok || !response.lock) throw new Error(response.error || t("Server did not return a write lease"));
      setLeaseToken(response.lock.lease_token);
      setLeaseExpiresAt(Date.now() + response.lock.expires_ms);
      pushLog({ kind: "sys", text: t("Write lease acquired · {p0} ms", { p0: String(response.lock.expires_ms) }) });
      await refreshMeta();
    } catch (failure) {
      if (isCurrent(session)) {
        setLeaseToken(null);
        pushLog({ kind: "err", text: t("Cannot acquire lease: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) });
      }
    } finally { endOperation(session); }
  };

  const onUnlock = async () => {
    if (!leaseToken) return;
    const session = beginOperation();
    if (!session) return;
    try {
      const response = await hubApi.unlock(session.cfg, leaseToken, session.bearerToken, session.signal);
      if (!isCurrent(session)) return;
      if (!response.ok) throw new Error(response.error || t("Lease release failed"));
      setLeaseToken(null);
      pushLog({ kind: "sys", text: t("Write lease released") });
      await refreshMeta();
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: t("Release failed: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) });
    } finally { endOperation(session); }
  };

  const onControl = async (body:
    | { op: "dtr" | "rts"; level: boolean }
    | { op: "break"; duration_ms: number },
  ) => {
    if (!leaseToken || status?.port.path.startsWith("mock:")) return;
    const session = beginOperation();
    if (!session) return;
    try {
      const response = await hubApi.control(session.cfg,
        { ...body, as_client: CLIENT_NAME, lease_token: leaseToken }, session.bearerToken, session.signal);
      if (!isCurrent(session)) return;
      if (!response.ok) throw new Error(response.error || t("Control operation failed"));
      pushLog({ kind: "sys", text: body.op === "break"
        ? t("BREAK {p0} ms acknowledged", { p0: String(body.duration_ms) }) : t("{p0} {p1} acknowledged", { p0: String(body.op.toUpperCase()), p1: String(body.level ? "ON" : "OFF") }) });
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: t("Control failed: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) });
    } finally { endOperation(session); }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushLog({ kind: "sys", text: t("Copied: {p0}", { p0: String(text) }) });
    } catch {
      pushLog({ kind: "err", text: t("Copy failed") });
    }
  };

  const statusLamp = useMemo(() => {
    if (phase === "connecting") return { cls: "warn", label: translate(locale, "Connecting…") };
    if (phase === "reconnecting") return { cls: "warn", label: translate(locale, "Reconnecting stream · {p0}/5", { p0: String(retryCount) }) };
    if (phase === "error") return { cls: "off", label: translate(locale, "Connection error") };
    if (online && wsOpen) return { cls: "ok", label: translate(locale, "Connected · HTTP + WS") };
    if (online) return { cls: "warn", label: translate(locale, "HTTP ready; WS disconnected") };
    return { cls: "off", label: translate(locale, "Disconnected") };
  }, [online, wsOpen, phase, retryCount, locale]);

  return (
    <div className="app" data-workspace={tab}>
      <a className="skip-link" href="#main-content">{t("Skip to workspace")}</a>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="layers" size={25} /></span><div>SerialHub<small>{t("DEVICE WORKSPACE")}</small></div></div>
        <div className="nav-label">{t("Workspace")}</div>
        <nav className="sidebar-nav" aria-label={t("Main navigation")}>
          {([
            ["monitor", "terminal", t("Live console"), "01"],
            ["signals", "activity", t("Signal studio"), "02"],
            ["events", "activity", t("Events & metrics"), "03"],
            ["endpoints", "layers", t("Connections"), "04"],
            ["protocol", "book", t("User guide"), "05"],
          ] as const).map(([id, icon, label, number]) => <button type="button" key={id}
            className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}><Icon name={icon} /><span title={label}>{label}</span><small>{number}</small></button>)}
        </nav>
        <div className="sidebar-note"><Icon name="shield" /><strong>{t("One port, coordinated access")}</strong><p>{t("Manage device access centrally,")} <br /> {t("with a record of every operation.")}</p><span>{t("OPEN SOURCE · MIT")}</span></div>
        <div className="sidebar-footer"><span className="version-dot" />SerialHub <code>v{__APP_VERSION__}</code></div>
      </aside>
      <header className="header">
        <div><div className="eyebrow">{t("WORKSPACE")} <span>/</span> {tab === "signals" ? "SIGNAL STUDIO" : tab === "monitor" ? "LIVE CONSOLE" : tab === "events" ? "EVENT EVIDENCE" : tab === "endpoints" ? "CONNECTIONS" : "GUIDE"}</div>
          <h1>{tab === "signals" ? t("Signals & visualization") : tab === "monitor" ? t("Serial workspace") : tab === "events" ? t("Events & runtime metrics") : tab === "endpoints" ? t("Connections") : t("User guide")}<span className="heading-dot" aria-hidden="true">.</span></h1>
          <p className="sub">{t("Connect, inspect data and keep debugging organized.")}</p>
        </div>
        <div className="header-status"><LanguageSelector /><span className="local-badge"><Icon name="shield" size={14} /> {t("Single device owner")}</span><div className={`lamp ${statusLamp.cls}`} role="status">{statusLamp.label}</div></div>
      </header>
      <main id="main-content">
      {managedConnection && error && <div className="managed-error" role="alert">{error}<button onClick={() => void connect()}>{t("Reconnect")}</button></div>}
      <section className={`panel connect${managedConnection ? " managed-connect" : ""}`}>
        <div className="connection-heading"><h2><Icon name="layers" size={16} /> {t("Connection profiles")}</h2><span>{online ? (status?.port.path.startsWith("mock:") ? t("Mock device · no hardware required") : t("Device session")) : t("Local Hub or HTTPS reverse proxy")}</span></div>
        <div className="row">
          <label>{t("Host")} <input
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
          <label>{t("Port")} <input
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="8787"
              className="port"
            />
          </label>
          <label>{t("Protocol")} <select aria-label={t("Connection protocol")} value={protocolInput} onChange={(event) => setProtocolInput(event.target.value as "http" | "https")}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label>{t("Access token (optional)")} <input
              type="password"
              autoComplete="off"
              value={apiTokenInput}
              onChange={(e) => setApiTokenInput(e.target.value)}
              placeholder={t("Used only for this session")}
            />
          </label>
          <button type="button" disabled={phase === "connecting"} onClick={() => void connect()}>
            {phase === "connecting" ? t("Connecting to Hub…") : online ? t("Reconnect") : t("Connect to Hub")}
          </button>
          <button type="button" className="ghost" disabled={phase === "idle"} onClick={disconnect}>{t("Disconnect")}</button>
        </div>
        <WorkspaceDialog label={t("Connection profiles")} className="profile-settings"><p className="hint">{t("Saved in this browser without tokens.")}</p><div className="row profile-row">
          <label>{t("Connection profile")} <select value={selectedProfileId} onChange={(e) => loadConnectionProfile(e.target.value)}>
              <option value="">{t("Select a saved profile")}</option>
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.host}:{profile.port}
                </option>
              ))}
            </select>
          </label>
          <label>{t("Profile name")} <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder={t("e.g. Local Hub")}
            />
          </label>
          <button type="button" className="ghost" onClick={saveConnectionProfile}>{t("Save profile")}</button>
          <button
            type="button"
            className="ghost"
            disabled={!selectedProfileId}
            onClick={deleteConnectionProfile}
          >{t("Delete profile")}</button>
        </div>
        </WorkspaceDialog>
        {!online && !error && <p className="connection-help">{t("First time? On the device host, run")} <code>serialhub share mock:demo</code> {t("to try mock loopback.")}</p>}
        {error && <p className="error connection-error" role="alert">{error}<span>{t("Check the address, token and Hub, then reconnect. Writes are never retried automatically.")}</span></p>}
      </section>
      <section className="overview" aria-label={t("Device overview")}>
        <div className="overview-device"><span className={`device-indicator ${canWrite ? "ready" : ""}`}><Icon name="terminal" size={23} /></span><div><small>{t("Device")}</small><strong>{online ? status?.port.path : t("Waiting for connection")}</strong><span>{online ? `${status?.port.baud.toLocaleString(getFormattingLocale())} baud · ${status?.port.connected ? t("Device open") : t("Device offline")}` : t("Choose a Hub to start debugging")}</span></div>{online && status?.port.path.startsWith("mock:") && <b className="simulation-label">MOCK</b>}</div>
        <div><small>{t("RX received")}</small><strong>{online ? status?.stats.rx_bytes.toLocaleString(getFormattingLocale()) : "—"}<span>{t("bytes")}</span></strong></div>
        <div><small>{t("TX sent")}</small><strong>{online ? status?.stats.tx_bytes.toLocaleString(getFormattingLocale()) : "—"}<span>{t("bytes")}</span></strong></div>
        <div><small>{t("Clients online")}</small><strong>{online ? status?.clients.length : "—"}<span>{t("clients")}</span></strong></div>
        <div className={status?.stats.rx_drops ? "has-drops" : ""}><small>{t("RX drops")}</small><strong>{online ? status?.stats.rx_drops.toLocaleString(getFormattingLocale()) : "—"}<span>{t("chunks")}</span></strong></div>
            <div className="lease-actions">
              <button type="button" disabled={!canWrite || busy} onClick={() => void onLock()}>{t("Acquire write lease")}</button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken}
                onClick={() => void onUnlock()}
              >{t("Release lease")}</button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy}
                onClick={() => void refreshMeta().catch((failure) => pushLog({ kind: "err", text: t("Status read failed: {p0}", { p0: String(failure instanceof Error ? failure.message : String(failure)) }) }))}
              >{t("Refresh status")}</button>
            </div>
      </section>
      {jobLabel && <div className="job-status" role="status"><span className="stream-dot live" /><strong>{jobLabel}</strong><span>{t("Serial send job running")}</span><button type="button" onClick={() => { jobRef.current?.abort(new Error(t("Stopped by user"))); }}>{t("Stop send job")}</button><small>{t("Stops after the current block ACK; no automatic retry")}</small></div>}
      <div className="workspace-heading"><div><span className="section-index">{({ monitor: "01", signals: "02", events: "03", endpoints: "04", protocol: "05" })[tab]}</span><h2>{tab === "signals" ? t("Signal studio") : tab === "monitor" ? t("Live monitoring") : tab === "events" ? t("Event evidence") : tab === "endpoints" ? t("Shared endpoints") : t("Protocol & operations")}</h2></div><span>{online ? httpBase(conn) : t("No active session")}</span></div>
      {(
        <div className="grid" hidden={tab !== "monitor"}>
          <section className="panel composer-panel">
            <div className="composer-heading"><h2>{t("Send command")}</h2><span>{t("Host write acknowledgement")}</span></div>{sendHistory.length > 0 && <label className="send-history">{t("Recent sends")} <select aria-label={t("Recent sends")} value="" onChange={event => {
              const item = sendHistory[Number(event.target.value)];
              if (!item) return;
              setSendMode(item.mode); setTextEncoding(item.encoding); setLineEnding(item.ending); setHexChecksum(item.checksum);
              setChecksumStart(item.start); setChecksumEnd(item.end);
              if (item.mode === "text") setSendText(item.payload); else setSendHex(item.payload);
            }}><option value="">{t("Load history (does not send)")}</option>{sendHistory.map((item, index) => <option key={index} value={index}>{item.mode.toUpperCase()} · {item.payload.slice(0, 35)}</option>)}</select></label>}<div className="segmented" role="group" aria-label={t("Send format")}><button type="button" className={sendMode === "text" ? "active" : ""} aria-pressed={sendMode === "text"} onClick={() => setSendMode("text")}>{t("Text")}</button><button type="button" className={sendMode === "hex" ? "active" : ""} aria-pressed={sendMode === "hex"} onClick={() => setSendMode("hex")}>{t("HEX bytes")}</button></div><div hidden={sendMode !== "text"}>
            <label className="block">{t("Message")} <textarea
                dir="auto"
                rows={3}
                maxLength={65536}
                value={sendText}
                onChange={(e) => setSendText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    onSendText();
                  }
                }}
                placeholder={t("e.g. AT or a device command")}
              />
            </label>
            <div className="row composer-options">
              <label>{t("Text encoding")} <select aria-label={t("Send text encoding")} value={textEncoding} onChange={event => setTextEncoding(event.target.value as TextEncoding)}><option value="utf-8">UTF-8</option><option value="gbk">{t("GBK / ANSI Chinese")}</option><option value="ascii">{t("ASCII (strict)")}</option></select></label>
              <label>{t("Line ending")} <select
                  value={lineEnding}
                  onChange={(e) => setLineEnding(e.target.value as LineEnding)}
                >
                  <option value="none">{t("No line ending")}</option>
                  <option value="lf">LF (\\n)</option>
                  <option value="cr">CR (\\r)</option>
                  <option value="crlf">CRLF (\\r\\n)</option>
                </select>
              </label>
              <span className="hint inline-hint">{t("Ctrl/⌘ + Enter to send")}</span>
            </div>
            <button type="button" className="send-button" disabled={!canWrite || busy || !sendText.length} onClick={() => void onSendText()}>{t("Send text")}</button>
            </div><div hidden={sendMode !== "hex"}><label className="block">{t("Hexadecimal")} <input
                value={sendHex}
                dir="ltr"
                maxLength={196608}
                onChange={(e) => setSendHex(e.target.value)}
                placeholder="41 54 0d 0a"
              />
            </label>
            <div className="row composer-options">
              <label>{t("Checksum")} <select
                  value={hexChecksum}
                  onChange={(e) => setHexChecksum(e.target.value as HexChecksum)}
                >
                  <option value="none">{t("No checksum")}</option>
                  <option value="sum8">SUM8</option>
                  <option value="sum16">SUM16 (Lo/Hi)</option>
                  <option value="crc32">CRC32/ISO-HDLC (Lo/Hi)</option>
                  <option value="xor8">XOR8</option>
                  <option value="crc16-modbus">CRC16-Modbus (Lo/Hi)</option>
                  <option value="crc16-ccitt">CRC16-CCITT (Hi/Lo)</option>
                </select>
              </label>
              {hexChecksum !== "none" && <div className="checksum-range"><label>{t("Checksum start byte")} <input aria-label={t("Checksum start byte")} type="number" min={1} value={checksumStart} onChange={event => setChecksumStart(Math.max(1, Math.trunc(Number(event.target.value) || 1)))} /></label><label>{t("End byte (0 = last)")} <input aria-label={t("Checksum end byte")} type="number" min={0} value={checksumEnd} onChange={event => setChecksumEnd(Math.max(0, Math.trunc(Number(event.target.value) || 0)))} /></label><small>{t("One-based, inclusive range")}</small></div>}
              {hexPreview.text && (
                <span className={`hint inline-hint ${hexPreview.invalid ? "error" : ""}`}>{t("Send preview:")} <code dir="ltr">{hexPreview.text}</code>
                </span>
              )}
            </div>
            <button type="button" className="send-button" disabled={!canWrite || busy || !sendHex.trim() || hexPreview.invalid} onClick={() => void onSendHex()}>{t("Send Hex")}</button>
            </div><details className="auto-send-settings"><summary>{t("Scheduled sending")} <span>{t("Stops on stream loss or write failure")}</span></summary><div className="row auto-send-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                  disabled={!canWrite || (busy && !autoSend)}
                /> {t("Repeat current content")}</label>
              <label>{t("Mode")} <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as CommandMode)}>
                  <option value="text">{t("Plain text")}</option>
                  <option value="hex">Hex</option>
                </select>
              </label>
              <label>{t("Interval (ms)")} <input
                  className="interval-input"
                  type="number"
                  min={50}
                  max={86400000}
                  step={50}
                  value={autoIntervalMs}
                  onChange={(e) => setAutoIntervalMs(Math.min(86400000, Math.max(50, Number(e.target.value) || 50)))}
                />
              </label>
            </div>
            </details><p className="composer-note"><Icon name="shield" size={14} /> {t("Shared TX arbitration; a host ACK is not a device response.")}</p>
          </section>

          <aside className="workbench-dock" aria-label={t("Workspace tool panel")}>
            <div className="dock-tabs" role="tablist" aria-label={t("Workspace tools")}>
              {([["device", t("Device settings")], ["quick", t("Shortcuts")], ["tools", t("Toolkit")], ["protocol", t("Protocol frames")]] as const).map(([id, label], index, tabs) =>
                <button type="button" role="tab" key={id} id={`dock-tab-${id}`} aria-controls={`dock-${id}`} aria-selected={dockTab === id} tabIndex={dockTab === id ? 0 : -1}
                  onClick={() => setDockTab(id)} onKeyDown={event => {
                    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
                    if (next >= 0) { event.preventDefault(); setDockTab(tabs[next]![0]); document.getElementById(`dock-tab-${tabs[next]![0]}`)?.focus(); }
                  }}>{label}</button>)}
            </div>
            <div className="dock-content">
              <div role="tabpanel" id="dock-device" aria-labelledby="dock-tab-device" hidden={dockTab !== "device"}>
          <section className="panel device-panel">
            <h2><Icon name="shield" size={17} /> {t("Device & write permissions")}</h2>
            {status ? (
              <dl className="kv">
                <dt>{t("Device path")}</dt>
                <dd>
                  {status.port.path}{" "}
                  <span className={status.port.connected ? "tag ok" : "tag off"}>
                    {status.port.connected ? t("Open") : t("Disconnected")}
                  </span>
                </dd>
                <dt>{t("Baud rate")}</dt>
                <dd>{status.port.baud}</dd>
                <dt>{t("Connection details")}</dt>
                <dd>{status.port.detail}</dd>
                <dt>{t("TX mode")}</dt>
                <dd>
                  <code>{status.tx_mode}</code>
                </dd>
                <dt>{t("Write lease")}</dt>
                <dd>
                  {status.lock_owner
                    ? t("{p0} ({p1} ms remaining)", { p0: String(status.lock_owner), p1: String(status.lock_expires_ms ?? "?") })
                    : t("Not held")}
                </dd>
                <dt>{t("Statistics")}</dt>
                <dd>
                  RX {status.stats.rx_bytes} · TX {status.stats.tx_bytes} · drop{" "}
                  {status.stats.rx_drops} · deny {status.stats.tx_denies}
                </dd>
                <dt>{t("Client count")}</dt>
                <dd>{status.clients.length}</dd>
              </dl>
            ) : (
              <p className="muted">{t("Not connected yet")}</p>
            )}
            <SerialSettingsPanel online={online} busy={busy} canApply={canWrite && !!leaseToken && !status?.port.path.startsWith("mock:")}
              inspect={inspectSerial} apply={applySerial} sessionKey={activeSession()} />
            {leaseToken && <p className="lease-countdown" role="status">{t("This page holds the lease · remaining")} {(leaseRemaining / 1000).toFixed(1)} {t("seconds")}</p>}<details className="hardware-controls"><summary>{t("Hardware control lines")} <span>{status?.port.path.startsWith("mock:") ? t("Unsupported by mock devices") : t("Requires server permission and a valid lease")}</span></summary><div className="row control-row">
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken || status?.port.path.startsWith("mock:")}
                onClick={() => void onControl({ op: "dtr", level: true })}
              >
                DTR ON
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken || status?.port.path.startsWith("mock:")}
                onClick={() => void onControl({ op: "dtr", level: false })}
              >
                DTR OFF
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken || status?.port.path.startsWith("mock:")}
                onClick={() => void onControl({ op: "rts", level: true })}
              >
                RTS ON
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken || status?.port.path.startsWith("mock:")}
                onClick={() => void onControl({ op: "rts", level: false })}
              >
                RTS OFF
              </button>
              <label>
                BREAK (ms)
                <input
                  className="interval-input"
                  type="number"
                  min={1}
                  max={1000}
                  value={breakDurationMs}
                  onChange={(e) => setBreakDurationMs(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                />
              </label>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken || status?.port.path.startsWith("mock:")}
                onClick={() => void onControl({ op: "break", duration_ms: breakDurationMs })}
              >{t("Send BREAK")}</button>
            </div></details>
          </section>

              </div>
              <div role="tabpanel" id="dock-quick" aria-labelledby="dock-tab-quick" hidden={dockTab !== "quick"}>
          <section className="panel quick-panel">
            <div className="log-head">
              <div>
                <h2>{t("Shortcuts")}</h2>
                <p className="hint">{t("Save common ASCII/Hex commands in this browser for one-click sending.")}</p>
              </div>
              {editingCommandId && (
                <button type="button" className="ghost" onClick={resetQuickEditor}>{t("Cancel edit")}</button>
              )}
            </div>
            <div className="quick-editor">
              <label>{t("Name")} <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder={t("e.g. Read version")}
                />
              </label>
              <label>{t("Type")} <select value={quickMode} onChange={(e) => setQuickMode(e.target.value as CommandMode)}>
                  <option value="text">{t("Plain text")}</option>
                  <option value="hex">Hex</option>
                </select>
              </label>
              <label className="quick-payload">{t("Content")} <input
                  value={quickPayload}
                  dir={quickMode === "hex" ? "ltr" : "auto"}
                  maxLength={65536}
                  onChange={(e) => setQuickPayload(e.target.value)}
                  placeholder={quickMode === "text" ? "AT+VERSION?" : "AA 55 01 00"}
                />
              </label>
              {quickMode === "text" && (
                <label>{t("Line ending")} <select
                    value={quickLineEnding}
                    onChange={(e) => setQuickLineEnding(e.target.value as LineEnding)}
                  >
                    <option value="none">{t("No line ending")}</option>
                    <option value="lf">LF</option>
                    <option value="cr">CR</option>
                    <option value="crlf">CRLF</option>
                  </select>
                </label>
              )}
              <button type="button" disabled={busy} onClick={saveQuickCommand}>
                {editingCommandId ? t("Update command") : t("Save command")}
              </button>
            </div>
            <div className="quick-list">
              {quickCommands.length === 0 && <p className="muted">{t("No shortcuts saved yet.")}</p>}
              {quickCommands.map((command) => (
                <div className="quick-item" key={command.id}>
                  <div className="quick-item-main">
                    <strong>{command.name}</strong>
                    <span className="tag">{command.mode === "text" ? t("Plain text") : "Hex"}</span>
                    <code>{command.payload}</code>
                    {command.mode === "text" && <span className="muted">{command.lineEnding}</span>}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="small"
                      disabled={!canWrite || busy}
                      onClick={() => void transmit(command.mode, command.payload, command.lineEnding)}
                    >{t("Send")}</button>
                    <button type="button" className="ghost small" onClick={() => editQuickCommand(command)}>{t("Edit")}</button>
                    <button type="button" className="ghost small" onClick={() => deleteQuickCommand(command)}>{t("Delete")}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

              </div>
              <div role="tabpanel" id="dock-tools" aria-labelledby="dock-tab-tools" hidden={dockTab !== "tools"}>
          <SerialToolsPanel canWrite={canWrite} busy={busy} capture={capture} runJob={runJob}
            commands={quickCommands} profiles={connectionProfiles} encoding={textEncoding}
            onCommandsChange={setQuickCommands} notify={(text, failure) => pushLog({ kind: failure ? "err" : "sys", text })}
            onImport={backup => {
              setQuickCommands(previous => [...previous, ...backup.commands.map(command => ({ ...command, id: newCommandId() }))]);
              setConnectionProfiles(previous => [...previous, ...backup.profiles.map(profile => ({ ...profile, id: newProfileId() }))]);
              pushLog({ kind: "sys", text: t("Appended {p0} commands and {p1} connection profiles", { p0: String(backup.commands.length), p1: String(backup.profiles.length) }) });
            }} />
              </div>
              <div role="tabpanel" id="dock-protocol" aria-labelledby="dock-tab-protocol" hidden={dockTab !== "protocol"}>
          <ProtocolInspectorPanel
            protocol={streamProtocol}
            frames={protocolFrames}
            onClear={() => setProtocolFrames([])}
          />
                {["raw", "firewater", "justfloat", "binary", "image"].includes(streamProtocol) && <p className="hint dock-empty">{t("Select NMEA, SLIP, COBS or Modbus in the terminal parser to inspect frames. Use Signal studio for numbers and images.")}</p>}
              </div>
            </div>
          </aside>
          <section className="panel log-panel">
            <div className="log-head">
              <div className="terminal-title"><span className={`stream-dot ${wsOpen ? "live" : ""}`} /><h2>{t("Live terminal")}</h2><span className="terminal-transport">WS /v1/stream</span></div>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  /> {t("Pause display")}</label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  /> {t("Auto-scroll")}</label>
                <label>{t("Display")} <select value={displayMode} onChange={(e) => setDisplayMode(e.target.value as typeof displayMode)}>
                    <option value="both">{t("Text + Hex")}</option>
                    <option value="text">{t("Text only")}</option>
                    <option value="hex">{t("Hex only")}</option>
                  </select>
                </label>
                <label>{t("RX encoding")} <select aria-label={t("Receive text encoding")} value={receiveEncoding} onChange={event => setReceiveEncoding(event.target.value)}><option value="utf-8">UTF-8</option><option value="gbk">GBK</option><option value="gb18030">GB18030</option><option value="windows-1252">Western ANSI</option></select></label>
                <label>{t("Parser")} <select
                    value={streamProtocol}
                    onChange={(e) => setStreamProtocol(e.target.value as StreamProtocol)}
                  >
                    <option value="raw">RawData</option>
                    <option value="firewater">FireWater CSV</option>
                    <option value="justfloat">JustFloat LE</option>
                    <option value="binary">{t("Custom numeric frames")}</option>
                    <option value="image">{t("Raw image frames")}</option>
                    <option value="nmea0183">NMEA 0183</option>
                    <option value="slip">SLIP / RFC 1055</option>
                    <option value="cobs">COBS</option>
                    <option value="modbusrtu">Modbus RTU</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showTimestamp}
                    onChange={(e) => setShowTimestamp(e.target.checked)}
                  /> {t("Timestamps")}</label>
                <button type="button" className="ghost" onClick={() => {
                  logBuffer.clear();
                  setLogs([]);
                }}>{t("Clear")}</button>
                <button type="button" className="ghost" onClick={exportVisibleLogs}>{t("Export log")}</button>
              </div>
            </div>
            <div className="log-filter"><Icon name="search" size={16} /><input aria-label={t("Search terminal log")} placeholder={t("Search text or Hex…")} value={logSearch} onChange={(event) => setLogSearch(event.target.value)} /><select aria-label={t("Log type")} value={logKind} onChange={(event) => setLogKind(event.target.value)}><option value="all">{t("All types")}</option><option value="rx">{t("RX received data")}</option><option value="tx">{t("TX sent data")}</option><option value="err">{t("Error")}</option><option value="sys">{t("System")}</option></select><span>{visibleLogs.length} {t("records")}</span></div>
            <div className="log" ref={logBoxRef} role="region" aria-label={t("Live terminal records")} tabIndex={0}>
              {visibleLogs.length === 0 && <div className="terminal-empty"><span className="empty-terminal-icon">⌁</span><strong>{logs.length ? t("No matching records") : t("Waiting for device data")}</strong><span>{online ? t("Send a command or wait for device output.") : t("Device output will appear here after connecting to the Hub.")}</span></div>}
              {visibleLogs.map((l) => (
                <div key={l.id} className={`line ${l.kind}`}>
                  <span className="ts">{showTimestamp ? l.ts : ""}</span>
                  <span className="kind">{l.kind.toUpperCase()}</span>
                  {displayMode !== "hex" && <span className="msg" dir={l.kind === "rx" || l.kind === "tx" ? "ltr" : "auto"}>{l.text}</span>}
                  {displayMode !== "text" && l.hex && <span className="hex">{l.hex}</span>}
                </div>
              ))}
            </div>
            <div className="terminal-statusbar"><span>{paused ? t("Display paused; acquisition continues") : wsOpen ? t("Receiving live stream") : t("Waiting for live stream")}</span><span>{t("Up to 2,000 records · long packets truncated · full records in the ledger")}</span></div>
          </section>

          <WaveformPanel connected={canWrite} store={signalStore} protocolLabel={protocolLabel(streamProtocol)} onOpen={() => setTab("signals")} />
        </div>
      )}

      <SignalWorkbench isMock={status?.port.path.startsWith("mock:")} visible={tab === "signals"} store={signalStore} protocol={streamProtocol} onProtocol={setStreamProtocol}
        canWrite={canWrite} busy={busy} commands={quickCommands}
        onQuick={command => transmit(command.mode, command.payload, command.lineEnding)}
        onValue={payload => transmit("hex", fullHex(new TextEncoder().encode(payload + "\n")), "none")} />

      {tab === "events" && (
        <div className="auxiliary-workspace">
          <EventLedgerPanel
          status={ledgerStatus}
          events={ledgerEvents}
          loading={ledgerLoading}
          error={ledgerError}
          online={online}
          onRefresh={() => void refreshLedger(conn, apiBearerToken)}
          onExport={() => void exportLedger()}
          />
          <MetricsPanel
            text={metricsText}
            loading={metricsLoading}
            error={metricsError}
            online={online}
            onRefresh={() => void refreshMetrics(conn, apiBearerToken)}
            onExport={exportMetrics}
          />
        </div>
      )}

      {tab === "endpoints" && (
        <section className="panel auxiliary-workspace">
          <h2>{t("Shared endpoints (one physical port → multiple clients)")}</h2>
          <p className="hint">{t("Serial applications use PTY paths; scripts use TCP; agents and this page use WebSocket.")}</p>
          <table>
            <thead>
              <tr>
                <th>{t("Endpoint type")}</th>
                <th>{t("Endpoint name")}</th>
                <th>{t("Address")}</th>
                <th>{t("Read/write")}</th>
                <th>{t("Description")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {endpoints.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">{t("No data; connect first")}</td>
                </tr>
              )}
              {endpoints.map((ep) => (
                <tr key={`${ep.kind}-${ep.name}-${ep.address}`}>
                  <td>
                    <span className="tag">{ep.kind}</span>
                  </td>
                  <td>{ep.name}</td>
                  <td>
                    <code>{endpointAddress(ep.address)}</code>
                  </td>
                  <td>
                    {ep.can_read ? "R" : "-"}/{ep.can_write ? "W" : "-"}
                  </td>
                  <td className="note">{ep.note}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => void copy(endpointAddress(ep.address))}
                    >{t("Copy")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{t("Current fan-out clients")}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("Endpoint name")}</th>
                <th>{t("Endpoint type")}</th>
                <th>{t("Read/write")}</th>
                <th>id</th>
              </tr>
            </thead>
            <tbody>
              {(status?.clients ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>
                    {c.can_read ? "R" : "-"}/{c.can_write ? "W" : "-"}
                  </td>
                  <td>
                    <code className="small">{c.id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "protocol" && (
        <section className="panel protocol auxiliary-workspace">
          <h2>{t("Protocol essentials")}</h2>
          <p>{t("Full documentation in the repository:")} <code>web/PROTOCOL.zh-TW.md</code>
          </p>
          <h3>HTTP</h3>
          <ul>
            <li>
              <code>GET /v1/health</code> {t("— health check")}</li>
            <li>
              <code>GET /v1/status</code> {t("— port, lease, counters and clients")}</li>
            <li>
              <code>GET /v1/endpoints</code> {t("— shared endpoint list")}</li>
            <li>
              <code>POST /v1/write</code> —{" "}
              <code>{`{"text":"...","newline":true,"as_client":"web-ui"}`}</code> {t("or")} {" "}
              <code>hex</code>
            </li>
            <li>
              <code>POST /v1/lock</code> · <code>DELETE /v1/lock</code>
            </li>
          </ul>
          <h3>WebSocket <code>/v1/stream</code></h3>
          <ul>
            <li>
              <strong>{t("Downstream binary")}</strong> {t(": raw device RX bytes (first packet may include history)")}</li>
            <li>
              <strong>{t("Upstream text")}</strong> {t(": sent as TX; without")} <code>\n</code> {t("the Hub appends a line ending")}</li>
            <li>
              <strong>{t("Upstream binary")}</strong> {t(": forwarded unchanged through the TX policy")}</li>
            <li>{t("For acknowledged writes, use HTTP")} <code>/v1/write</code> {t("(returns ok/error)")}</li>
          </ul>
          <h3>{t("Usage notes")}</h3>
          <ul>
            <li>{t("One physical port supports multiple PTY/TCP/WS clients; RX is broadcast to all readers")}</li>
            <li>{t("TX defaults to line queues to prevent interleaved bytes")}</li>
            <li>{t("An HTTPS page may be blocked from using local ws:// connections")}</li>
          </ul>
        </section>
      )}

      </main><footer className="footer">
        <TrafficCounters counters={trafficRef} /><span className="footer-caption">{t("SerialHub · Local device sharing workspace")}</span>
      </footer>
    </div>
  );
}
