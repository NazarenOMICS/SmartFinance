const SIZE_STYLES = {
  sm: "h-11 w-11 rounded-2xl",
  md: "h-16 w-16 rounded-[24px]",
  lg: "h-24 w-24 rounded-[30px]",
};

export default function BrandMark({ size = "md", className = "" }) {
  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_rgba(255,255,255,0.58)_38%,_rgba(83,74,183,0.12)_100%),linear-gradient(135deg,_rgba(83,74,183,0.24),_rgba(29,158,117,0.18))] shadow-[0_18px_45px_rgba(83,74,183,0.16)] ring-1 ring-white/80 ${SIZE_STYLES[size] || SIZE_STYLES.md} ${className}`}
    >
      <div className="absolute inset-[10%] rounded-[inherit] bg-[radial-gradient(circle_at_30%_30%,_rgba(83,74,183,0.18),_transparent_52%),radial-gradient(circle_at_75%_75%,_rgba(29,158,117,0.22),_transparent_46%)]" />
      <svg viewBox="0 0 64 64" className="relative h-[76%] w-[76%]" aria-hidden="true">
        <defs>
          <linearGradient id="sf-mark-stroke" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#534AB7" />
            <stop offset="100%" stopColor="#1D9E75" />
          </linearGradient>
        </defs>
        <path
          d="M14 42C18 34 24 28 31 24C36 21 42 19 50 18"
          fill="none"
          stroke="url(#sf-mark-stroke)"
          strokeLinecap="round"
          strokeWidth="4.5"
        />
        <path
          d="M20 46C24 40 31 35 40 32C45 30 50 29 54 28"
          fill="none"
          stroke="#161933"
          strokeLinecap="round"
          strokeOpacity="0.9"
          strokeWidth="2.75"
        />
        <circle cx="18" cy="44" r="4.2" fill="#534AB7" />
        <circle cx="32" cy="24" r="3.3" fill="#1D9E75" />
        <circle cx="50" cy="18" r="4.2" fill="#D85A30" />
        <path
          d="M18 13H30"
          fill="none"
          stroke="#161933"
          strokeLinecap="round"
          strokeOpacity="0.8"
          strokeWidth="2.3"
        />
        <path
          d="M18 19H26"
          fill="none"
          stroke="#161933"
          strokeLinecap="round"
          strokeOpacity="0.45"
          strokeWidth="2.3"
        />
      </svg>
    </div>
  );
}
