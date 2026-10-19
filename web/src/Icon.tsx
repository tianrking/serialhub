type IconName = "terminal" | "activity" | "layers" | "book" | "shield" | "arrow" | "search";

const paths: Record<IconName, string> = {
  terminal: "M4 5h16v14H4z M8 9l3 3-3 3 M13 15h3",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  layers: "M12 3l10 6-10 6L2 9z M3 13l9 5 9-5 M3 17l9 5 9-5",
  book: "M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z M12 6v15",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
};

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
