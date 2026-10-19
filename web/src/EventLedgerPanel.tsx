import { t, getFormattingLocale, translate, type Locale } from "./i18n/index.ts";
import { useLocale } from "./i18n/useLocale";
import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  LedgerBytesPayload,
  LedgerEvent,
  LedgerEventType,
  LedgerStatus,
} from "./api/types";

const eventTypeOptions = (): ReadonlyArray<{
  type: LedgerEventType;
  label: string;
}> => [
  { type: "rx", label: "RX" },
  { type: "tx", label: "TX" },
  { type: "connection", label: t("Connection") },
  { type: "control", label: t("Control") },
  { type: "gap", label: t("Gap") },
];

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_SAFE_DECODE_BYTES = 1024 * 1024;
const PREVIEW_BYTES = 96;
const SENSITIVE_CONTROL_NAME =
  /(?:authorization|bearer|lease[ _-]?token|api[ _-]?token|password|secret)/i;

type EventTypeSelection = Record<LedgerEventType, boolean>;

const INITIAL_SELECTION: EventTypeSelection = {
  rx: true,
  tx: true,
  connection: true,
  control: true,
  gap: true,
};

interface EventLedgerPanelProps {
  status: LedgerStatus | null;
  events: LedgerEvent[];
  loading: boolean;
  error: string | null;
  online: boolean;
  onRefresh: () => void;
  onExport: () => void;
}

interface DecodedPreview {
  hex: string;
  text: string;
  truncated: boolean;
  error?: string;
}

