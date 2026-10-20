export type PanelLayout = { mode: "auto" | "columns" | "rows"; count: number };
export const defaultPanelLayout: PanelLayout = { mode: "auto", count: 2 };

export function readPanelLayout(value: string | null): PanelLayout {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (
      parsed &&
      ["auto", "columns", "rows"].includes(parsed.mode) &&
      Number.isSafeInteger(parsed.count) &&
      parsed.count > 0
    )
      return { mode: parsed.mode, count: parsed.count };
  } catch {
    /* Ignore an obsolete or damaged preference. */
  }
  return defaultPanelLayout;
}

export function panelGrid(count: number, layout: PanelLayout, narrow = false) {
  const size = Math.max(1, count);
  const dimension = Math.min(size, Math.max(1, Math.floor(layout.count) || 1));
  if (layout.mode === "rows")
    return { rows: dimension, columns: Math.ceil(size / dimension) };
  const columns =
    layout.mode === "columns"
      ? dimension
      : narrow
        ? 1
        : Math.ceil(Math.sqrt(size));
  return { rows: Math.ceil(size / columns), columns };
}

/** Resize a neighboring pair without disturbing the other tracks. */
export function resizeTracks(
  tracks: number[],
  boundary: number,
  delta: number,
  minimum = 0,
) {
  if (boundary < 0 || boundary + 1 >= tracks.length || !Number.isFinite(delta))
    return tracks;
  const result = [...tracks];
  const pair = tracks[boundary] + tracks[boundary + 1];
  const lower = Math.min(pair / 2, Math.max(pair * 0.15, minimum));
  const first = Math.max(
    lower,
    Math.min(pair - lower, tracks[boundary] + delta),
  );
  result[boundary] = first;
  result[boundary + 1] = pair - first;
  return result;
}
