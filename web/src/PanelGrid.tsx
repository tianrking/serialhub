import { useRef, useState, type ReactNode } from "react";
import { resizeTracks } from "./panelLayout";
import { t } from "./i18n/index";

/** Pointer capture keeps a drag scoped to its divider; no document listeners. */
export default function PanelGrid({
  rows,
  columns,
  children,
}: {
  rows: number;
  columns: number;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<{
    shape: string;
    x: number[];
    y: number[];
  }>({ shape: "", x: [], y: [] });
  const shape = `${rows}:${columns}`;
  const x =
    sizes.shape === shape ? sizes.x : (Array(columns).fill(1) as number[]);
  const y = sizes.shape === shape ? sizes.y : (Array(rows).fill(1) as number[]);
  const drag = useRef<{
    axis: "x" | "y";
    index: number;
    start: number;
    tracks: number[];
    scale: number;
    shape: string;
    minimum: number;
  } | null>(null);
  const assign = (axis: "x" | "y", tracks: number[]) =>
    setSizes({
      shape,
      x: axis === "x" ? tracks : x,
      y: axis === "y" ? tracks : y,
    });
  const dividers = (axis: "x" | "y", tracks: number[]) => {
    const total = tracks.reduce((sum, n) => sum + n, 0);
    return tracks.slice(0, -1).map((value, index) => {
      const before = tracks.slice(0, index).reduce((sum, n) => sum + n, 0);
      return (
        <div
          key={`${axis}-${index}`}
          className={`panel-divider panel-divider-${axis}`}
          role="separator"
          tabIndex={0}
          aria-label={t(axis === "x" ? "Resize columns" : "Resize rows")}
          aria-orientation={axis === "x" ? "vertical" : "horizontal"}
          aria-valuemin={15}
          aria-valuemax={85}
          aria-valuenow={Math.round(
            (value / (value + tracks[index + 1])) * 100,
          )}
          style={
            axis === "x"
              ? { insetInlineStart: `${((before + value) / total) * 100}%` }
              : { top: `${((before + value) / total) * 100}%` }
          }
          onDoubleClick={() =>
            assign(
              axis,
              tracks.map(() => 1),
            )
          }
          onPointerDown={(e) => {
            if (e.button !== 0 || !container.current) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const box = container.current.getBoundingClientRect();
            const direction =
              axis === "x" &&
              getComputedStyle(container.current).direction === "rtl"
                ? -1
                : 1;
            drag.current = {
              axis,
              index,
              shape,
              minimum:
                (total * (axis === "x" ? 220 : 150)) /
                Math.max(
                  1,
                  (axis === "x" ? box.width : box.height) -
                    4 * (tracks.length - 1),
                ),
              start: axis === "x" ? e.clientX : e.clientY,
              tracks,
              scale:
                (direction * total) /
                Math.max(1, axis === "x" ? box.width : box.height),
            };
          }}
          onPointerMove={(e) => {
            const current = drag.current;
            if (
              !current ||
              current.shape !== shape ||
              !e.currentTarget.hasPointerCapture(e.pointerId)
            )
              return;
            const delta =
              ((axis === "x" ? e.clientX : e.clientY) - current.start) *
              current.scale;
            assign(
              axis,
              resizeTracks(
                current.tracks,
                current.index,
                delta,
                current.minimum,
              ),
            );
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            const rtl =
              axis === "x" &&
              container.current &&
              getComputedStyle(container.current).direction === "rtl";
            const previous =
              axis === "x" ? (rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
            const next =
              axis === "x" ? (rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
            if (e.key === "Home") {
              e.preventDefault();
              assign(
                axis,
                tracks.map(() => 1),
              );
            }
            if (e.key === previous || e.key === next) {
              e.preventDefault();
              assign(
                axis,
                resizeTracks(
                  tracks,
                  index,
                  (e.key === next ? 1 : -1) * total * 0.025,
                  (total * (axis === "x" ? 220 : 150)) /
                    Math.max(
                      1,
                      (axis === "x"
                        ? (container.current?.clientWidth ?? 1)
                        : (container.current?.clientHeight ?? 1)) -
                        4 * (tracks.length - 1),
                    ),
                ),
              );
            }
          }}
        />
      );
    });
  };
  return (
    <div className="panel-grid-viewport">
      <div
        className="multi-grid"
        ref={container}
        data-rows={rows}
        data-columns={columns}
        style={{
          minWidth: columns * 220 + (columns - 1) * 4,
          minHeight: rows * 150 + (rows - 1) * 4,
          gridTemplateColumns: x.map((n) => `minmax(220px, ${n}fr)`).join(" "),
          gridTemplateRows: y.map((n) => `minmax(150px, ${n}fr)`).join(" "),
        }}
      >
        {children}
        <div className="panel-dividers">
          {dividers("x", x)}
          {dividers("y", y)}
        </div>
      </div>
    </div>
  );
}