function safeBase64Preview(payload: LedgerBytesPayload, locale: Locale): DecodedPreview {
  const { data_base64: encoded, len } = payload;
  if (!Number.isSafeInteger(len) || len < 0) {
    return { hex: "", text: "", truncated: false, error: translate(locale, "Invalid byte length") };
  }
  if (len > MAX_SAFE_DECODE_BYTES) {
    return {
      hex: "",
      text: "",
      truncated: true,
      error: translate(locale, "Content exceeds the safe preview limit ({p0})", { p0: String(formatBytes(len)) }),
    };
  }
  if (encoded.length > Math.ceil((MAX_SAFE_DECODE_BYTES * 4) / 3) + 4) {
    return { hex: "", text: "", truncated: true, error: translate(locale, "Base64 content too large") };
  }
  if (encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    return { hex: "", text: "", truncated: false, error: translate(locale, "Invalid Base64 format") };
  }

  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const estimatedLength = encoded.length === 0 ? 0 : (encoded.length / 4) * 3 - padding;
  if (estimatedLength !== len) {
    return { hex: "", text: "", truncated: false, error: translate(locale, "Base64 length differs from the declared length") };
  }

  try {
    const decoded = atob(encoded);
    if (decoded.length !== len) {
      return { hex: "", text: "", truncated: false, error: translate(locale, "Decoded length differs from the declared length") };
    }
    const previewLength = Math.min(decoded.length, PREVIEW_BYTES);
    const bytes = new Uint8Array(previewLength);
    for (let index = 0; index < previewLength; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    const truncated = decoded.length > previewLength;
    const suffix = truncated ? " …" : "";
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    const text = visibleUtf8(bytes);
    return { hex: `${hex}${suffix}`, text: `${text}${suffix}`, truncated };
  } catch {
    return { hex: "", text: "", truncated: false, error: translate(locale, "Base64 decoding failed") };
  }
}

function eventBytes(event: LedgerEvent): LedgerBytesPayload[] {
  if (event.type === "rx" || event.type === "tx") return [event.payload];
  if (event.type === "gap" && event.payload.bytes) return [event.payload.bytes];
  return [];
}

function eventContainsHex(event: LedgerEvent, input: string): boolean {
  const needle = input.replace(/0x/gi, "").replace(/[\s,;:_-]+/g, "").toLowerCase();
  if (!needle || !/^[0-9a-f]+$/.test(needle) || needle.length % 2 !== 0) return false;
  return eventBytes(event).some((payload) => {
    if (payload.len > MAX_SAFE_DECODE_BYTES || payload.data_base64.length % 4 !== 0) return false;
    try {
      const decoded = atob(payload.data_base64);
      const hex = Array.from(decoded, (character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");
      return hex.includes(needle);
    } catch {
      return false;
    }
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(getFormattingLocale(), { hour12: false });
}

function visibleUtf8(bytes: Uint8Array): string {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let visible = "";
  for (const character of decoded) {
    if (character === "\r") {
      visible += "\\r";
    } else if (character === "\n") {
      visible += "\\n";
    } else if (character === "\t") {
      visible += "\\t";
    } else {
      const codePoint = character.codePointAt(0) ?? 0;
      visible += codePoint < 32 || codePoint === 127 ? "·" : character;
    }
  }
  return visible;
}

const BytesPreview = memo(function BytesPreview({ payload }: { payload: LedgerBytesPayload }) {
  const locale = useLocale();
  const preview = useMemo(() => safeBase64Preview(payload, locale), [payload, locale]);
  if (preview.error) {
    return <span className="event-payload-error">{preview.error}</span>;
  }
  return (
    <span className="event-bytes">
      <span className="event-text">{preview.text || t("(empty)")}</span>
      <span className="event-hex">{preview.hex || "(0 B)"}</span>
      <span className="event-length">
        {formatBytes(payload.len)}{preview.truncated ? t(", preview only") : ""}
      </span>
    </span>
  );
});

function eventDetails(event: LedgerEvent): ReactNode {
  switch (event.type) {
    case "rx":
      return <BytesPreview payload={event.payload} />;
    case "tx":
      return (
        <>
          <span className="event-meta-line">
            actor <strong>{event.payload.actor}</strong>
            {event.payload.client_id ? ` · client ${event.payload.client_id}` : ""}
          </span>
          <BytesPreview payload={event.payload} />
        </>
      );
    case "connection":
      return (
        <span className="event-meta-line">
          <strong>{event.payload.state}</strong> · {event.payload.path} @ {event.payload.baud}
          {event.payload.detail ? ` · ${event.payload.detail}` : ""}
        </span>
      );
    case "control": {
      const value = SENSITIVE_CONTROL_NAME.test(event.payload.name)
        ? t("(sensitive value hidden)")
        : event.payload.value;
      return (
        <span className="event-meta-line">
          <strong>{event.payload.name}</strong>
          {value ? ` = ${value}` : ""}
          {event.payload.actor ? ` · actor ${event.payload.actor}` : ""}
        </span>
      );
    }
    case "gap": {
      const clientIds = event.payload.client_ids ?? [];
      const clients = clientIds.length
        ? ` · clients ${clientIds.slice(0, 5).join(", ")}${clientIds.length > 5 ? " …" : ""}`
        : "";
      return (
        <>
          <span className="event-meta-line">
            <strong>{event.payload.scope}</strong> / {event.payload.certainty} · {event.payload.reason}
            {event.payload.actor ? ` · actor ${event.payload.actor}` : ""}
            {clients}
          </span>
          {event.payload.bytes ? <BytesPreview payload={event.payload.bytes} /> : null}
        </>
      );
    }
  }
}

const LedgerEventRow = memo(function LedgerEventRow({ event }: { event: LedgerEvent }) {
  useLocale();
  return (
    <article className={`event-row ${event.type}`}>
      <div className="event-row-head">
        <span className={`event-kind ${event.type}`}>{event.type.toUpperCase()}</span>
        <strong>#{event.seq.toLocaleString(getFormattingLocale())}</strong>
        <span>{formatTimestamp(event.ts_utc)}</span>
        <span>epoch {event.connection_epoch}</span>
      </div>
      <div className="event-row-body">{eventDetails(event)}</div>
    </article>
  );
});

export default function EventLedgerPanel({
  status,
  events,
  loading,
  error,
  online,
  onRefresh,
  onExport,
}: EventLedgerPanelProps) {
  const [selected, setSelected] = useState<EventTypeSelection>(() => ({
    ...INITIAL_SELECTION,
  }));
  const [actor, setActor] = useState("");
  const [epoch, setEpoch] = useState("");
  const [containsHex, setContainsHex] = useState("");
  const visibleEvents = useMemo(
    () => events.filter((event) => {
      if (!selected[event.type]) return false;
      if (actor.trim()) {
        const actorText = "actor" in event.payload ? event.payload.actor ?? "" : "";
        if (!actorText.toLowerCase().includes(actor.trim().toLowerCase())) return false;
      }
      if (epoch.trim() && String(event.connection_epoch) !== epoch.trim()) return false;
      if (containsHex.trim()) {
        if (!eventContainsHex(event, containsHex.trim())) return false;
      }
      return true;
    }),
    [actor, containsHex, epoch, events, selected],
  );

  return (
    <section className="panel ledger-panel">
      <div className="ledger-head">
        <div>
          <h2>{t("Event ledger (read-only)")}</h2>
          <p className="hint">{t("Trace device traffic and operations. Live output is in the console.")}</p>
        </div>
        <button
          type="button"
          className="ghost"
          disabled={!online || loading}
          onClick={onRefresh}
        >
          {loading ? t("Loading…") : t("Refresh events")}
        </button>
        <button type="button" className="ghost" disabled={!online} onClick={onExport}>{t("Export NDJSON")}</button>
      </div>

      {status ? (
        <dl className="ledger-summary">
          <div>
            <dt>{t("Persistence")}</dt>
            <dd>
              <span className={`tag persistence-${status.persistence}`}>{status.persistence}</span>
              {status.sealed ? " · sealed" : ""}
            </dd>
          </div>
          <div>
            <dt>{t("Session")}</dt>
            <dd title={status.session_id}>{status.session_id}</dd>
          </div>
          <div>
            <dt>{t("Sequence")}</dt>
            <dd>
              {status.oldest_available_seq ?? "—"} → {status.newest_seq}
            </dd>
          </div>
          <div>
            <dt>{t("Retained")}</dt>
            <dd>
              {status.retained_events.toLocaleString(getFormattingLocale())} {t("events ·")} {formatBytes(status.retained_bytes)}
            </dd>
          </div>
          <div>
            <dt>{t("Evicted")}</dt>
            <dd>{status.evicted_events.toLocaleString(getFormattingLocale())}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">{t("Ledger status has not been loaded.")}</p>
      )}

      {status?.persistence_error ? (
        <p className="error" role="status">{t("Persistence degraded:")} {status.persistence_error}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset className="event-filters">
        <legend>{t("Event types")}</legend>
        {eventTypeOptions().map(({ type, label }) => (
          <label className="check" key={type}>
            <input
              type="checkbox"
              checked={selected[type]}
              onChange={(event) =>
                setSelected((current) => ({ ...current, [type]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="event-query-filters">
        <label>{t("Actor")} <input value={actor} onChange={(event) => setActor(event.target.value)} placeholder={t("e.g. web-ui")} />
        </label>
        <label>{t("Epoch")} <input value={epoch} onChange={(event) => setEpoch(event.target.value)} inputMode="numeric" placeholder={t("All")} />
        </label>
        <label>{t("Hex / evidence")} <input dir="ltr" value={containsHex} onChange={(event) => setContainsHex(event.target.value)} placeholder={t("e.g. 55 aa")} />
        </label>
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            setActor("");
            setEpoch("");
            setContainsHex("");
          }}
        >{t("Clear filters")}</button>
      </div>

      <div className="event-list-meta" aria-live="polite">{t("Showing")} {visibleEvents.length} / {events.length} {t("recent events")}</div>
      <div className="event-list">
        {visibleEvents.length ? (
          visibleEvents.map((event) => (
            <LedgerEventRow key={`${event.session_id}-${event.seq}`} event={event} />
          ))
        ) : (
          <div className="muted event-empty">
            {loading ? t("Reading…") : t("No events match the current filters.")}
          </div>
        )}
      </div>
    </section>
  );
}
