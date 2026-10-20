import { t, type MessageKey } from "./i18n/index";
import useClipboard from "./useClipboard";
export default function CopyButton({
  text,
  label = "Copy",
  disabled = false,
}: {
  text: string | (() => string);
  label?: MessageKey;
  disabled?: boolean;
}) {
  const clipboard = useClipboard();
  return (
    <span className="copy-control">
      <button
        type="button"
        className="ghost"
        disabled={disabled}
        onClick={() =>
          void clipboard.copy(typeof text === "function" ? text() : text)
        }
      >
        {t(label)}
      </button>
      <span className="copy-feedback" role="status">
        {clipboard.feedback}
      </span>
      {clipboard.dialog}
    </span>
  );
}
