import { useEffect, useState } from "react";
import {
  loadQuickCommands,
  newCommandId,
  QUICK_COMMANDS_STORAGE_KEY,
  type CommandMode,
  type LineEnding,
  type QuickCommand,
} from "../commandUtils";
import { t } from "../i18n/index.ts";
import type { PushLog } from "./consoleLogStore.ts";

const MAX_QUICK_COMMANDS = 200;

/** Saved command editing and persistence, independent of connection and TX. */
export function useQuickCommands(pushLog: PushLog) {
  const [quickCommands, setQuickCommands] =
    useState<QuickCommand[]>(loadQuickCommands);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickMode, setQuickMode] = useState<CommandMode>("text");
  const [quickPayload, setQuickPayload] = useState("");
  const [quickLineEnding, setQuickLineEnding] = useState<LineEnding>("lf");
  useEffect(() => {
    try {
      localStorage.setItem(
        QUICK_COMMANDS_STORAGE_KEY,
        JSON.stringify(quickCommands),
      );
    } catch {
      // A private browsing context may deny localStorage. The editor still works in memory.
    }
  }, [quickCommands]);
  const resetQuickEditor = () => {
    setEditingCommandId(null);
    setQuickName("");
    setQuickMode("text");
    setQuickPayload("");
    setQuickLineEnding("lf");
  };
  const saveQuickCommand = () => {
    const name = quickName.trim();
    if (!name || !quickPayload.trim()) {
      pushLog({ kind: "err", text: t("A shortcut needs a name and content") });
      return;
    }
    const next: QuickCommand = {
      ...quickCommands.find((command) => command.id === editingCommandId),
      id: editingCommandId ?? newCommandId(),
      name,
      mode: quickMode,
      payload: quickPayload,
      lineEnding: quickMode === "text" ? quickLineEnding : "none",
    };
    setQuickCommands((previous) => {
      const withoutCurrent = previous.filter(
        (command) => command.id !== next.id,
      );
      return [next, ...withoutCurrent].slice(0, MAX_QUICK_COMMANDS);
    });
    pushLog({
      kind: "sys",
      text: t("{p0} shortcut: {p1}", {
        p0: String(editingCommandId ? t("Updated") : t("Saved")),
        p1: String(name),
      }),
    });
    resetQuickEditor();
  };
  const editQuickCommand = (command: QuickCommand) => {
    setEditingCommandId(command.id);
    setQuickName(command.name);
    setQuickMode(command.mode);
    setQuickPayload(command.payload);
    setQuickLineEnding(command.lineEnding);
  };
  const deleteQuickCommand = (command: QuickCommand) => {
    setQuickCommands((previous) =>
      previous.filter((item) => item.id !== command.id),
    );
    if (editingCommandId === command.id) resetQuickEditor();
    pushLog({
      kind: "sys",
      text: t("Shortcut deleted: {p0}", { p0: String(command.name) }),
    });
  };

  return {
    quickCommands,
    setQuickCommands,
    editingCommandId,
    quickName,
    setQuickName,
    quickMode,
    setQuickMode,
    quickPayload,
    setQuickPayload,
    quickLineEnding,
    setQuickLineEnding,
    resetQuickEditor,
    saveQuickCommand,
    editQuickCommand,
    deleteQuickCommand,
  };
}
