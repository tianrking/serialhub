/** Writes only after an explicit user action; never reads the user's clipboard. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Permission denial or HTTP LAN: try the user-gesture fallback. */
  }
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const input =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active
      : null;
  const caret = input
    ? {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      }
    : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  // A modal dialog makes the rest of the document inert. Keep the fallback in it.
  const parent = active?.closest("dialog[open]") ?? document.body;
  parent.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    field.remove();
    if (active instanceof HTMLElement && active.isConnected)
      active.focus({ preventScroll: true });
    if (input && caret && caret.start !== null && caret.end !== null) {
      try {
        input.setSelectionRange(
          caret.start,
          caret.end,
          caret.direction ?? undefined,
        );
      } catch {
        /* Unsupported input type. */
      }
    }
    if (
      selection &&
      ranges.length &&
      !(input && caret && caret.start !== null)
    ) {
      selection.removeAllRanges();
      for (const range of ranges)
        if (range.startContainer.isConnected && range.endContainer.isConnected)
          selection.addRange(range);
    }
  }
}
