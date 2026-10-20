import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import type { ConnectionConfig } from "./api/types";
import { httpBase } from "./api/types";
import "./App.css";
import BrandMark from "./BrandMark";
import { t, translate } from "./i18n/index.ts";
import { LanguageSelector } from "./i18n/LanguageSelector";
import { useLocale } from "./i18n/useLocale";
import Icon from "./Icon";
import { fullHex } from "./serialTools";
import "./signals/signals.css";
import SignalWorkbench from "./signals/SignalWorkbench";
import TrafficCounters from "./TrafficCounters";
import useClipboard from "./useClipboard";
import "./workspace.css";
import ConnectionEndpoints from "./workspace/ConnectionEndpoints";
import ConnectionPanel from "./workspace/ConnectionPanel";
import DeviceOverview from "./workspace/DeviceOverview";
import MonitorWorkspace from "./workspace/MonitorWorkspace";
import ProtocolGuide from "./workspace/ProtocolGuide";
import type { WorkspaceTab as Tab } from "./workspace/types.ts";
import { useConsoleWorkspace } from "./workspace/useConsoleWorkspace.ts";
import WorkspaceEvidence from "./workspace/WorkspaceEvidence";

export default function App({
  managedConnection,
  deviceNavigation,
  onAppMenu,
}: {
  managedConnection?: ConnectionConfig;
  deviceNavigation?: ReactNode;
  onAppMenu?: () => void;
} = {}) {
  const workspaceId = useId();
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("monitor");
  const model = useConsoleWorkspace(managedConnection, tab === "events");
  const connection = model.connection;
  const { conn } = connection;
  const quick = model.quick;
  const { quickCommands } = quick;
  const receiver = model.receiver;
  const { trafficRef, streamProtocol, setStreamProtocol, signalStore } =
    receiver;
  const serial = model.serial;
  const { canWrite, busy, jobLabel, transmit, stopJob } = serial;
  const evidence = model.evidence;
  const hub = model.hub;
  const { phase, online, wsOpen, status, error, retryCount } = hub;
  const lifecycle = model.lifecycle;
  const { connect } = lifecycle;
  const logging = model.logging;

  const clipboard = useClipboard();
  const copy = clipboard.copy;
  const statusLamp = useMemo(() => {
    if (phase === "connecting")
      return { cls: "warn", label: translate(locale, "Connecting…") };
    if (phase === "reconnecting")
      return {
        cls: "warn",
        label: translate(locale, "Reconnecting stream · {p0}/5", {
          p0: String(retryCount),
        }),
      };
    if (phase === "error")
      return { cls: "off", label: translate(locale, "Connection error") };
    if (online && wsOpen)
      return { cls: "ok", label: translate(locale, "Connected · HTTP + WS") };
    if (online)
      return {
        cls: "warn",
        label: translate(locale, "HTTP ready; WS disconnected"),
      };
    return { cls: "off", label: translate(locale, "Disconnected") };
  }, [online, wsOpen, phase, retryCount, locale]);
  const Brand = onAppMenu ? "button" : "div";
  const headerStatus = (
    <div className="header-status">
      <LanguageSelector />
      <span className="local-badge">
        <Icon name="shield" size={14} /> {t("Single device owner")}
      </span>
      <div className={`lamp ${statusLamp.cls}`} role="status">
        {statusLamp.label}
      </div>
    </div>
  );
  return (
    <div
      className={`app${managedConnection ? " app-managed" : ""}`}
      data-workspace={tab}
    >
      <a className="skip-link" href={`#${workspaceId}-main-content`}>
        {t("Skip to workspace")}
      </a>
      <header className="sidebar">
        <Brand
          className="brand"
          onClick={onAppMenu}
          aria-label={onAppMenu ? t("Application menu") : undefined}
          aria-haspopup={onAppMenu ? "dialog" : undefined}
          title={onAppMenu ? t("Application menu") : undefined}
        >
          <span className="brand-mark">
            <BrandMark size={25} />
          </span>
          <div>
            SerialHub<small>{t("DEVICE WORKSPACE")}</small>
          </div>
          {onAppMenu && (
            <span className="brand-caret" aria-hidden="true">
              ⌄
            </span>
          )}
        </Brand>
        <div className="nav-label">{t("Workspace")}</div>
        <nav className="sidebar-nav" aria-label={t("Main navigation")}>
          {(
            [
              ["monitor", "terminal", t("Live console"), "01"],
              ["signals", "activity", t("Signal studio"), "02"],
              ["events", "activity", t("Events & metrics"), "03"],
              ["endpoints", "layers", t("Connections"), "04"],
              ["protocol", "book", t("User guide"), "05"],
            ] as const
          ).map(([id, icon, label, number]) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} />
              <span title={label}>{label}</span>
              <small>{number}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Icon name="shield" />
          <strong>{t("One port, coordinated access")}</strong>
          <p>
            {t("Manage device access centrally,")} <br />{" "}
            {t("with a record of every operation.")}
          </p>
          <span>{t("OPEN SOURCE · MIT")}</span>
        </div>
        <div className="sidebar-footer">
          <span className="version-dot" />
          SerialHub <code>v{__APP_VERSION__}</code>
        </div>
        {managedConnection && (
          <div className="workspace-controls">
            {deviceNavigation}
            {headerStatus}
          </div>
        )}
      </header>
      {!managedConnection && (
        <header className="header">
          <div>
            <div className="eyebrow">
              {t("WORKSPACE")} <span>/</span>{" "}
              {tab === "signals"
                ? "SIGNAL STUDIO"
                : tab === "monitor"
                  ? "LIVE CONSOLE"
                  : tab === "events"
                    ? "EVENT EVIDENCE"
                    : tab === "endpoints"
                      ? "CONNECTIONS"
                      : "GUIDE"}
            </div>
            <h1>
              {tab === "signals"
                ? t("Signals & visualization")
                : tab === "monitor"
                  ? t("Serial workspace")
                  : tab === "events"
                    ? t("Events & runtime metrics")
                    : tab === "endpoints"
                      ? t("Connections")
                      : t("User guide")}
              <span className="heading-dot" aria-hidden="true">
                .
              </span>
            </h1>
            <p className="sub">
              {t("Connect, inspect data and keep debugging organized.")}
            </p>
          </div>
          {headerStatus}
        </header>
      )}
      <main id={`${workspaceId}-main-content`} className="workspace-main">
        {managedConnection && error && (
          <div className="managed-error" role="alert">
            {error}
            <button onClick={() => void connect()}>{t("Reconnect")}</button>
          </div>
        )}
        {!managedConnection && (
          <ConnectionPanel
            connection={connection}
            hub={hub}
            lifecycle={lifecycle}
          />
        )}
        <DeviceOverview serial={serial} hub={hub} logging={logging} />
        {jobLabel && (
          <div className="job-status" role="status">
            <span className="stream-dot live" />
            <strong>{jobLabel}</strong>
            <span>{t("Serial send job running")}</span>
            <button type="button" onClick={stopJob}>
              {t("Stop send job")}
            </button>
            <small>
              {t("Stops after the current block ACK; no automatic retry")}
            </small>
          </div>
        )}
        <div className="workspace-heading">
          <div>
            <span className="section-index">
              {
                {
                  monitor: "01",
                  signals: "02",
                  events: "03",
                  endpoints: "04",
                  protocol: "05",
                }[tab]
              }
            </span>
            <h2>
              {tab === "signals"
                ? t("Signal studio")
                : tab === "monitor"
                  ? t("Live monitoring")
                  : tab === "events"
                    ? t("Event evidence")
                    : tab === "endpoints"
                      ? t("Shared endpoints")
                      : t("Protocol & operations")}
            </h2>
          </div>
          <span>{online ? httpBase(conn) : t("No active session")}</span>
        </div>
        {
          <MonitorWorkspace
            connection={connection}
            quick={quick}
            receiver={receiver}
            serial={serial}
            hub={hub}
            logging={logging}
            copy={copy}
            workspaceId={workspaceId}
            visible={tab === "monitor"}
            onSignals={() => setTab("signals")}
          />
        }

        {clipboard.dialog}
        {clipboard.feedback && (
          <output className="clipboard-notice" role="status">
            {clipboard.feedback}
          </output>
        )}
        <SignalWorkbench
          isMock={status?.port.path.startsWith("mock:")}
          visible={tab === "signals"}
          store={signalStore}
          protocol={streamProtocol}
          onProtocol={setStreamProtocol}
          canWrite={canWrite}
          busy={busy}
          commands={quickCommands}
          onQuick={(command) =>
            transmit(command.mode, command.payload, command.lineEnding)
          }
          onValue={(payload) =>
            transmit(
              "hex",
              fullHex(new TextEncoder().encode(payload + "\n")),
              "none",
            )
          }
        />

        {tab === "events" && (
          <WorkspaceEvidence evidence={evidence} hub={hub} />
        )}

        {tab === "endpoints" && (
          <ConnectionEndpoints connection={connection} hub={hub} copy={copy} />
        )}

        {tab === "protocol" && <ProtocolGuide connection={connection} />}
      </main>
      <footer className="footer">
        <TrafficCounters counters={trafficRef} />
        <span className="footer-caption">
          {t("SerialHub · Local device sharing workspace")}
        </span>
      </footer>
    </div>
  );
}
