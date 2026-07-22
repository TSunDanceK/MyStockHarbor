// app/learn/icons.tsx
// Small inline SVG icon set for the /learn index cards. No external icon
// library — kept dependency-free and consistent with the rest of the site's
// inline-styled components. Each icon uses `currentColor` so the wrapping
// badge controls the tint per section (Basics/Indicators/Divergences/
// Fundamentals).

import type { SVGProps } from "react";

function IconBase(props: SVGProps<SVGSVGElement>) {
  const { children, ...rest } = props;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------------- Basics ---------------- */

export function SupportResistanceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" strokeDasharray="2.5 2.5" opacity={0.6} />
      <path d="M3 18h18" strokeDasharray="2.5 2.5" opacity={0.6} />
      <polyline points="4,14 8,9 12,15 16,8 20,13" />
    </IconBase>
  );
}

export function TrendUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <polyline points="3,17 9,11 13,15 21,5" />
      <polyline points="15,5 21,5 21,11" />
    </IconBase>
  );
}

export function TimeframesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 16,14" />
    </IconBase>
  );
}

/* ---------------- Indicators ---------------- */

export function AtrIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 3v18" />
      <polyline points="9,6 12,3 15,6" />
      <polyline points="9,18 12,21 15,18" />
      <path d="M8 9h8" />
      <path d="M8 15h8" />
    </IconBase>
  );
}

export function BollingerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 7c3-3 6 3 9 0s6-3 9 0" strokeDasharray="2.5 2.5" opacity={0.6} />
      <path d="M3 12c3-2 6 2 9 0s6-2 9 0" />
      <path d="M3 17c3-3 6 3 9 0s6-3 9 0" strokeDasharray="2.5 2.5" opacity={0.6} />
    </IconBase>
  );
}

export function EmaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 16c3 2 5-6 8-4s5 6 8 2" />
    </IconBase>
  );
}

export function MacdIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 8c4 4 8-6 12-3s4 5 6 2" />
      <path d="M3 12c4-3 8 5 12 2s4-4 6-1" />
      <line x1="3" y1="19" x2="21" y2="19" opacity={0.6} />
      <rect x="5" y="16.5" width="1.6" height="2.5" />
      <rect x="9.5" y="14.5" width="1.6" height="4.5" />
      <rect x="14" y="17" width="1.6" height="2" />
      <rect x="18.5" y="15.5" width="1.6" height="3.5" />
    </IconBase>
  );
}

export function MovingAveragesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M2 15c4-6 6 4 10-1s6-7 10-2" />
      <path d="M2 11c4 5 6-5 10 1s6 6 10 1" opacity={0.6} />
    </IconBase>
  );
}

export function RsiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 17a8 8 0 0 1 16 0" />
      <line x1="12" y1="17" x2="16" y2="10" />
      <circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function StochasticIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" opacity={0.6} />
      <path d="M5 15c2-2 3 2 5 0s3-6 5-3 3 5 5 2" />
    </IconBase>
  );
}

export function VolumeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="4" y="13" width="3" height="7" />
      <rect x="10.5" y="8" width="3" height="12" />
      <rect x="17" y="4" width="3" height="16" />
    </IconBase>
  );
}

export function VwapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 15c4-1 6-6 10-6s6 4 8 2" />
      <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2.5 2.5" opacity={0.6} />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/* ---------------- Divergencies ---------------- */

export function DivergenceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 14c4-2 6-8 9-9s6 3 9 1" />
      <path d="M3 6c4 2 6 6 9 7s6-1 9-3" strokeDasharray="2.5 2.5" opacity={0.6} />
    </IconBase>
  );
}

export function MacdDivergenceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 12c4-2 6-6 9-7s6 2 9 1" />
      <path d="M3 6c4 2 6 5 9 6s6-1 9-2" strokeDasharray="2.5 2.5" opacity={0.6} />
      <rect x="5" y="19" width="1.6" height="2" />
      <rect x="10" y="18" width="1.6" height="3" />
      <rect x="15" y="19" width="1.6" height="2" />
    </IconBase>
  );
}

/* ---------------- How to Read Financial Data ---------------- */

export function FinDataIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 6c-2-2-6-2-9-1v13c3-1 7-1 9 1 2-2 6-2 9-1V5c-3-1-7-1-9 1z" />
      <line x1="12" y1="6" x2="12" y2="19" />
    </IconBase>
  );
}

export function IncomeStatementIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <line x1="9" y1="14" x2="17" y2="14" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </IconBase>
  );
}

export function BalanceSheetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <line x1="12" y1="3" x2="12" y2="20" />
      <line x1="5" y1="7" x2="19" y2="7" />
      <path d="M5 7l-3 6a3 3 0 0 0 6 0z" />
      <path d="M19 7l-3 6a3 3 0 0 0 6 0z" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </IconBase>
  );
}

export function ValuationRatiosIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </IconBase>
  );
}

export function RedGreenFlagsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <line x1="5" y1="3" x2="5" y2="21" />
      <path d="M5 4h13l-3 4 3 4H5z" />
    </IconBase>
  );
}

/* ---------------- slug -> icon lookup ---------------- */

export const LESSON_ICONS: Record<
  string,
  (props: SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  "support-and-resistance": SupportResistanceIcon,
  "how-to-identify-stock-trends": TrendUpIcon,
  timeframes: TimeframesIcon,

  atr: AtrIcon,
  "bollinger-bands": BollingerIcon,
  ema20: EmaIcon,
  macd: MacdIcon,
  "moving-averages": MovingAveragesIcon,
  rsi: RsiIcon,
  stochastic: StochasticIcon,
  volume: VolumeIcon,
  vwap: VwapIcon,

  "rsi-divergence": DivergenceIcon,
  "macd-divergence": MacdDivergenceIcon,

  "how-to-read-financial-data": FinDataIcon,
  "income-statement": IncomeStatementIcon,
  "balance-sheet-and-cash-flow": BalanceSheetIcon,
  "valuation-and-key-ratios": ValuationRatiosIcon,
  "financial-red-flags-green-flags": RedGreenFlagsIcon,
};
