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
import Icon from "./Icon";
import { LogBuffer } from "./logBuffer";
import { useHubConnection, type HubSession } from "./useHubConnection";
import {
  appendHexChecksum,
  checksumLabel,
  type HexChecksum,
} from "./checksumUtils";
import {
  parseFireWater,
  parseJustFloat,
  parseCobs,
  parseModbusRtu,
  parseNmea0183,
  parseSlip,
  protocolLabel,
  type ProtocolFrame,
  type StreamProtocol,
  type WaveSample,
} from "./protocolUtils";
import "./App.css";

type Tab = "monitor" | "events" | "endpoints" | "protocol";

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
  return new Date().toLocaleTimeString("zh-TW", { hour12: false });
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

export default function App() {
  const [tab, setTab] = useState<Tab>("monitor");
  const [conn, setConn] = useState<ConnectionConfig>(loadConn);
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

  const [sendText, setSendText] = useState("");
  const [sendMode, setSendMode] = useState<CommandMode>("text");
  const [sendHex, setSendHex] = useState("");
  const [hexChecksum, setHexChecksum] = useState<HexChecksum>("none");
  const [lineEnding, setLineEnding] = useState<LineEnding>("lf");
  const [autoSend, setAutoSend] = useState(false);
  const [autoIntervalMs, setAutoIntervalMs] = useState(1000);
  const [autoMode, setAutoMode] = useState<CommandMode>("text");
  const [displayMode, setDisplayMode] = useState<"text" | "hex" | "both">("both");
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [streamProtocol, setStreamProtocol] = useState<StreamProtocol>("raw");
  const [waveSamples, setWaveSamples] = useState<WaveSample[]>([]);
  const [protocolFrames, setProtocolFrames] = useState<ProtocolFrame[]>([]);
  const [waveChannel, setWaveChannel] = useState(0);
  const streamProtocolRef = useRef<StreamProtocol>(streamProtocol);
  const fireWaterBufferRef = useRef("");
  const fireWaterDecoderRef = useRef(new TextDecoder());
  const justFloatBufferRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
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
    fireWaterBufferRef.current = "";
    fireWaterDecoderRef.current = new TextDecoder();
    justFloatBufferRef.current = new Uint8Array();
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
      text: line.text,
      hex: line.hex,
    });
  }, [logBuffer]);

  useEffect(() => () => logBuffer.clear(), [logBuffer]);

  const saveConnectionProfile = () => {
    const name = profileName.trim();
    const host = hostInput.trim();
    const port = Number(portInput);
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      pushLog({ kind: "err", text: "会话配置需要名称、主机和有效端口" });
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
    pushLog({ kind: "sys", text: `已保存会话配置：${profile.name}` });
  };

  const loadConnectionProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = connectionProfiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    setHostInput(profile.host);
    setPortInput(String(profile.port));
    setProtocolInput(profile.protocol ?? "http");
    pushLog({ kind: "sys", text: `已载入会话配置：${profile.name}` });
  };

  const deleteConnectionProfile = () => {
    if (!selectedProfileId) return;
    const profile = connectionProfiles.find((item) => item.id === selectedProfileId);
    setConnectionProfiles((previous) => previous.filter((item) => item.id !== selectedProfileId));
    setSelectedProfileId("");
    setProfileName("");
    if (profile) pushLog({ kind: "sys", text: `已删除会话配置：${profile.name}` });
  };

  const consumeWaveBytes = useCallback(
    (data: Uint8Array) => {
      const currentProtocol = streamProtocolRef.current;
      if (currentProtocol === "raw") return;
      if (currentProtocol === "firewater") {
        const parsed = parseFireWater(
          `${fireWaterBufferRef.current}${fireWaterDecoderRef.current.decode(data, { stream: true })}`,
        );
        fireWaterBufferRef.current = parsed.remainder;
        if (parsed.samples.length === 0) return;
        setWaveSamples((previous) => [...previous, ...parsed.samples].slice(-800));
        return;
      }
      const parsed = parseJustFloat(justFloatBufferRef.current, data);
      justFloatBufferRef.current = parsed.remainder;
      if (parsed.samples.length === 0) return;
      setWaveSamples((previous) => [...previous, ...parsed.samples].slice(-800));
    },
    [],
  );

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
    resetStreamParsers();
    setWaveSamples([]);
    setProtocolFrames([]);
    setWaveChannel(0);
  }, [streamProtocol, resetStreamParsers]);

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
        throw new Error("事件序號超出瀏覽器可安全表示的範圍");
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
        throw new Error("事件帳本 session 已切換，請刷新状态");
      }
      if (!isCurrent(session) || controller.signal.aborted) return;
      setLedgerStatus(nextStatus);
      setLedgerEvents(response.page.events);
    } catch (ledgerFailure) {
      if (isCurrent(session) && !controller.signal.aborted && !(ledgerFailure instanceof DOMException && ledgerFailure.name === "AbortError")) {
        setLedgerError(
          `事件帳本讀取失敗：${
            ledgerFailure instanceof Error ? ledgerFailure.message : String(ledgerFailure)
          }`,
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

  const disconnect = useCallback(() => {
    if (operationRef.current) pushLog({ kind: "err", text: "会话已结束，进行中的操作可能已被设备执行。请核对事件记录后再决定是否重试。" });
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
  }, [stopConnection, pushLog]);

  const connect = useCallback(async () => {
    disconnect();
    const cfg: ConnectionConfig = {
      host: hostInput.trim(), port: Number(portInput), protocol: protocolInput,
    };
    let textDecoder = new TextDecoder();
    const connected = await startConnection(cfg, inputBearerToken, {
      onOpen: () => {
        textDecoder = new TextDecoder();
        resetStreamParsers();
        setWaveSamples([]);
        setProtocolFrames([]);
        pushLog({ kind: "sys", text: `实时流已连接 ${wsUrl(cfg)}` });
      },
      onClose: () => pushLog({ kind: "err", text: "实时流已中断，正在重连；自动发送已停止。重连首包可能包含历史数据。" }),
      onServerError: (message) => pushLog({ kind: "err", text: `Hub：${message}` }),
      onBytes: (data, meta) => {
        if (pausedRef.current) {
          textDecoder = new TextDecoder();
          resetStreamParsers();
          return;
        }
        consumeWaveBytes(data);
        consumeProtocolBytes(data);
        pushLog({ kind: "rx", text: `${meta.isHistoryHint ? "[可能含历史] " : ""}${bytesToText(data, textDecoder).replace(/\n/g, "\\n")}`, hex: bytesToHex(data) });
      },
    });
    if (!connected) return;
    setConn(cfg);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* Memory-only still works. */ }
    void refreshLedger(cfg, inputBearerToken);
    void refreshMetrics(cfg, inputBearerToken);
  }, [disconnect, hostInput, portInput, protocolInput, inputBearerToken, startConnection,
    consumeWaveBytes, consumeProtocolBytes, pushLog, refreshLedger, refreshMetrics, resetStreamParsers]);

  useEffect(() => {
    if (!canWrite) setAutoSend(false);
    if (!online || phase === "reconnecting" || !status?.port.connected) {
      setLeaseToken(null);
      setLeaseExpiresAt(0);
    }
  }, [canWrite, online, phase, status?.port.connected]);

  useEffect(() => {
    setLeaseToken(null);
    setLeaseExpiresAt(0);
  }, [status?.port.epoch]);

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
    },
    [],
  );

  const transmit = useCallback(async (
    mode: CommandMode, payload: string, ending: LineEnding, checksum: HexChecksum = "none",
  ): Promise<boolean> => {
    if (!payload.length || (mode === "hex" && !payload.trim())) return false;
    const session = beginOperation();
    if (!session) return false;
    try {
      const wire = mode === "text" ? appendLineEnding(payload, ending) : appendHexChecksum(payload, checksum);
      const options = { as_client: CLIENT_NAME, lease_token: leaseToken ?? undefined,
        bearer_token: session.bearerToken, signal: session.signal, newline: false };
      const response = mode === "text"
        ? await hubApi.writeText(session.cfg, wire, options)
        : await hubApi.writeHex(session.cfg, wire, options);
      if (!isCurrent(session)) return false;
      if (!response.ok) throw new Error(response.error || "写入失败");
      pushLog({ kind: "tx", text: `主机已确认 ${response.bytes} bytes · ${wire.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}${checksum !== "none" ? ` · ${checksumLabel(checksum)}` : ""}` });
      return true;
    } catch (failure) {
      if (isCurrent(session)) {
        setAutoSend(false);
        pushLog({ kind: "err", text: `写入未确认：${failure instanceof Error ? failure.message : String(failure)}` });
      }
      return false;
    } finally { endOperation(session); }
  }, [beginOperation, endOperation, isCurrent, leaseToken, pushLog]);

  const onSendText = () => void transmit("text", sendText, lineEnding);

  const onSendHex = () => void transmit("hex", sendHex, "none", hexChecksum);

  const hexPreview = useMemo(() => {
    if (!sendHex.trim()) return "";
    try {
      return appendHexChecksum(sendHex, hexChecksum);
    } catch (e) {
      return e instanceof Error ? `错误：${e.message}` : `错误：${String(e)}`;
    }
  }, [hexChecksum, sendHex]);

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
      pushLog({ kind: "err", text: "快捷指令需要名称和内容" });
      return;
    }
    const next: QuickCommand = {
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
    pushLog({ kind: "sys", text: `${editingCommandId ? "已更新" : "已保存"}快捷指令：${name}` });
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
    pushLog({ kind: "sys", text: `已删除快捷指令：${command.name}` });
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
    pushLog({ kind: "sys", text: `已导出 ${visibleLogs.length} 条页面日志` });
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
      pushLog({ kind: "sys", text: `事件证据已导出 ${ndjson.split("\n").filter(Boolean).length} 条` });
    } catch (exportFailure) {
      pushLog({ kind: "err", text: `事件导出失败：${exportFailure instanceof Error ? exportFailure.message : String(exportFailure)}` });
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
      if (!response.ok || !response.lock) throw new Error(response.error || "服务器未返回写入租约");
      setLeaseToken(response.lock.lease_token);
      setLeaseExpiresAt(Date.now() + response.lock.expires_ms);
      pushLog({ kind: "sys", text: `已取得写入租约 · ${response.lock.expires_ms} ms` });
      await refreshMeta();
    } catch (failure) {
      if (isCurrent(session)) {
        setLeaseToken(null);
        pushLog({ kind: "err", text: `租约获取失败：${failure instanceof Error ? failure.message : String(failure)}` });
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
      if (!response.ok) throw new Error(response.error || "释放租约失败");
      setLeaseToken(null);
      pushLog({ kind: "sys", text: "写入租约已释放" });
      await refreshMeta();
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: `释放失败：${failure instanceof Error ? failure.message : String(failure)}` });
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
      if (!response.ok) throw new Error(response.error || "控制操作失败");
      pushLog({ kind: "sys", text: body.op === "break"
        ? `BREAK ${body.duration_ms} ms 已确认` : `${body.op.toUpperCase()} ${body.level ? "ON" : "OFF"} 已确认` });
    } catch (failure) {
      if (isCurrent(session)) pushLog({ kind: "err", text: `控制失败：${failure instanceof Error ? failure.message : String(failure)}` });
    } finally { endOperation(session); }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushLog({ kind: "sys", text: `已複製：${text}` });
    } catch {
      pushLog({ kind: "err", text: "複製失敗" });
    }
  };

  const statusLamp = useMemo(() => {
    if (phase === "connecting") return { cls: "warn", label: "正在连接…" };
    if (phase === "reconnecting") return { cls: "warn", label: `实时流重连中 · ${retryCount}/5` };
    if (phase === "error") return { cls: "off", label: "连接异常" };
    if (online && wsOpen) return { cls: "ok", label: "已连接 · HTTP + WS" };
    if (online) return { cls: "warn", label: "HTTP 通，WS 未连接" };
    return { cls: "off", label: "未连接" };
  }, [online, wsOpen, phase, retryCount]);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">跳到工作区</a>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="layers" size={25} /></span><div>SerialHub<small>DEVICE WORKSPACE</small></div></div>
        <div className="nav-label">工作空间</div>
        <nav className="sidebar-nav" aria-label="主导航">
          {([
            ["monitor", "terminal", "实时工作台", "01"],
            ["events", "activity", "事件与指标", "02"],
            ["endpoints", "layers", "连接与端点", "03"],
            ["protocol", "book", "使用指南", "04"],
          ] as const).map(([id, icon, label, number]) => <button type="button" key={id}
            className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}><Icon name={icon} /><span>{label}</span><small>{number}</small></button>)}
        </nav>
        <div className="sidebar-note"><Icon name="shield" /><strong>一个串口，协作有序</strong><p>统一管理设备访问，<br />让每一次操作有据可查。</p><span>OPEN SOURCE · MIT</span></div>
        <div className="sidebar-footer"><span className="version-dot" />SerialHub <code>v0.0.2</code></div>
      </aside>
      <header className="header">
        <div><div className="eyebrow">WORKSPACE <span>/</span> {tab === "monitor" ? "LIVE CONSOLE" : tab === "events" ? "EVENT EVIDENCE" : tab === "endpoints" ? "CONNECTIONS" : "GUIDE"}</div>
          <h1>{tab === "monitor" ? "串口工作台" : tab === "events" ? "事件与运行指标" : tab === "endpoints" ? "连接与端点" : "使用指南"}<span className="heading-dot" aria-hidden="true">.</span></h1>
          <p className="sub">连接设备，观察数据，让调试井然有序。</p>
        </div>
        <div className="header-status"><span className="local-badge"><Icon name="shield" size={14} /> 单一设备所有者</span><div className={`lamp ${statusLamp.cls}`} role="status">{statusLamp.label}</div></div>
      </header>
      <main id="main-content">
      <section className="panel connect">
        <div className="connection-heading"><h2><Icon name="layers" size={16} /> 连接配置</h2><span>{online ? (status?.port.path.startsWith("mock:") ? "模拟设备 · 无需硬件" : "设备会话") : "支持本机 Hub 或 HTTPS 反向代理"}</span></div>
        <div className="row">
          <label>
            主机地址
            <input
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
          <label>
            端口
            <input
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              placeholder="8787"
              className="port"
            />
          </label>
          <label>协议<select aria-label="连接协议" value={protocolInput} onChange={(event) => setProtocolInput(event.target.value as "http" | "https")}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label>
            访问令牌（可选）
            <input
              type="password"
              autoComplete="off"
              value={apiTokenInput}
              onChange={(e) => setApiTokenInput(e.target.value)}
              placeholder="仅在本次会话使用"
            />
          </label>
          <button type="button" disabled={phase === "connecting"} onClick={() => void connect()}>
            {phase === "connecting" ? "连接中…" : online ? "重新连接" : "连接 Hub"}
          </button>
          <button type="button" className="ghost" disabled={phase === "idle"} onClick={disconnect}>
            断开
          </button>
        </div>
        <details className="profile-settings"><summary>已保存的连接配置 <span>在本机浏览器保存，不包含令牌</span></summary><div className="row profile-row">
          <label>
            会话配置
            <select value={selectedProfileId} onChange={(e) => loadConnectionProfile(e.target.value)}>
              <option value="">选择已保存配置</option>
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.host}:{profile.port}
                </option>
              ))}
            </select>
          </label>
          <label>
            配置名称
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="例如 本机 Hub"
            />
          </label>
          <button type="button" className="ghost" onClick={saveConnectionProfile}>
            保存配置
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!selectedProfileId}
            onClick={deleteConnectionProfile}
          >
            删除配置
          </button>
        </div>
        </details>
        {!online && !error && <p className="connection-help">首次使用？在设备所在主机运行 <code>serialhub share mock:demo</code> 即可体验模拟回环。</p>}
        {error && <p className="error connection-error" role="alert">{error}<span>检查地址、令牌与 Hub 运行状态后重新连接。写入请求不会自动重试。</span></p>}
      </section>
      <section className="overview" aria-label="设备概览">
        <div className="overview-device"><span className={`device-indicator ${canWrite ? "ready" : ""}`}><Icon name="terminal" size={23} /></span><div><small>当前设备</small><strong>{online ? status?.port.path : "等待连接"}</strong><span>{online ? `${status?.port.baud.toLocaleString()} baud · ${status?.port.connected ? "设备已打开" : "设备离线"}` : "选择一个 Hub 开始调试"}</span></div>{online && status?.port.path.startsWith("mock:") && <b className="simulation-label">MOCK</b>}</div>
        <div><small>接收 RX</small><strong>{online ? status?.stats.rx_bytes.toLocaleString() : "—"}<span>bytes</span></strong></div>
        <div><small>发送 TX</small><strong>{online ? status?.stats.tx_bytes.toLocaleString() : "—"}<span>bytes</span></strong></div>
        <div><small>在线客户端</small><strong>{online ? status?.clients.length : "—"}<span>clients</span></strong></div>
        <div className={status?.stats.rx_drops ? "has-drops" : ""}><small>分发丢弃</small><strong>{online ? status?.stats.rx_drops.toLocaleString() : "—"}<span>chunks</span></strong></div>
      </section>
      <div className="workspace-heading"><div><span className="section-index">{tab === "monitor" ? "01" : tab === "events" ? "02" : tab === "endpoints" ? "03" : "04"}</span><h2>{tab === "monitor" ? "实时监控" : tab === "events" ? "事件证据" : tab === "endpoints" ? "共享端点" : "协议与操作"}</h2></div><span>{online ? httpBase(conn) : "尚未建立会话"}</span></div>
      {tab === "monitor" && (
        <div className="grid">
          <section className="panel device-panel">
            <h2><Icon name="shield" size={17} /> 设备与写入权限</h2>
            {status ? (
              <dl className="kv">
                <dt>设备路径</dt>
                <dd>
                  {status.port.path}{" "}
                  <span className={status.port.connected ? "tag ok" : "tag off"}>
                    {status.port.connected ? "已打开" : "未连接"}
                  </span>
                </dd>
                <dt>波特率</dt>
                <dd>{status.port.baud}</dd>
                <dt>连接详情</dt>
                <dd>{status.port.detail}</dd>
                <dt>TX 模式</dt>
                <dd>
                  <code>{status.tx_mode}</code>
                </dd>
                <dt>写入租约</dt>
                <dd>
                  {status.lock_owner
                    ? `${status.lock_owner}（剩余 ${status.lock_expires_ms ?? "?"} ms）`
                    : "未持有"}
                </dd>
                <dt>统计</dt>
                <dd>
                  RX {status.stats.rx_bytes} · TX {status.stats.tx_bytes} · drop{" "}
                  {status.stats.rx_drops} · deny {status.stats.tx_denies}
                </dd>
                <dt>客户端数</dt>
                <dd>{status.clients.length}</dd>
              </dl>
            ) : (
              <p className="muted">尚未连接</p>
            )}
            <div className="row">
              <button type="button" disabled={!canWrite || busy} onClick={() => void onLock()}>
                获取写入租约
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy || !leaseToken}
                onClick={() => void onUnlock()}
              >
                释放租约
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!canWrite || busy}
                onClick={() => void refreshMeta().catch((failure) => pushLog({ kind: "err", text: `状态读取失败：${failure instanceof Error ? failure.message : String(failure)}` }))}
              >
                刷新状态
              </button>
            </div>
            {leaseToken && <p className="lease-countdown" role="status">本页写入租约有效 · 剩余 {(leaseRemaining / 1000).toFixed(1)} 秒</p>}<details className="hardware-controls"><summary>硬件控制线 <span>{status?.port.path.startsWith("mock:") ? "模拟设备不支持" : "需要服务端授权与有效租约"}</span></summary><div className="row control-row">
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
              >
                發送 BREAK
              </button>
            </div></details>
          </section>

          <section className="panel composer-panel">
            <div className="composer-heading"><h2>发送命令</h2><span>主机确认写入</span></div><div className="segmented" role="group" aria-label="发送格式"><button type="button" className={sendMode === "text" ? "active" : ""} aria-pressed={sendMode === "text"} onClick={() => setSendMode("text")}>Text 文本</button><button type="button" className={sendMode === "hex" ? "active" : ""} aria-pressed={sendMode === "hex"} onClick={() => setSendMode("hex")}>HEX 字节</button></div><div hidden={sendMode !== "text"}>
            <label className="block">
              文字
              <textarea
                rows={3}
                value={sendText}
                onChange={(e) => setSendText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    onSendText();
                  }
                }}
                placeholder="例如 AT 或任意指令"
              />
            </label>
            <div className="row composer-options">
              <label>
                行尾
                <select
                  value={lineEnding}
                  onChange={(e) => setLineEnding(e.target.value as LineEnding)}
                >
                  <option value="none">无结尾</option>
                  <option value="lf">LF (\\n)</option>
                  <option value="cr">CR (\\r)</option>
                  <option value="crlf">CRLF (\\r\\n)</option>
                </select>
              </label>
              <span className="hint inline-hint">Ctrl/⌘ + Enter 发送</span>
            </div>
            <button type="button" className="send-button" disabled={!canWrite || busy || !sendText.length} onClick={() => void onSendText()}>
              发送文本
            </button>
            </div><div hidden={sendMode !== "hex"}><label className="block">
              十六进制
              <input
                value={sendHex}
                onChange={(e) => setSendHex(e.target.value)}
                placeholder="41 54 0d 0a"
              />
            </label>
            <div className="row composer-options">
              <label>
                校验和
                <select
                  value={hexChecksum}
                  onChange={(e) => setHexChecksum(e.target.value as HexChecksum)}
                >
                  <option value="none">不添加校验</option>
                  <option value="sum8">SUM8</option>
                  <option value="xor8">XOR8</option>
                  <option value="crc16-modbus">CRC16-Modbus (Lo/Hi)</option>
                  <option value="crc16-ccitt">CRC16-CCITT (Hi/Lo)</option>
                </select>
              </label>
              {hexPreview && (
                <span className={`hint inline-hint ${hexPreview.startsWith("错误") ? "error" : ""}`}>
                  发送预览：<code>{hexPreview}</code>
                </span>
              )}
            </div>
            <button type="button" className="send-button" disabled={!canWrite || busy || !sendHex.trim() || hexPreview.startsWith("错误")} onClick={() => void onSendHex()}>
              发送 Hex
            </button>
            </div><details className="auto-send-settings"><summary>定时发送 <span>断流或写入失败时自动停止</span></summary><div className="row auto-send-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                  disabled={!canWrite || busy}
                />
                定时发送当前内容
              </label>
              <label>
                模式
                <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as CommandMode)}>
                  <option value="text">文本</option>
                  <option value="hex">Hex</option>
                </select>
              </label>
              <label>
                间隔 (ms)
                <input
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
            </details><p className="composer-note"><Icon name="shield" size={14} /> 经过统一写入仲裁；主机确认不等于设备应答。</p>
          </section>

          <section className="panel quick-panel">
            <div className="log-head">
              <div>
                <h2>快捷指令</h2>
                <p className="hint">把常用 ASCII/Hex 命令保存到本浏览器，一键发送。</p>
              </div>
              {editingCommandId && (
                <button type="button" className="ghost" onClick={resetQuickEditor}>
                  取消编辑
                </button>
              )}
            </div>
            <div className="quick-editor">
              <label>
                名称
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="例如 读取版本"
                />
              </label>
              <label>
                类型
                <select value={quickMode} onChange={(e) => setQuickMode(e.target.value as CommandMode)}>
                  <option value="text">文本</option>
                  <option value="hex">Hex</option>
                </select>
              </label>
              <label className="quick-payload">
                内容
                <input
                  value={quickPayload}
                  onChange={(e) => setQuickPayload(e.target.value)}
                  placeholder={quickMode === "text" ? "AT+VERSION?" : "AA 55 01 00"}
                />
              </label>
              {quickMode === "text" && (
                <label>
                  行尾
                  <select
                    value={quickLineEnding}
                    onChange={(e) => setQuickLineEnding(e.target.value as LineEnding)}
                  >
                    <option value="none">无结尾</option>
                    <option value="lf">LF</option>
                    <option value="cr">CR</option>
                    <option value="crlf">CRLF</option>
                  </select>
                </label>
              )}
              <button type="button" disabled={busy} onClick={saveQuickCommand}>
                {editingCommandId ? "更新指令" : "保存指令"}
              </button>
            </div>
            <div className="quick-list">
              {quickCommands.length === 0 && <p className="muted">还没有快捷指令。</p>}
              {quickCommands.map((command) => (
                <div className="quick-item" key={command.id}>
                  <div className="quick-item-main">
                    <strong>{command.name}</strong>
                    <span className="tag">{command.mode === "text" ? "文本" : "Hex"}</span>
                    <code>{command.payload}</code>
                    {command.mode === "text" && <span className="muted">{command.lineEnding}</span>}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="small"
                      disabled={!canWrite || busy}
                      onClick={() => void transmit(command.mode, command.payload, command.lineEnding)}
                    >
                      发送
                    </button>
                    <button type="button" className="ghost small" onClick={() => editQuickCommand(command)}>
                      编辑
                    </button>
                    <button type="button" className="ghost small" onClick={() => deleteQuickCommand(command)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel log-panel">
            <div className="log-head">
              <div className="terminal-title"><span className={`stream-dot ${wsOpen ? "live" : ""}`} /><h2>实时终端</h2><span className="terminal-transport">WS /v1/stream</span></div>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  />
                  暂停显示
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  自动滚动
                </label>
                <label>
                  显示
                  <select value={displayMode} onChange={(e) => setDisplayMode(e.target.value as typeof displayMode)}>
                    <option value="both">文本 + Hex</option>
                    <option value="text">仅文本</option>
                    <option value="hex">仅 Hex</option>
                  </select>
                </label>
                <label>
                  解析
                  <select
                    value={streamProtocol}
                    onChange={(e) => setStreamProtocol(e.target.value as StreamProtocol)}
                  >
                    <option value="raw">RawData</option>
                    <option value="firewater">FireWater CSV</option>
                    <option value="justfloat">JustFloat LE</option>
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
                  />
                  时间戳
                </label>
                <button type="button" className="ghost" onClick={() => {
                  logBuffer.clear();
                  setLogs([]);
                }}>
                  清空
                </button>
                <button type="button" className="ghost" onClick={exportVisibleLogs}>
                  导出日志
                </button>
              </div>
            </div>
            <div className="log-filter"><Icon name="search" size={16} /><input aria-label="搜索终端日志" placeholder="搜索文本或 Hex…" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} /><select aria-label="日志类型" value={logKind} onChange={(event) => setLogKind(event.target.value)}><option value="all">全部类型</option><option value="rx">RX 接收</option><option value="tx">TX 发送</option><option value="err">错误</option><option value="sys">系统</option></select><span>{visibleLogs.length} 条记录</span></div>
            <div className="log" ref={logBoxRef} role="region" aria-label="实时终端记录" tabIndex={0}>
              {visibleLogs.length === 0 && <div className="terminal-empty"><span className="empty-terminal-icon">⌁</span><strong>{logs.length ? "没有匹配的记录" : "等待设备数据"}</strong><span>{online ? "发送命令，或等待设备输出。" : "连接 Hub 后，设备输出会显示在这里。"}</span></div>}
              {visibleLogs.map((l) => (
                <div key={l.id} className={`line ${l.kind}`}>
                  <span className="ts">{showTimestamp ? l.ts : ""}</span>
                  <span className="kind">{l.kind.toUpperCase()}</span>
                  {displayMode !== "hex" && <span className="msg">{l.text}</span>}
                  {displayMode !== "text" && l.hex && <span className="hex">{l.hex}</span>}
                </div>
              ))}
            </div>
            <div className="terminal-statusbar"><span>{paused ? "显示已暂停，后端采集继续" : wsOpen ? "实时流接收中" : "等待实时流"}</span><span>显示窗口最多 2,000 条 · 完整记录见事件账本</span></div>
          </section>

          <WaveformPanel
            samples={waveSamples}
            channel={waveChannel}
            onChannelChange={setWaveChannel}
            onClear={() => setWaveSamples([])}
            protocolLabel={protocolLabel(streamProtocol)}
          />
          <ProtocolInspectorPanel
            protocol={streamProtocol}
            frames={protocolFrames}
            onClear={() => setProtocolFrames([])}
          />
        </div>
      )}

      {tab === "events" && (
        <>
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
        </>
      )}

      {tab === "endpoints" && (
        <section className="panel">
          <h2>並聯端點（一個真串口 → 多路出口）</h2>
          <p className="hint">
            上位機開 SERIAL（PTY）路徑；腳本連 TCP；Agent / 本頁用 WebSocket。
          </p>
          <table>
            <thead>
              <tr>
                <th>類型</th>
                <th>名稱</th>
                <th>位址</th>
                <th>讀/寫</th>
                <th>說明</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {endpoints.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无数据，请先连接
                  </td>
                </tr>
              )}
              {endpoints.map((ep) => (
                <tr key={`${ep.kind}-${ep.name}-${ep.address}`}>
                  <td>
                    <span className="tag">{ep.kind}</span>
                  </td>
                  <td>{ep.name}</td>
                  <td>
                    <code>{ep.address}</code>
                  </td>
                  <td>
                    {ep.can_read ? "R" : "-"}/{ep.can_write ? "W" : "-"}
                  </td>
                  <td className="note">{ep.note}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => void copy(ep.address)}
                    >
                      複製
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>目前 fan-out 客戶端</h3>
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>類型</th>
                <th>讀/寫</th>
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
        <section className="panel protocol">
          <h2>協定精要（繁中）</h2>
          <p>
            完整文件：倉庫內 <code>web/PROTOCOL.zh-TW.md</code>
          </p>
          <h3>HTTP</h3>
          <ul>
            <li>
              <code>GET /v1/health</code> — 探活
            </li>
            <li>
              <code>GET /v1/status</code> — 埠、鎖、统计、客戶端
            </li>
            <li>
              <code>GET /v1/endpoints</code> — 並聯端點清單
            </li>
            <li>
              <code>POST /v1/write</code> —{" "}
              <code>{`{"text":"...","newline":true,"as_client":"web-ui"}`}</code> 或{" "}
              <code>hex</code>
            </li>
            <li>
              <code>POST /v1/lock</code> · <code>DELETE /v1/lock</code>
            </li>
          </ul>
          <h3>WebSocket <code>/v1/stream</code></h3>
          <ul>
            <li>
              <strong>下行 Binary</strong>：裝置 RX 原始位元組（可能含歷史首包）
            </li>
            <li>
              <strong>上行 Text</strong>：當 TX，無 <code>\n</code> 時 hub 自動補行
            </li>
            <li>
              <strong>上行 Binary</strong>：原樣進入 TX 策略
            </li>
            <li>可靠寫入請優先 HTTP <code>/v1/write</code>（有 ok/error）</li>
          </ul>
          <h3>使用提醒</h3>
          <ul>
            <li>一個真串口可並聯多 PTY / 多 TCP / 多 WS，RX 全廣播</li>
            <li>TX 預設按行排隊，避免位元組交錯</li>
            <li>HTTPS 網頁連本機 ws:// 可能被瀏覽器封鎖</li>
          </ul>
        </section>
      )}

      </main><footer className="footer">
        SerialHub · 为人和自动化共享设备而设计。
      </footer>
    </div>
  );
}
