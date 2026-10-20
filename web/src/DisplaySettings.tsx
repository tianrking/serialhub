import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_DISPLAY, getDisplayPreferences, setDisplayPreferences, subscribeDisplay } from "./displayPreferences";
import { t } from "./i18n/index";
import { useLocale } from "./i18n/useLocale";

export default function DisplaySettings() {
  useLocale();
  const [open, setOpen] = useState(false);
  return <><button type="button" className="display-settings-button ghost" aria-label={t("Text size")} title={t("Text size")} aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">Aa</span></button>
    {open && createPortal(<DisplayDialog onClose={() => setOpen(false)} />, document.body)}</>;
}
function DisplayDialog({ onClose }: { onClose: () => void }) {
  useLocale();
  const preferences = useSyncExternalStore(subscribeDisplay, getDisplayPreferences);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="workspace-dialog display-dialog" aria-label={t("Text size")} ref={dialog} onClose={onClose} onCancel={onClose}>
    <header><h2>{t("Text size")}</h2><button type="button" className="ghost" onClick={onClose}>{t("Close ×")}</button></header>
    <div className="workspace-dialog-body">
      <label>{t("Interface text size")}<span className="display-range"><input type="range" min={80} max={160} step={10} value={preferences.uiScale} aria-label={t("Interface text size")} onChange={event => setDisplayPreferences({ ...preferences, uiScale: Number(event.target.value) })} /><output dir="ltr">{preferences.uiScale}%</output></span></label>
      <label>{t("Serial log font size")}<span className="display-range"><input type="range" min={10} max={28} step={1} value={preferences.logSize} aria-label={t("Serial log font size")} onChange={event => setDisplayPreferences({ ...preferences, logSize: Number(event.target.value) })} /><output dir="ltr">{preferences.logSize} px</output></span></label>
      <p>{t("Changes apply immediately to all workspaces. Saved in this browser for this address when storage is available.")}</p>
      <div className="display-preview"><span>{t("Interface preview")}</span><pre dir="ltr">12:34:56 RX  AT+STATUS → OK  25°C</pre></div>
      <p>{t("Log size also applies to the send editor. Plot labels scale with the chart. Browser zoom remains available.")}</p>
      <button type="button" className="ghost" onClick={() => setDisplayPreferences(DEFAULT_DISPLAY)}>{t("Reset text size")}</button>
    </div>
  </dialog>;
}
