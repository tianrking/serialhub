import { useEffect, useRef } from "react";
import { t } from "./i18n/index";
export default function ClipboardDialog({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    field.current?.focus();
    field.current?.select();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      className="workspace-dialog clipboard-dialog"
      ref={dialog}
      aria-label={t("Copy manually")}
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <h2>{t("Copy manually")}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          {t("Cancel")}
        </button>
      </header>
      <div className="workspace-dialog-body">
        <p>
          {t(
            "Clipboard access is unavailable. Select the text and press Ctrl+C or Command+C.",
          )}
        </p>
        <textarea
          ref={field}
          aria-label={t("Text to copy")}
          value={text}
          readOnly
          rows={8}
          spellCheck={false}
        />
        <button
          type="button"
          className="ghost"
          onClick={() => {
            field.current?.focus();
            field.current?.select();
          }}
        >
          {t("Select text")}
        </button>
      </div>
    </dialog>
  );
}
