/** SerialHub fan-out symbol. Geometry source: scripts/build-brand-assets.py. */
export default function BrandMark({ size = 24 }: { size?: number }) {
  return <svg className="brand-symbol" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M5 16h7m7-4 6-6h3m-8 10h8m-9 4 6 6h3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    <path fill="currentColor" fillRule="evenodd" d="M12 12h8v8h-8zm2 2v4h4v-4z" />
    <path fill="currentColor" d="M1 14h4v4H1zm26-10h4v4h-4zm0 10h4v4h-4zm0 10h4v4h-4z" />
  </svg>;
}
