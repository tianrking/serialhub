import CopyButton from "./Clipboard";
import { fullHex } from "./serialTools";
import { t, getFormattingLocale } from "./i18n/index.ts";
import { useMemo } from "react";
import { bytesToHex } from "./api/wsStream";
import type { ProtocolFrame, StreamProtocol } from "./protocolUtils";
import { protocolLabel } from "./protocolUtils";

type ProtocolInspectorPanelProps = {
  protocol: StreamProtocol;
  frames: ProtocolFrame[];
  onClear: () => void;
};

export default function ProtocolInspectorPanel({
  protocol,
  frames,
  onClear,
}: ProtocolInspectorPanelProps) {
  const recent = useMemo(() => frames.slice(-100), [frames]);
  if (protocol === "raw" || protocol === "firewater" || protocol === "justfloat" || protocol === "binary" || protocol === "image") return null;

  return (
    <section className="panel protocol-inspector">
      <div className="log-head">
        <div>
          <h2>{t("Protocol inspector")}</h2>
          <p className="hint">
            {protocolLabel(protocol)} · {frames.length.toLocaleString(getFormattingLocale())} {t("frames · parsed locally; raw RX bytes are unchanged")}</p>
        </div>
        <button type="button" className="ghost" onClick={onClear}>{t("Clear analysis")}</button>
      </div>
      {recent.length === 0 ? (
        <p className="muted">{t("Waiting for complete frames. Partial WebSocket frames remain in a bounded buffer.")}</p>
      ) : (
        <div className="analysis-list">
          {recent.map((frame, index) => (
            <article className="analysis-row" key={`${index}-${frame.summary}`}>
              <div className="analysis-head">
                <span className={`tag ${frame.valid === false ? "analysis-invalid" : "analysis-valid"}`}>
                  {frame.valid === false ? "INVALID" : "FRAME"}
                </span>
                <strong>{frame.summary}</strong><CopyButton label="Copy HEX" text={() => fullHex(frame.bytes)} />
              </div>
              <div className="analysis-body">
                <code>{bytesToHex(frame.bytes, 256)}</code>
                {frame.fields ? (
                  <span className="analysis-fields">
                    {Object.entries(frame.fields).map(([key, value]) => (
                      <span className="tag" key={key}>
                        {key}={String(value)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
