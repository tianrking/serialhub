import { useCallback, useEffect, useRef, useState } from "react";
import { getFormattingLocale, t } from "../i18n/index.ts";
import { ConsoleLogStore, type PushLog } from "./consoleLogStore.ts";
export function useConsoleLog() {
  const [store] = useState(() => new ConsoleLogStore());
  const [paused, updatePaused] = useState(false);
  const pausedRef = useRef(false);
  const setPaused = useCallback((value: boolean) => {
    pausedRef.current = value;
    updatePaused(value);
  }, []);
  const pushLog: PushLog = useCallback(
    (line) => {
      store.push({
        ...line,
        ts:
          line.ts ??
          new Date().toLocaleTimeString(getFormattingLocale(), {
            hour12: false,
          }),
        text:
          line.text.length > 4096
            ? t("{p0} … [display truncated]", { p0: line.text.slice(0, 4096) })
            : line.text,
        hex:
          line.hex && line.hex.length > 512
            ? `${line.hex.slice(0, 512)} …`
            : line.hex,
      });
    },
    [store],
  );
  useEffect(() => () => store.dispose(), [store]);
  return { store, paused, setPaused, pausedRef, pushLog };
}
