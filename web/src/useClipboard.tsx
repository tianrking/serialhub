import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { writeClipboard } from "./clipboard";
import ClipboardDialog from "./ClipboardDialog";
import { t } from "./i18n/index";
export default function useClipboard() {
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 3500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const copy = useCallback(async (text: string) => {
    const id = ++request.current;
    const ok = await writeClipboard(text);
    if (!mounted.current || id !== request.current) return;
    if (ok) {
      setManual(null);
      setFeedback(t("Copied"));
    } else {
      setManual(text);
      setFeedback(t("Copy manually"));
    }
  }, []);
  return {
    copy,
    feedback,
    dialog:
      manual !== null
        ? createPortal(
            <ClipboardDialog text={manual} onClose={() => setManual(null)} />,
            document.body,
          )
        : null,
  };
}
