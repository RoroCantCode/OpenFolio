/** Compact investment mark: ascending path on a rounded tile. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="openfolioBrandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#7c9cff" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="34" height="34" rx="11" fill="url(#openfolioBrandGrad)" />
      <path
        d="M10 26 L14 22 L18 24 L22 15 L26 18 L30 10"
        fill="none"
        stroke="#041016"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />
      <circle cx="30" cy="10" r="2.2" fill="#041016" opacity="0.92" />
      <path d="M10 28 L30 28" stroke="#041016" strokeWidth="1.2" strokeOpacity="0.35" strokeLinecap="round" />
    </svg>
  );
}
