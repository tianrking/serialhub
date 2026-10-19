import { t } from "./i18n/index.ts";
import { useMemo } from "react";

type MetricsPanelProps = {
  text: string;
  loading: boolean;
  error: string | null;
  online: boolean;
  onRefresh: () => void;
  onExport: () => void;
};

type MetricRow = { name: string; value: string; help?: string };

function parseMetrics(text: string): MetricRow[] {
  const help = new Map<string, string>();
  const rows: MetricRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# HELP ")) {
      const [, , name, ...description] = line.split(" ");
      if (name) help.set(name, description.join(" "));
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([^\s]+)$/);
    if (match) rows.push({ name: match[1], value: match[2], help: help.get(match[1]) });
  }
  return rows;
}

export default function MetricsPanel({ text, loading, error, online, onRefresh, onExport }: MetricsPanelProps) {
  const rows = useMemo(() => parseMetrics(text), [text]);
  return (
    <section className="panel metrics-panel">
      <div className="log-head">
        <div>
          <h2>{t("Prometheus metrics")}</h2>
          <p className="hint">{t("No user-controlled labels. Scrape locally with Prometheus/Grafana, or export the raw text.")}</p>
        </div>
        <div className="row">
          <button type="button" className="ghost" disabled={!online || loading} onClick={onRefresh}>
            {loading ? t("Loading…") : t("Refresh metrics")}
          </button>
          <button type="button" className="ghost" disabled={!text} onClick={onExport}>{t("Download text")}</button>
        </div>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {rows.length ? (
        <div className="metrics-grid">
          {rows.map((row) => (
            <div className="metric-card" key={row.name} title={row.help}>
              <code>{row.name}</code>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      ) : <p className="muted">{t("Connect to the Hub, then refresh to see metrics.")}</p>}
    </section>
  );
}
