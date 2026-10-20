import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "./Icon";
import { hubApi } from "./api/client";
import type { HubSession } from "./useHubConnection";
import { useHubConnection } from "./useHubConnection";
import { desktopConnection, type DeviceSession } from "./desktopSession";
import {
  commandBytes,
  downloadBlob,
  fullHex,
  type TextEncoding,
} from "./serialTools";
import {
  lineEndingLabel,
  type CommandMode,
  type LineEnding,
} from "./commandUtils";
import {
  MultiSerialLog,
  PANEL_LOG_LIMIT,
  type PanelDisplay,
  type PanelEntry,
} from "./multiSerialLog";
import { t } from "./i18n/index";
import { useLocale } from "./i18n/useLocale";
import "./multiPort.css";

function storedLayout(): number {
  try {
    const value = Number(localStorage.getItem("serialhub.multi.layout"));
    return [2, 4, 6].includes(value) ? value : 4;
  } catch {
    return 4;
  }
}

export default function MultiPortWorkspace({
  sessions,
  active,
  onOpen,
  onManage,
  onClose,
}: {
  sessions: DeviceSession[];
  active: boolean;
  onOpen: (id: string) => void;
  onManage: () => void;
  onClose: (id: string) => Promise<void>;
}) {
  useLocale();
  const [layout, setLayout] = useState(storedLayout);
  const [shortWindow, setShortWindow] = useState(
    () => innerWidth > 760 && innerHeight < 700,
  );
  useEffect(() => {
    const resize = () => setShortWindow(innerWidth > 760 && innerHeight < 700);
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const capacity = shortWindow ? 2 : layout;
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [clear, setClear] = useState(0);
  // Keep device order stable when the manager's UUID-sorted inventory changes.
  const order = useRef<string[]>([]);
  order.current = order.current.filter((id) =>
    sessions.some((s) => s.id === id),
  );
  for (const session of [...sessions].sort((a, b) =>
    a.path.localeCompare(b.path, "en", { numeric: true }),
  ))
    if (!order.current.includes(session.id)) order.current.push(session.id);
  const ordered = order.current.flatMap(
    (id) => sessions.find((s) => s.id === id) ?? [],
  );
  const focused = focus && sessions.some((s) => s.id === focus) ? focus : null;
  const pages = Math.max(1, Math.ceil(sessions.length / capacity));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage((value) => Math.min(value, pages - 1)), [pages]);
  const visibleIds = new Set(
    focused
      ? [focused]
      : ordered
          .slice(currentPage * capacity, (currentPage + 1) * capacity)
          .map((s) => s.id),
  );
  return (
    <section
      className="multi-workspace"
      hidden={!active}
      aria-label={t("Multi-port workspace")}
    >
      <div className="multi-toolbar">
        <div className="multi-heading">
          <Icon name="layers" size={20} />
          <div>
            <h1>{t("Multi-port workspace")}</h1>
            <small>{t("Hidden panels keep receiving.")}</small>
          </div>
          <span className="multi-device-count">
            {sessions.filter((s) => s.connected).length}/{sessions.length}
          </span>
        </div>
        <div className="multi-controls">
          <label>
            {t("Panels per page")}
            <select
              value={capacity}
              onChange={(e) => {
                const next = Number(e.target.value);
                setLayout(next);
                setPage(0);
                setFocus(null);
                try {
                  localStorage.setItem("serialhub.multi.layout", String(next));
                } catch {
                  /* Memory-only layout. */
                }
              }}
            >
              {[2, 4, 6].map((n) => (
                <option key={n} value={n} disabled={shortWindow && n > 2}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className={paused ? "active" : "ghost"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? t("Resume all displays") : t("Pause all displays")}
          </button>
          <button
            className="ghost"
            onClick={() => setClear((value) => value + 1)}
          >
            {t("Clear all displays")}
          </button>
          <button onClick={onManage}>
            {t("Manage devices")} <span aria-hidden="true">＋</span>
          </button>
        </div>
      </div>
      {!sessions.length ? (
        <div className="multi-empty">
          <Icon name="terminal" size={38} />
          <h2>{t("No devices open")}</h2>
          <p>{t("Open devices to build your workspace.")}</p>
          <button onClick={onManage}>{t("Open a device")}</button>
        </div>
      ) : (
        <div
          className={`multi-grid multi-grid-${focused || visibleIds.size === 1 ? 1 : visibleIds.size <= 2 ? 2 : capacity}`}
        >
          {ordered.map((session, index) => (
            <PortPanel
              key={session.id}
              device={session}
              index={index}
              visible={active && visibleIds.has(session.id)}
              hidden={!visibleIds.has(session.id)}
              globalPaused={paused}
              clearSignal={clear}
              focused={focused === session.id}
              onFocus={() =>
                setFocus(focused === session.id ? null : session.id)
              }
              onOpen={() => onOpen(session.id)}
              onClose={() => onClose(session.id)}
            />
          ))}
        </div>
      )}
      <footer className="multi-footer">
        <span>
          {t("Send only targets this device.")} ·{" "}
          {t("Recent display only · up to {p0} entries", {
            p0: PANEL_LOG_LIMIT,
          })}
        </span>
        <div>
          {focused ? (
            <button className="ghost" onClick={() => setFocus(null)}>
              {t("Restore grid")}
            </button>
          ) : (
            <>
              <button
                className="ghost"
                aria-label={t("Previous panels")}
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹
              </button>
              <span>
                {t("Page {p0} of {p1}", { p0: currentPage + 1, p1: pages })}
              </span>
              <button
                className="ghost"
                aria-label={t("Next panels")}
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                ›
              </button>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}

function PortPanel({
  device,
  index,
  visible,
  hidden,
  globalPaused,
  clearSignal,
  focused,
  onFocus,
  onOpen,
  onClose,
}: {
  device: DeviceSession;
  index: number;
  visible: boolean;
  hidden: boolean;
  globalPaused: boolean;
  clearSignal: number;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onClose: () => Promise<void>;
}) {
  const locale = useLocale();
  const id = useId();
  const connection = useMemo(() => desktopConnection(device.id), [device.id]);
  const {
    phase,
    wsOpen,
    status,
    error,
    connect,
    disconnect,
    activeSession,
    isCurrent,
  } = useHubConnection();
  const [store] = useState(() => new MultiSerialLog());
  const [rows, setRows] = useState<PanelEntry[]>([]);
  const [received, setReceived] = useState(0);
  const [display, setDisplay] = useState<PanelDisplay>("text");
  const [encoding, setEncoding] = useState<TextEncoding>("utf-8");
  const [txEncoding, setTxEncoding] = useState<TextEncoding>("utf-8");
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<CommandMode>("text");
  const [drafts, setDrafts] = useState({ text: "", hex: "" });
  const [ending, setEnding] = useState<LineEnding>("lf");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closing = useRef(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [lease, setLease] = useState<{
    token: string;
    expiresAt: number;
  } | null>(null);
  const operation = useRef<HubSession | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logBox = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDetailsElement>(null);
  const previousEpoch = useRef<number | undefined>(undefined);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (tools.current && !tools.current.contains(event.target as Node))
        tools.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && tools.current?.open) {
        tools.current.open = false;
        tools.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (!visible && tools.current) tools.current.open = false;
  }, [visible]);
  const options = useRef({
    visible,
    paused: paused || globalPaused,
    display,
    encoding,
  });
  options.current = {
    visible,
    paused: paused || globalPaused,
    display,
    encoding,
  };
  const statusRef = useRef(status);
  statusRef.current = status;
  const cancelPublish = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const publish = useCallback(() => {
    timer.current = undefined;
    if (!options.current.visible) return;
    setReceived(store.rxBytes);
    if (!options.current.paused)
      setRows(store.snapshot(options.current.display));
  }, [store]);
  const schedule = useCallback(() => {
    if (timer.current === undefined) timer.current = setTimeout(publish, 100);
  }, [publish]);
  const connectPanel = useCallback(() => {
    generation.current++;
    setFailure("");
    setLease(null);
    store.resetDecoder(options.current.encoding);
    return connect(connection, undefined, {
      onOpen: () => {
        generation.current++;
        store.resetDecoder(options.current.encoding);
        schedule();
      },
      onClose: () => {
        generation.current++;
        setLease(null);
        store.notice("sys", t("Live stream interrupted"));
        schedule();
      },
      onServerError: (text) => {
        store.notice("err", text);
        schedule();
      },
      onBytes: (bytes) => {
        store.receive(bytes);
        schedule();
      },
    });
  }, [connect, connection, store, schedule]);
  useEffect(() => {
    void connectPanel();
    return () => {
      invalidate();
      cancelPublish();
      disconnect();
    };
  }, [connectPanel, disconnect, cancelPublish, invalidate]);
  useEffect(() => {
    if (visible && !paused && !globalPaused) {
      setRows(store.snapshot(display));
      setReceived(store.rxBytes);
    }
  }, [visible, paused, globalPaused, display, store]);
  useEffect(() => {
    store.resetDecoder(encoding);
  }, [encoding, store]);
  useEffect(() => {
    const epoch = status?.port.epoch;
    if (epoch === undefined) return;
    if (
      previousEpoch.current !== undefined &&
      previousEpoch.current !== epoch
    ) {
      invalidate();
      setLease(null);
      store.resetDecoder(options.current.encoding);
      store.notice("sys", t("Device connection changed"));
      schedule();
    }
    previousEpoch.current = epoch;
  }, [status?.port.epoch, store, schedule, invalidate]);
  useEffect(() => {
    if (!lease) return;
    const timeout = setTimeout(
      () => setLease((current) => (current === lease ? null : current)),
      Math.max(0, lease.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [lease]);
  const clearLog = useCallback(() => {
    store.clear();
    setRows([]);
    setFailure("");
    setMessage("");
    setFollow(true);
  }, [store]);
  useEffect(clearLog, [clearSignal, clearLog]);
  useEffect(() => {
    if (visible && follow && logBox.current)
      logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [rows, visible, follow, filter]);
  const ready =
    wsOpen && phase === "connected" && status?.port.connected === true;
  const canSend = ready && (!status?.lock_owner || !!lease);
  const hasPayload =
    mode === "text"
      ? drafts.text.length > 0 || ending !== "none"
      : !!drafts.hex.trim();
  const number = useMemo(
    () => new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-arab" : locale),
    [locale],
  );
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-arab" : locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [locale],
  );
  const filtered = filter
    ? rows.filter((row) =>
        row.text.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
      )
    : rows;
  const act = async (kind: "send" | "lock" | "unlock") => {
    const session = activeSession();
    if (
      operation.current ||
      closing.current ||
      !ready ||
      !session ||
      !isCurrent(session) ||
      !session.deviceConnected ||
      !session.streamOpen
    )
      return;
    operation.current = session;
    const epoch = statusRef.current?.port.epoch;
    const currentGeneration = generation.current;
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      if (kind === "send") {
        if (!canSend) return;
        const bytes = commandBytes(
          {
            id: device.id,
            name: device.name,
            mode,
            payload: drafts[mode],
            lineEnding: mode === "hex" ? "none" : ending,
          },
          txEncoding,
        );
        if (!bytes.length) throw new Error(t("Payload must not be empty"));
        if (bytes.length > 65536) throw new Error(t("Command exceeds 64 KiB."));
        const response = await hubApi.writeHex(session.cfg, fullHex(bytes), {
          as_client: "multi-port-ui",
          lease_token: lease?.token,
          signal: session.signal,
        });
        if (!isCurrent(session)) return;
        if (!response.ok)
          throw new Error(response.error ?? t("Write rejected"));
        if (
          currentGeneration !== generation.current ||
          epoch !== statusRef.current?.port.epoch ||
          !session.streamOpen
        )
          throw new Error(
            t("Connection changed; check the device before sending again."),
          );
        store.notice(
          "tx",
          mode === "text" ? drafts.text : fullHex(bytes),
          fullHex(bytes),
        );
        setMessage(
          t("Sent {p0} bytes to {p1}", { p0: response.bytes, p1: device.path }),
        );
        schedule();
      } else if (kind === "lock") {
        const response = await hubApi.lock(
          session.cfg,
          "multi-port-ui",
          lease?.token,
          undefined,
          session.signal,
        );
        if (!isCurrent(session) || currentGeneration !== generation.current)
          return;
        if (!response.ok || !response.lock)
          throw new Error(response.error ?? t("Write rejected"));
        setLease({
          token: response.lock.lease_token,
          expiresAt: Date.now() + response.lock.expires_ms,
        });
      } else if (lease) {
        const response = await hubApi.unlock(
          session.cfg,
          lease.token,
          undefined,
          session.signal,
        );
        if (!isCurrent(session)) return;
        if (!response.ok)
          throw new Error(response.error ?? t("Write rejected"));
        setLease(null);
      }
    } catch (error) {
      if (isCurrent(session)) {
        const text = error instanceof Error ? error.message : String(error);
        setFailure(text);
        store.notice("err", text);
        schedule();
      }
    } finally {
      if (operation.current === session) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const closePanel = async () => {
    if (operation.current || closing.current) return;
    closing.current = true;
    setBusy(true);
    setFailure("");
    try {
      await onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      closing.current = false;
      setBusy(false);
    }
  };
  return (
    <article
      className="port-panel"
      hidden={hidden}
      aria-labelledby={`${id}-title`}
      data-device={device.path}
    >
      <header className="port-panel-header">
        <span className={`port-indicator ${ready ? "live" : ""}`} />
        <div className="port-identity">
          <h2 id={`${id}-title`} title={device.name}>
            {device.name}
          </h2>
          <code title={device.path}>
            {device.path} · {number.format(status?.port.baud ?? device.baud)}
          </code>
        </div>
        <span className={`port-state ${ready ? "live" : ""}`}>
          {ready
            ? t("Receiving")
            : status?.port.connected
              ? t("Connecting…")
              : t("Device offline")}
        </span>
        {device.path.startsWith("mock:") && (
          <span className="port-mock">MOCK</span>
        )}
        <span className="port-index">{String(index + 1).padStart(2, "0")}</span>
        <button
          className="port-icon-button"
          title={focused ? t("Restore grid") : t("Focus panel")}
          aria-label={focused ? t("Restore grid") : t("Focus panel")}
          onClick={onFocus}
        >
          {focused ? "⊡" : "⤢"}
        </button>
        <button
          className="port-icon-button"
          title={t("Open full workspace")}
          aria-label={t("Open full workspace")}
          onClick={onOpen}
        >
          ↗
        </button>
      </header>
      <div className="port-log-toolbar">
        <label className="port-display-label">
          <span className="sr-only">{t("Display")}</span>
          <select
            aria-label={t("Display")}
            value={display}
            onChange={(e) => setDisplay(e.target.value as PanelDisplay)}
          >
            <option value="text">{t("Text")}</option>
            <option value="hex">{t("HEX bytes")}</option>
          </select>
        </label>
        <input
          className="port-search"
          aria-label={t("Filter this log")}
          placeholder={t("Filter this log")}
          value={filter}
          maxLength={128}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className={`port-icon-button ${paused || globalPaused ? "selected" : ""}`}
          disabled={globalPaused}
          aria-label={paused ? t("Resume display") : t("Pause display")}
          aria-pressed={paused || globalPaused}
          title={paused ? t("Resume display") : t("Pause display")}
          onClick={() => setPaused((value) => !value)}
        >
          {paused || globalPaused ? "▶" : "Ⅱ"}
        </button>
        <button
          className="port-icon-button"
          title={t("Clear")}
          aria-label={t("Clear")}
          onClick={clearLog}
        >
          ⌫
        </button>
        <button
          className="port-icon-button"
          title={t("Export visible log")}
          aria-label={t("Export visible log")}
          disabled={!filtered.length}
          onClick={() =>
            downloadBlob(
              `serialhub-${device.path.replace(/[^a-z0-9_-]/gi, "_")}-${Date.now()}.log`,
              new Blob(
                [
                  filtered
                    .map(
                      (row) =>
                        `${new Date(row.time).toISOString()} ${row.kind.toUpperCase()} ${row.text}${row.truncated ? " …" : ""}`,
                    )
                    .join("\n"),
                ],
                { type: "text/plain;charset=utf-8" },
              ),
            )
          }
        >
          ↓
        </button>
        <details
          className="port-tools"
          ref={tools}
          onToggle={(event) => {
            if (!event.currentTarget.open) setConfirmClose(false);
          }}
        >
          <summary title={t("Panel tools")} aria-label={t("Panel tools")}>
            •••
          </summary>
          <div>
            <label>
              {t("Receive encoding")}
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value as TextEncoding)}
              >
                <option value="utf-8">UTF-8</option>
                <option value="gbk">GBK</option>
              </select>
            </label>
            <label>
              {t("Transmit encoding")}
              <select
                value={txEncoding}
                onChange={(e) => setTxEncoding(e.target.value as TextEncoding)}
              >
                <option value="utf-8">UTF-8</option>
                <option value="gbk">GBK</option>
                <option value="ascii">ASCII</option>
              </select>
            </label>
            <button disabled={!ready || busy} onClick={() => void act("lock")}>
              {lease ? t("Renew lease") : t("Acquire write lease")}
            </button>
            <button
              disabled={!ready || busy || !lease}
              onClick={() => void act("unlock")}
            >
              {t("Release write lease")}
            </button>
            <button
              className="port-close"
              disabled={busy}
              onClick={() =>
                confirmClose ? void closePanel() : setConfirmClose(true)
              }
            >
              {confirmClose ? t("Confirm close") : t("Close session")}
            </button>
            {confirmClose && (
              <>
                <p>{t("Close this device and disconnect its clients?")}</p>
                <button onClick={() => setConfirmClose(false)}>
                  {t("Cancel")}
                </button>
              </>
            )}
            <p>
              {t("Recent display only · up to {p0} entries", {
                p0: PANEL_LOG_LIMIT,
              })}
            </p>
          </div>
        </details>
      </div>
      <div
        className="port-log"
        ref={logBox}
        role="region"
        tabIndex={0}
        aria-label={t("Recent log for {p0}", { p0: device.name })}
        onScroll={(e) => {
          const box = e.currentTarget;
          if (box.scrollHeight - box.clientHeight - box.scrollTop > 48)
            setFollow(false);
        }}
      >
        {!filtered.length && (
          <div className="port-log-empty">
            <Icon name="terminal" size={24} />
            <span>
              {filter ? t("No matches") : t("Waiting for device data")}
            </span>
          </div>
        )}
        {filtered.map((row) => (
          <div className={`port-entry ${row.kind}`} key={row.id}>
            <time>{time.format(row.time)}</time>
            <b>{row.kind.toUpperCase()}</b>
            <pre dir="ltr">
              {row.text}
              {row.truncated && (
                <span className="port-truncated">
                  {" "}
                  … [{t("display truncated")}]
                </span>
              )}
            </pre>
          </div>
        ))}
      </div>
      <div className="port-stream-status">
        <span className={paused || globalPaused ? "paused" : ""}>
          {paused || globalPaused
            ? t("Display paused; reception continues.")
            : `RX ${number.format(received)} B`}
        </span>
        <span>
          TX {number.format(status?.stats.tx_bytes ?? 0)} B ·{" "}
          {status?.stats.rx_drops
            ? `${t("RX drops")} ${number.format(status.stats.rx_drops)}`
            : ""}
        </span>
        <button
          className={`port-follow ${follow ? "selected" : ""}`}
          aria-pressed={follow}
          onClick={() => {
            setFollow((value) => !value);
            if (logBox.current)
              logBox.current.scrollTop = logBox.current.scrollHeight;
          }}
        >
          {t("Auto-scroll")} ↓
        </button>
      </div>
      <form
        className="port-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void act("send");
        }}
      >
        <div className="port-composer-options">
          <div className="port-mode">
            <button
              type="button"
              aria-pressed={mode === "text"}
              onClick={() => setMode("text")}
            >
              {t("Text")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "hex"}
              onClick={() => setMode("hex")}
            >
              HEX
            </button>
          </div>
          <span className="port-target" title={device.path}>
            <Icon name="arrow" size={12} />
            <code>{device.path}</code>
          </span>
          <select
            aria-label={t("Line ending")}
            value={ending}
            disabled={mode === "hex"}
            onChange={(e) => setEnding(e.target.value as LineEnding)}
          >
            {(["none", "lf", "cr", "crlf"] as LineEnding[]).map((value) => (
              <option key={value} value={value}>
                {lineEndingLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="port-compose-row">
          <textarea
            aria-label={t("Command for {p0}", { p0: device.name })}
            placeholder={
              mode === "hex"
                ? "00 01 FF"
                : t("Command for {p0}", { p0: device.name })
            }
            value={drafts[mode]}
            maxLength={65536}
            spellCheck={false}
            onChange={(e) =>
              setDrafts((value) => ({ ...value, [mode]: e.target.value }))
            }
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void act("send");
              }
            }}
          />
          <button
            type="submit"
            title={t("Send to {p0}", { p0: device.path })}
            aria-label={t("Send to {p0}", { p0: device.path })}
            disabled={!canSend || busy || !hasPayload}
          >
            {busy ? t("Working…") : t("Send")} <Icon name="arrow" size={14} />
          </button>
        </div>
      </form>
      <div
        className="port-result"
        role={failure || error ? "alert" : "status"}
        title={failure || error || message || status?.port.detail || ""}
      >
        {failure ||
          error ||
          message ||
          (!ready
            ? status?.port.detail
            : status?.lock_owner && !lease
              ? t("Write permission is held by {p0}", { p0: status.lock_owner })
              : t("Ctrl/⌘ + Enter to send"))}
        {phase === "error" && (
          <button onClick={() => void connectPanel()}>{t("Reconnect")}</button>
        )}
      </div>
    </article>
  );
}
