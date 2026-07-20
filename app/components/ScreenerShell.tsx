"use client";

import type { ReactNode } from "react";
import ScreenerNav from "@/app/components/ScreenerNav";
import HowToCollapse from "@/app/components/HowToCollapse";
import { WatermarkVisibilityProvider, HideWatermarksBar } from "@/app/components/WatermarkVisibility";

type Tone = "green" | "yellow" | "orange" | "red" | "blue";

function toneColour(tone: Tone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#facc15";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "#60a5fa";
}

function toneBorder(tone: Tone) {
  if (tone === "green") return "rgba(34,197,94,0.32)";
  if (tone === "yellow") return "rgba(250,204,21,0.32)";
  if (tone === "orange") return "rgba(251,146,60,0.32)";
  if (tone === "red") return "rgba(239,68,68,0.32)";
  return "rgba(96,165,250,0.32)";
}

function toneBackground(tone: Tone) {
  if (tone === "green") return "linear-gradient(180deg, rgba(8,24,18,0.96), rgba(6,12,18,0.98))";
  if (tone === "yellow") return "linear-gradient(180deg, rgba(28,24,8,0.96), rgba(8,12,18,0.98))";
  if (tone === "orange") return "linear-gradient(180deg, rgba(32,20,8,0.96), rgba(8,12,18,0.98))";
  if (tone === "red") return "linear-gradient(180deg, rgba(32,10,14,0.96), rgba(8,12,18,0.98))";
  return "linear-gradient(180deg, rgba(8,16,32,0.96), rgba(6,10,18,0.98))";
}

export default function ScreenerShell({
  currentHref,
  tone = "blue",
  eyebrow,
  title,
  description,
  explainerTitle,
  explainerBody,
  footer,
  children,
}: {
  currentHref: string;
  tone?: Tone;
  eyebrow: string;
  title: string;
  description: string;
  explainerTitle?: string;
  explainerBody?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WatermarkVisibilityProvider>
      <main className="screenerShellPage">
        <style>{`
        .screenerShellPage { min-height: 100vh; background: radial-gradient(circle at 12% 0%, rgba(59,130,246,0.16), transparent 30%), radial-gradient(circle at 92% 4%, rgba(34,197,94,0.08), transparent 28%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .resultWrap { max-width: 1360px; margin: 0 auto; padding: 26px 18px 58px; }
        .resultShell { display: grid; grid-template-columns: 288px minmax(0, 1fr); gap: 22px; align-items: start; }
        .resultMain { min-width: 0; }
        .hero { border: 1px solid ${toneBorder(tone)}; border-radius: 28px; padding: 22px; background: ${toneBackground(tone)}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.045), 0 18px 42px rgba(0,0,0,0.26); }
        .eyebrow { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid ${toneBorder(tone)}; background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
        .hero h1 { margin: 12px 0 0; font-size: 44px; line-height: 1.03; letter-spacing: -0.055em; }
        .hero > p { margin: 10px 0 0; max-width: 820px; color: rgba(226,232,240,0.78); font-size: 16px; line-height: 1.65; }
        .heroHowTo { margin-top: 16px; padding: 14px 16px; border-radius: 16px; border: 1px solid rgba(59,130,246,0.18); background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(8,13,22,0.6)); }
        .heroHowToToggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; padding: 0; margin: 0; cursor: pointer; font: inherit; text-align: left; color: inherit; }
        .heroHowToLabel { display: block; font-size: 11px; font-weight: 950; letter-spacing: 0.1em; text-transform: uppercase; color: #93c5fd; }
        .heroHowToChevron { flex: 0 0 auto; margin-left: 10px; color: #93c5fd; font-size: 12px; transition: transform 160ms ease; }
        .heroHowTo p { margin: 7px 0 0; max-width: 860px; color: rgba(226,232,240,0.8); font-size: 14px; line-height: 1.65; }
        .screenerTriggerWrap { margin: 20px 0 4px; }
        .screenerShellResults { margin-top: 22px; }
        .scanDebug { margin-top: 30px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; line-height: 1.5; color: rgba(148,163,184,0.5); letter-spacing: 0.02em; }
        @media (max-width: 980px) {
          .resultShell { grid-template-columns: 1fr; gap: 14px; }
        }
        @media (max-width: 720px) {
          .screenerShellPage, .screenerShellPage * { box-sizing: border-box; }
          .screenerShellPage { overflow-x: hidden; }
          .resultWrap { width: 100%; padding: 14px 10px 44px; overflow-x: hidden; }
          .hero { border-radius: 20px; padding: 15px; }
          .eyebrow { max-width: 100%; white-space: normal; text-align: center; line-height: 1.35; }
          .hero h1 { font-size: clamp(28px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero > p { font-size: 14px; line-height: 1.62; }
          .heroHowTo { padding: 12px 13px; }
        }
        @media (max-width: 390px) { .resultWrap { padding-left: 8px; padding-right: 8px; } .hero { padding: 12px; } }
      `}</style>

        <div className="resultWrap">
          <div className="resultShell">
            <ScreenerNav currentHref={currentHref} variant="sidebar" />

            <div className="resultMain">
              <section className="hero">
                <div className="eyebrow">
                  <span style={{ color: toneColour(tone) }}>●</span>
                  {eyebrow}
                </div>
                <h1>{title}</h1>
                <p>{description}</p>
                <HowToCollapse title={explainerTitle} body={explainerBody} />
              </section>

              <div className="screenerTriggerWrap">
                <ScreenerNav currentHref={currentHref} variant="trigger" />
              </div>

              <div className="screenerShellResults">{children}</div>

              {footer ? <div className="scanDebug">{footer}</div> : null}

              <HideWatermarksBar />
            </div>
          </div>
        </div>
      </main>
    </WatermarkVisibilityProvider>
  );
}
