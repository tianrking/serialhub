import { t } from "./i18n/index.ts";
import { useRef, type ReactNode } from "react";

/** Native modal keeps keyboard focus and device actions behind the dialog inert. */
export default function WorkspaceDialog({ label, className = "", children }: {
  label: string; className?: string; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div className={`workspace-dialog-trigger ${className}`}>
    <button type="button" className="ghost" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog className="workspace-dialog" aria-label={label} ref={dialog}>
      <header><h2>{label}</h2><button type="button" className="ghost" aria-label={t("Close {p0}", { p0: String(label) })} onClick={() => dialog.current?.close()}>{t("Close ×")}</button></header>
      <div className="workspace-dialog-body">{children}</div>
    </dialog>
  </div>;
}
