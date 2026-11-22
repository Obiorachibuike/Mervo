import { cn } from "@/lib/utils";

/**
 * MERVO brand mark — a sculptural arch cut out of a solid block, echoing a
 * colonnade: two pillars, a lintel and a keystone notch. Monochrome by design.
 */
export function MervoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("h-8 w-8", className)} role="img" aria-label="MERVO mark">
      <rect width="40" height="40" rx="9" fill={inverted ? "#FFFFFF" : "#101418"} />
      <path d="M9 30V13.2c0-1.1.9-2 2-2h2.6c.7 0 1.3.35 1.66.94L20 20.6l4.74-8.46c.36-.59.96-.94 1.66-.94H29c1.1 0 2 .9 2 2V30h-5.1V19.3l-3.5 6.24a2.7 2.7 0 0 1-4.8 0l-3.5-6.24V30H9Z" fill={inverted ? "#101418" : "#FFFFFF"} />
      <circle cx="20" cy="33.6" r="1.9" fill="#39FF14" />
    </svg>
  );
}

export function MervoLogo({ className, showTag = false, inverted = false }: { className?: string; showTag?: boolean; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <MervoMark inverted={inverted} className="h-8 w-8" />
      <span className="flex flex-col leading-none">
        <span className={cn("text-[19px] font-extrabold tracking-[-0.045em]", inverted ? "text-white" : "text-[var(--fg)]")}>MERVO</span>
        {showTag ? (
          <span className={cn("mt-1 text-[9px] font-medium uppercase tracking-[0.18em]", inverted ? "text-white/60" : "muted")}>Business OS</span>
        ) : null}
      </span>
    </span>
  );
}
