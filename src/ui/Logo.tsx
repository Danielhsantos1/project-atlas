/** Marca do PROJECT ATLAS: prisma isométrico em linhas. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 3 28 10v12L16 29 4 22V10z" stroke="#2f80ff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 3v12m0 0 12-5M16 15 4 10m12 5v14" stroke="#2f80ff" strokeWidth="1.4" strokeLinejoin="round" opacity=".55" />
      <circle cx="16" cy="15" r="2.2" fill="#e8ebf0" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-none">
        <div className="text-[13px] font-semibold tracking-[0.18em]">ATLAS</div>
        <div className="mt-0.5 text-[9.5px] tracking-[0.14em] text-fg-subtle">PROJECT · AEC</div>
      </div>
    </div>
  );
}
