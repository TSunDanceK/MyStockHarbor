"use client";

import { useEffect, useRef, useState } from "react";

type TimeframeOption<T extends string> = { key: T; label: string };

// Single "Timeframes" dropdown pill replacing a row of separate
// All/Macro/Weekly/Daily/Short-term buttons on the chart-pattern plays
// pages. Closes on outside click or after picking an option. Generic over
// the timeframe key type so each play page can pass its own union
// ("ALL" | "M" | "W" | "D" | "ST" for triangles, no "ST" for bull flags).
export default function TimeframeFilterDropdown<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: TimeframeOption<T>[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = options.find((option) => option.key === value);

  return (
    <div ref={rootRef} className="timeframeDropdown">
      <button
        type="button"
        className="timeframeDropdownBtn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="timeframeDropdownLabel">Timeframes</span>
        <span className="timeframeDropdownCurrent">
          {current?.label ?? ""}
          <span
            className="timeframeDropdownChevron"
            aria-hidden="true"
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          >
            ▾
          </span>
        </span>
      </button>

      {open ? (
        <div className="timeframeDropdownPanel" role="listbox">
          {options.map((option) => {
            const active = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "timeframeDropdownOption active" : "timeframeDropdownOption"}
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <style>{`
        .timeframeDropdown { position: relative; display: inline-block; }
        .timeframeDropdownBtn {
          display: inline-flex; align-items: center; gap: 10px;
          padding: 10px 15px; border-radius: 999px;
          border: 1.5px solid rgba(96,165,250,0.55);
          background: linear-gradient(135deg, rgba(59,130,246,0.24), rgba(37,99,235,0.13));
          color: #eff6ff; font-size: 13px; font-weight: 900; cursor: pointer;
          box-shadow: 0 6px 16px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .timeframeDropdownLabel { color: #93c5fd; text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; font-weight: 950; }
        .timeframeDropdownCurrent { display: inline-flex; align-items: center; gap: 6px; color: #f8fafc; }
        .timeframeDropdownChevron { color: #93c5fd; font-size: 11px; transition: transform 140ms ease; }
        .timeframeDropdownPanel {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
          min-width: 190px; display: flex; flex-direction: column; gap: 2px;
          padding: 6px; border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: linear-gradient(180deg, rgba(12,18,30,0.99), rgba(7,11,20,1));
          box-shadow: 0 18px 40px rgba(0,0,0,0.45);
        }
        .timeframeDropdownOption {
          text-align: left; padding: 9px 11px; border-radius: 10px;
          border: 1px solid transparent; background: transparent;
          color: rgba(226,232,240,0.85); font-size: 13px; font-weight: 800; cursor: pointer;
        }
        .timeframeDropdownOption:hover { background: rgba(255,255,255,0.05); color: #f8fafc; }
        .timeframeDropdownOption.active { background: rgba(37,99,235,0.24); border-color: rgba(96,165,250,0.55); color: #dbeafe; }
      `}</style>
    </div>
  );
}
