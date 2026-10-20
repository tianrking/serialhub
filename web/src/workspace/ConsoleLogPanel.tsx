import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { t } from "../i18n/index.ts";
import Icon from "../Icon";
import { type StreamProtocol } from "../protocolUtils";
import { downloadTextFile } from "./download.ts";
import type { ConsoleWorkspace } from "./useConsoleWorkspace.ts";

export default function ConsoleLogPanel({
  receiver,
  hub,
  logging,
  copy,
}: Pick<ConsoleWorkspace, "receiver" | "hub" | "logging"> & {
  copy: (text: string) => Promise<void>;
}) {
  const {
    receiveEncoding,
    setReceiveEncoding,
    streamProtocol,
    setStreamProtocol,
  } = receiver;
  const { online, wsOpen } = hub;
  const { paused, setPaused, pushLog } = logging;
  const logs = useSyncExternalStore(
    logging.store.subscribe,
    logging.store.getSnapshot,
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<"text" | "hex" | "both">(
    "both",
  );
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [logSearch, setLogSearch] = useState("");
  const [logKind, setLogKind] = useState("all");
  const visibleLogs = useMemo(
    () =>
      logs.filter(
        (line) =>
          (logKind === "all" || line.kind === logKind) &&
          (!logSearch.trim() ||
            `${line.text} ${line.hex ?? ""}`
              .toLowerCase()
              .includes(logSearch.trim().toLowerCase())),
      ),
    [logs, logKind, logSearch],
  );
  const exportVisibleLogs = () => {
    const text = visibleLogs
      .map(
        (line) =>
          `${line.ts}\t${line.kind.toUpperCase()}\t${line.text}${line.hex ? `\t${line.hex}` : ""}`,
      )
      .join("\n");
    downloadTextFile(
      `serialhub-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
      text,
    );
    pushLog({
      kind: "sys",
      text: t("Exported {p0} page log entries", {
        p0: String(visibleLogs.length),
      }),
    });
  };
  useEffect(() => {
    if (!autoScroll || !logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs, autoScroll]);
  return (
    <section className="panel log-panel">
      <div className="log-head">
        <div className="terminal-title">
          <span className={`stream-dot ${wsOpen ? "live" : ""}`} />
          <h2>{t("Live terminal")}</h2>
          <span className="terminal-transport">WS /v1/stream</span>
        </div>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />{" "}
            {t("Pause display")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />{" "}
            {t("Auto-scroll")}
          </label>
          <label>
            {t("Display")}{" "}
            <select
              aria-label={t("Display")}
              value={displayMode}
              onChange={(e) =>
                setDisplayMode(e.target.value as typeof displayMode)
              }
            >
              <option value="both">{t("Text + Hex")}</option>
              <option value="text">{t("Text only")}</option>
              <option value="hex">{t("Hex only")}</option>
            </select>
          </label>
          <label>
            {t("RX encoding")}{" "}
            <select
              aria-label={t("Receive text encoding")}
              value={receiveEncoding}
              onChange={(event) => setReceiveEncoding(event.target.value)}
            >
              <option value="utf-8">UTF-8</option>
              <option value="gbk">GBK</option>
              <option value="gb18030">GB18030</option>
              <option value="windows-1252">Western ANSI</option>
            </select>
          </label>
          <label>
            {t("Parser")}{" "}
            <select
              value={streamProtocol}
              onChange={(e) =>
                setStreamProtocol(e.target.value as StreamProtocol)
              }
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
            />{" "}
            {t("Timestamps")}
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              logging.store.clear();
            }}
          >
            {t("Clear")}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!visibleLogs.length}
            onClick={() =>
              void copy(
                visibleLogs
                  .map((l) =>
                    [
                      showTimestamp ? l.ts : "",
                      l.kind.toUpperCase(),
                      displayMode === "hex"
                        ? (l.hex ?? "")
                        : displayMode === "both" && l.hex
                          ? `${l.text}\n${l.hex}`
                          : l.text,
                    ]
                      .filter(Boolean)
                      .join(" "),
                  )
                  .join("\n"),
              )
            }
          >
            {t("Copy log")}
          </button>
          <button type="button" className="ghost" onClick={exportVisibleLogs}>
            {t("Export log")}
          </button>
        </div>
      </div>
      <div className="log-filter">
        <Icon name="search" size={16} />
        <input
          aria-label={t("Search terminal log")}
          placeholder={t("Search text or Hex…")}
          value={logSearch}
          onChange={(event) => setLogSearch(event.target.value)}
        />
        <select
          aria-label={t("Log type")}
          value={logKind}
          onChange={(event) => setLogKind(event.target.value)}
        >
          <option value="all">{t("All types")}</option>
          <option value="rx">{t("RX received data")}</option>
          <option value="tx">{t("TX sent data")}</option>
          <option value="err">{t("Error")}</option>
          <option value="sys">{t("System")}</option>
        </select>
        <span>
          {visibleLogs.length} {t("records")}
        </span>
      </div>
      <div
        className="log"
        ref={logBoxRef}
        onPointerDown={(event) => {
          if (!(event.target as Element).closest("button"))
            setAutoScroll(false);
        }}
        role="region"
        aria-label={t("Live terminal records")}
        tabIndex={0}
      >
        {visibleLogs.length === 0 && (
          <div className="terminal-empty">
            <span className="empty-terminal-icon">⌁</span>
            <strong>
              {logs.length
                ? t("No matching records")
                : t("Waiting for device data")}
            </strong>
            <span>
              {online
                ? t("Send a command or wait for device output.")
                : t(
                    "Device output will appear here after connecting to the Hub.",
                  )}
            </span>
          </div>
        )}
        {visibleLogs.map((l) => (
          <div key={l.id} className={`line ${l.kind}`}>
            <span className="ts">{showTimestamp ? l.ts : ""}</span>
            <span className="kind">{l.kind.toUpperCase()}</span>
            {displayMode !== "hex" && (
              <span
                className="msg"
                dir={l.kind === "rx" || l.kind === "tx" ? "ltr" : "auto"}
              >
                {l.text}
              </span>
            )}
            {displayMode !== "text" && l.hex && (
              <span className="hex">{l.hex}</span>
            )}
            <button
              type="button"
              className="log-copy-row"
              tabIndex={-1}
              title={t("Copy payload")}
              aria-label={t("Copy payload")}
              onClick={() =>
                void copy(displayMode === "hex" ? (l.hex ?? "") : l.text)
              }
            >
              ⧉
            </button>
          </div>
        ))}
      </div>
      <div className="terminal-statusbar">
        <span>
          {paused
            ? t("Display paused; acquisition continues")
            : wsOpen
              ? t("Receiving live stream")
              : t("Waiting for live stream")}
        </span>
        <span>
          {t(
            "Up to 2,000 records · long packets truncated · full records in the ledger",
          )}
        </span>
      </div>
    </section>
  );
}
