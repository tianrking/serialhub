import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import App from "./App";
import type { SerialSettings } from "./api/types";
import { LanguageSelector } from "./i18n/LanguageSelector";
import { getFormattingLocale, t } from "./i18n/index";
import { useLocale } from "./i18n/useLocale";
import "./desktop.css";

type Session = {
  id: string;
  name: string;
  path: string;
  baud: number;
  connected: boolean;
  detail: string;
  clients: number;
  rx_bytes: number;
  tx_bytes: number;
};
type Info = {
  product: string;
  version: string;
  local: boolean;
  limit: number;
  supports_pty: boolean;
  sessions: Session[];
  lan: { url: string; pair_url: string; port: number } | null;
};
type Port = { path: string; kind: string };
const initialSettings: SerialSettings = {
  baud: 115200,
  databits: 8,
  parity: "none",
  stopbits: 1,
  flow: "none",
};
class PairingRequired extends Error {}
async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`/manager/${path}`, {
    method,
    credentials: "same-origin",
    signal: AbortSignal.timeout(8000),
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401)
    throw new PairingRequired(t("Pair this browser"));
  if (!response.ok) {
    const result = (await response.json()) as { error?: string };
    throw new Error(result.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export default function Desktop() {
  useLocale();
  const [mode, setMode] = useState<
    "loading" | "legacy" | "manager" | "pair" | "stopped" | "error"
  >("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [ports, setPorts] = useState<Port[]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [settings, setSettings] = useState(initialSettings);
  const [tcpPort, setTcpPort] = useState("");
  const [ptyCount, setPtyCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const pairing = useRef<Promise<unknown> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const requestId = ++generation.current;
    const next = await api<Info>("info");
    if (!mounted.current || requestId !== generation.current) return;
    if (next.product !== "serialhub.desktop.v1")
      throw new Error("Unexpected manager response");
    setInfo(next);
    setMode("manager");
    setSelected((id) => (next.sessions.some((s) => s.id === id) ? id : null));
    setVisited((ids) =>
      ids.filter((id) => next.sessions.some((s) => s.id === id)),
    );
  }, []);
  const scan = useCallback(async () => {
    const result = await api<{ ports: Port[] }>("ports");
    if (mounted.current) setPorts(result.ports);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const initialize = async () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const code = params.get("pair");
      if (code) {
        history.replaceState(null, "", location.pathname + location.search);
        pairing.current = api("pair", { code });
      }
      if (pairing.current) {
        const pending = pairing.current;
        await pending;
        if (pairing.current === pending) pairing.current = null;
      }
      if (cancelled) return;
      const response = await fetch("/manager/info", {
        signal: AbortSignal.timeout(8000),
      });
      if (cancelled) return;
      if (response.status === 401) {
        setMode("pair");
        return;
      }
      if (
        response.status === 404 ||
        response.headers.get("content-type")?.includes("text/html")
      ) {
        setMode("legacy");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refresh();
      await scan().catch((e) => setError(String(e)));
    };
    const start = () => {
      void initialize().catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setMode(e instanceof PairingRequired ? "pair" : "error");
        }
      });
    };
    start();
    window.addEventListener("hashchange", start);
    return () => {
      cancelled = true;
      mounted.current = false;
      window.removeEventListener("hashchange", start);
    };
  }, [refresh, scan]);
  useEffect(() => {
    if (mode !== "manager") return;
    const timer = setInterval(() => {
      void refresh().catch((e) => {
        if (!mounted.current) return;
        setError(String(e));
        if (e instanceof PairingRequired) {
          setMode("pair");
          setInfo(null);
          setVisited([]);
        }
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [mode, refresh]);
  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(String(e));
      if (e instanceof PairingRequired) setMode("pair");
    } finally {
      setBusy(false);
    }
  };
  const openWorkspace = (id: string) => {
    setVisited((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setSelected(id);
  };
  const openSession = async (devicePath: string, sessionName: string) => {
    const result = await api<{ id: string }>("sessions", {
      path: devicePath,
      name: sessionName || devicePath,
      settings,
      ...(tcpPort ? { tcp_port: Number(tcpPort) } : {}),
      pty_count: ptyCount,
    });
    await refresh();
    openWorkspace(result.id);
  };
  if (mode === "legacy") return <App />;
  const heading = (
    <>
      <div className="manager-brand">
        <span className="manager-symbol">S</span>
        <div>
          <strong>
            SerialHub<span>.</span>
          </strong>
          <small>{t("Device manager")}</small>
        </div>
      </div>
      <LanguageSelector />
    </>
  );
  if (mode !== "manager")
    return (
      <div className="manager-gate">
        <header>{heading}</header>
        <main>
          <span className="manager-kicker">SERIALHUB / {t("WORKSPACE")}</span>
          <h1>
            {mode === "pair"
              ? t("Pair this browser")
              : mode === "stopped"
                ? t("SerialHub stopped")
                : mode === "loading"
                  ? t("Opening workspace…")
                  : t("Cannot reach device manager")}
          </h1>
          <p>
            {mode === "pair"
              ? t(
                  "Open the pairing link copied from the device host, or paste its code below.",
                )
              : mode === "stopped"
                ? t(
                    "All device sessions are closed. Launch SerialHub again to continue.",
                  )
                : t("Your devices and tools, in one browser workspace.")}
          </p>
          {mode === "pair" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await api("pair", { code: pairCode.trim() });
                  setPairCode("");
                  await refresh();
                  await scan();
                });
              }}
            >
              <label>
                {t("Pairing code")}
                <input
                  type="password"
                  autoComplete="off"
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                />
              </label>
              <button disabled={busy || !pairCode.trim()}>
                {t("Pair browser")}
              </button>
            </form>
          )}
          {mode === "error" && (
            <button onClick={() => location.reload()}>{t("Retry")}</button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </main>
      </div>
    );
  return (
    <div className={`desktop-shell${selected ? " has-workspace" : ""}`}>
      <header className="manager-toolbar">
        {heading}
        <div
          className="manager-tabs"
          role="tablist"
          aria-label={t("Device sessions")}
        >
          <button
            role="tab"
            aria-selected={!selected}
            onClick={() => setSelected(null)}
          >
            {t("All devices")}
            <b>{info?.sessions.length ?? 0}</b>
          </button>
          {info?.sessions.map((s) => (
            <button
              role="tab"
              aria-selected={selected === s.id}
              key={s.id}
              onClick={() => openWorkspace(s.id)}
              title={s.path}
            >
              <i className={s.connected ? "connected" : ""} />
              {s.name}
            </button>
          ))}
        </div>
        <span className="manager-host">
          {info?.local ? t("Device host") : t("Paired browser")}
        </span>
      </header>
      <div className="manager-dashboard" hidden={!!selected}>
        <div className="manager-intro">
          <div>
            <span className="manager-kicker">
              SERIALHUB / {t("Device manager")}
            </span>
            <h1>{t("Your devices. One workspace.")}</h1>
            <p>
              {t(
                "Open a serial port, then share it across independent tools and browsers.",
              )}
            </p>
          </div>
          <div className="manager-count">
            <strong>
              {info?.sessions.length ?? 0}
              <small> / {info?.limit}</small>
            </strong>
            <span>{t("Independent sessions")}</span>
          </div>
        </div>
        {error && (
          <div className="manager-alert error" role="alert">
            {error}
            <button className="ghost" onClick={() => setError("")}>
              {t("Dismiss")}
            </button>
          </div>
        )}
        {notice && (
          <p className="manager-alert" role="status">
            {notice}
          </p>
        )}
        <div className="manager-grid">
          <section className="manager-card manager-new">
            <div className="manager-card-title">
              <div>
                <span className="manager-step">01</span>
                <h2>{t("Open a device")}</h2>
              </div>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => void action(scan)}
              >
                {t("Scan ports")}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => openSession(path.trim(), name.trim()));
              }}
            >
              <label>
                {t("Serial port")}
                <select
                  value={ports.some((p) => p.path === path) ? path : ""}
                  onChange={(e) => setPath(e.target.value)}
                >
                  <option value="">{t("Select a detected port")}</option>
                  {ports.map((p) => (
                    <option value={p.path} key={p.path}>
                      {p.path} · {p.kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Device path")}
                <input
                  required
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  maxLength={256}
                  placeholder="COM3 / /dev/ttyUSB0"
                  autoComplete="off"
                />
              </label>
              <label>
                {t("Session name")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder={t("e.g. Sensor board")}
                />
              </label>
              <div className="manager-fields">
                <label>
                  {t("Baud rate")}
                  <input
                    type="number"
                    min={1}
                    max={4000000}
                    required
                    value={settings.baud}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        baud: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  {t("Data bits")}
                  <select
                    value={settings.databits}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        databits: Number(e.target.value),
                      }))
                    }
                  >
                    {[5, 6, 7, 8].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Parity")}
                  <select
                    value={settings.parity}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        parity: e.target.value as SerialSettings["parity"],
                      }))
                    }
                  >
                    <option value="none">{t("None")}</option>
                    <option value="odd">{t("Odd")}</option>
                    <option value="even">{t("Even")}</option>
                  </select>
                </label>
                <label>
                  {t("Stop bits")}
                  <select
                    value={settings.stopbits}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        stopbits: Number(e.target.value),
                      }))
                    }
                  >
                    <option>1</option>
                    <option>2</option>
                  </select>
                </label>
                <label>
                  {t("Flow control")}
                  <select
                    value={settings.flow}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        flow: e.target.value as SerialSettings["flow"],
                      }))
                    }
                  >
                    <option value="none">{t("None")}</option>
                    <option value="hardware">RTS/CTS</option>
                    <option value="software">XON/XOFF</option>
                  </select>
                </label>
              </div>
              <details className="manager-advanced">
                <summary>{t("External tools (optional)")}</summary>
                <p>
                  {t(
                    "One TCP endpoint accepts multiple local programs. Use browser pairing for LAN access.",
                  )}
                </p>
                <div className="manager-fields">
                  <label>
                    {t("Local TCP port")}
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={tcpPort}
                      onChange={(e) => setTcpPort(e.target.value)}
                      placeholder={t("Disabled")}
                    />
                  </label>
                  {info?.supports_pty && (
                    <label>
                      {t("Virtual serial ports")}
                      <select
                        value={ptyCount}
                        onChange={(e) => setPtyCount(Number(e.target.value))}
                      >
                        {[0, 1, 2, 3, 4].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </details>
              <button
                className="manager-open"
                disabled={
                  busy ||
                  !path.trim() ||
                  (info?.sessions.length ?? 0) >= (info?.limit ?? 16)
                }
              >
                {busy ? t("Working…") : t("Open workspace")}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            <div className="manager-demo">
              <div>
                <strong>{t("No hardware yet?")}</strong>
                <p>
                  {t(
                    "Try a separate loopback session. No real device is opened.",
                  )}
                </p>
              </div>
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    openSession(
                      `mock:demo-${Date.now()}`,
                      `${t("Demo")} ${(info?.sessions.length ?? 0) + 1}`,
                    ),
                  )
                }
              >
                {t("Try demo")}
              </button>
            </div>
          </section>
          <section className="manager-card manager-sessions">
            <div className="manager-card-title">
              <div>
                <span className="manager-step">02</span>
                <h2>{t("Active sessions")}</h2>
              </div>
              <span>{t("Separate data · separate write leases")}</span>
            </div>
            <div className="manager-session-list">
              {!info?.sessions.length && (
                <div className="manager-empty">
                  <span aria-hidden="true">⌁</span>
                  <h3>{t("Ready when you are")}</h3>
                  <p>
                    {t(
                      "Connect your first device or try the demo. Multiple ports can run at the same time.",
                    )}
                  </p>
                </div>
              )}
              {info?.sessions.map((s) => (
                <article className="manager-session" key={s.id}>
                  <div className="manager-session-main">
                    <i className={s.connected ? "connected" : ""} />
                    <div>
                      <strong>{s.name}</strong>
                      <code>{s.path}</code>
                    </div>
                    <span
                      className={
                        s.connected ? "manager-ready" : "manager-waiting"
                      }
                    >
                      {s.connected ? t("Device open") : t("Device offline")}
                    </span>
                  </div>
                  <div className="manager-session-stats">
                    <span>
                      {s.baud.toLocaleString(getFormattingLocale())} baud
                    </span>
                    <span>
                      RX {s.rx_bytes.toLocaleString(getFormattingLocale())} B
                    </span>
                    <span>
                      TX {s.tx_bytes.toLocaleString(getFormattingLocale())} B
                    </span>
                    <span>
                      {s.clients} {t("clients")}
                    </span>
                  </div>
                  {!s.connected && <p className="manager-detail">{s.detail}</p>}
                  <div className="manager-session-actions">
                    <button
                      className="ghost"
                      onClick={() => openWorkspace(s.id)}
                    >
                      {t("Open workspace")} ↗
                    </button>
                    {closeId === s.id ? (
                      <>
                        <span>{t("Close all clients on this port?")}</span>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await api(
                                `sessions/${s.id}`,
                                undefined,
                                "DELETE",
                              );
                              setCloseId(null);
                              await refresh();
                            })
                          }
                        >
                          {t("Close session")}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setCloseId(null)}
                        >
                          {t("Cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="ghost manager-close"
                        disabled={busy}
                        onClick={() => setCloseId(s.id)}
                      >
                        {t("Close session")}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="manager-card manager-sharing">
            <div>
              <span className="manager-kicker">{t("BROWSER SHARING")}</span>
              <h2>{t("Work locally. Share on your LAN.")}</h2>
              <p>
                {t(
                  "Every browser gets the same device stream. Write leases coordinate commands.",
                )}
              </p>
            </div>
            {info?.local ? (
              <div className="manager-lan-controls">
                {info.lan ? (
                  <>
                    <label>
                      {t("Pairing link")}
                      <input
                        readOnly
                        value={info.lan.pair_url}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <div className="row">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            if (navigator.clipboard && window.isSecureContext) {
                              await navigator.clipboard.writeText(
                                info.lan!.pair_url,
                              );
                              setNotice(t("Pairing link copied"));
                            } else {
                              setNotice(t("Select and copy the pairing link"));
                            }
                          })
                        }
                      >
                        {t("Copy pairing link")}
                      </button>
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await api("lan", undefined, "DELETE");
                            await refresh();
                          })
                        }
                      >
                        {t("Disable LAN sharing")}
                      </button>
                    </div>
                    <small>
                      {t(
                        "Anyone with this link can use the devices. Use a trusted LAN; traffic uses HTTP.",
                      )}
                    </small>
                  </>
                ) : (
                  <>
                    <span className="manager-private">
                      ● {t("Local access only")}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api("lan", {});
                          await refresh();
                        })
                      }
                    >
                      {t("Enable LAN sharing")}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <span className="manager-private">
                {t("LAN settings are managed on the device host")}
              </span>
            )}
          </section>
        </div>
        <footer className="manager-footer">
          <span>
            SerialHub v{info?.version} ·{" "}
            {t("Runs on this computer. No cloud account required.")}
          </span>
          {info?.local && (
            <div>
              {quitConfirm ? (
                <>
                  <span>{t("Stop SerialHub and close every device?")}</span>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("quit", {});
                        setVisited([]);
                        setInfo(null);
                        setMode("stopped");
                      })
                    }
                  >
                    {t("Stop SerialHub")}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => setQuitConfirm(false)}
                  >
                    {t("Cancel")}
                  </button>
                </>
              ) : (
                <button className="ghost" onClick={() => setQuitConfirm(true)}>
                  {t("Quit SerialHub")}
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
      {visited
        .filter((id) => info?.sessions.some((s) => s.id === id))
        .map((id) => (
          <SessionWorkspace key={id} id={id} active={selected === id} />
        ))}
    </div>
  );
}

function SessionWorkspace({ id, active }: { id: string; active: boolean }) {
  const connection = useMemo(
    () => ({
      host: location.hostname,
      port:
        Number(location.port) || (location.protocol === "https:" ? 443 : 80),
      protocol:
        location.protocol === "https:" ? ("https" as const) : ("http" as const),
      basePath: `/sessions/${id}`,
    }),
    [id],
  );
  return (
    <div className="managed-workspace" hidden={!active}>
      <App managedConnection={connection} />
    </div>
  );
}
