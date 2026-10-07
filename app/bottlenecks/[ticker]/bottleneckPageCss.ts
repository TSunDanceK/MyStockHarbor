// The Bottleneck page's stylesheet (#563 COWORK #158). Reading text at
// var(--fs-read) (16 px at the default root); labels and fine print smaller.
export const BOTTLENECK_PAGE_CSS = `
.bnMain{min-height:100vh;background:#06080d;color:#f1f5f9;font-family:system-ui,Arial;padding:32px 20px;overflow-x:hidden;}
.bnWrap{max-width:1160px;margin:0 auto;}
.bnPage{display:grid;gap:18px;min-width:0;}
.bnCrumbs{font-size:var(--fs-label);color:#94a3b8;}
.bnCrumbs a{color:#93c5fd;text-decoration:none;font-weight:700;}
.bnHero{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:18px;align-items:start;}
.bnHeroLeft,.bnGlance,.bnCard{border:1px solid rgba(148,163,184,0.22);border-radius:18px;padding:20px;background:linear-gradient(135deg,rgba(148,163,184,0.06),rgba(255,255,255,0.02));min-width:0;}
.bnHeroTop{display:flex;gap:12px;align-items:center;}
.bnEyebrow{display:block;font-size:var(--fs-label);font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#5fd4c7;}
.bnWho{margin:2px 0 0;font-size:var(--fs-read);line-height:1.4;color:#94a3b8;}
.bnH1{margin:14px 0 0;font-size:2rem;line-height:1.15;letter-spacing:-0.01em;}
.bnLead{margin:12px 0 0;font-size:var(--fs-read);line-height:1.65;color:#cbd5e1;}
.bnChips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}
.bnChip{display:inline-block;padding:5px 10px;border-radius:999px;border:1px solid rgba(148,163,184,0.28);font-size:var(--fs-label);font-weight:700;color:#e2e8f0;}
.bnChipMuted{color:#94a3b8;font-weight:600;}
.bnGlance{display:grid;gap:14px;}
.bnMeter{display:grid;gap:4px;}
.bnMeterHead{display:flex;justify-content:space-between;gap:8px;font-size:var(--fs-label);font-weight:800;color:#cbd5e1;}
.bnMeterHead strong[data-tone="High"]{color:#fca5a5;}.bnMeterHead strong[data-tone="Medium"]{color:#fcd34d;}.bnMeterHead strong[data-tone="Low"]{color:#86efac;}
.bnMeterBar{height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(34,197,94,0.25),rgba(245,158,11,0.25),rgba(239,68,68,0.25));overflow:hidden;}
.bnMeterBar i{display:block;height:10px;border-radius:5px;background:#e2e8f0;}
.bnMeterBar i[data-tone="High"]{background:#ef4444;}.bnMeterBar i[data-tone="Medium"]{background:#f59e0b;}.bnMeterBar i[data-tone="Low"]{background:#22c55e;}
.bnMeterEnds{display:flex;justify-content:space-between;font-size:var(--fs-fine);color:#64748b;}
.bnFine{margin:0;font-size:var(--fs-fine);line-height:1.5;color:#94a3b8;}
.bnFine a,.bnRead a,.bnSources a{color:#93c5fd;}
.bnPrice{border-top:1px solid rgba(148,163,184,0.18);padding-top:12px;display:grid;gap:8px;}
.bnPriceLine{margin:0;font-size:var(--fs-read);display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;}
.bnPriceLinks,.bnDepLinks{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;}
.bnLink{color:#93c5fd;text-decoration:none;font-weight:800;font-size:var(--fs-label);white-space:nowrap;}
.bnMove{font-weight:800;font-size:var(--fs-label);white-space:nowrap;}
.bnMove[data-tone="up"]{color:#86efac;}.bnMove[data-tone="down"]{color:#fca5a5;}.bnMove[data-tone="flat"]{color:#cbd5e1;}
.bnH2{margin:0 0 10px;font-size:1.375rem;line-height:1.2;}
.bnH3{margin:0 0 10px;font-size:1.125rem;line-height:1.25;}
.bnMap{margin:0;min-width:0;}
.bnMap svg{display:block;max-width:100%;height:auto;}
.bnMap a{cursor:pointer;}
.bnMapNarrow{display:none!important;}
.bnTwo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;}
.bnNote{margin:0 0 12px;font-size:var(--fs-read);line-height:1.6;color:#94a3b8;}
.bnDeps{list-style:none;margin:0;padding:0;display:grid;gap:12px;}
.bnDep{padding:12px;border:1px solid rgba(148,163,184,0.16);border-radius:14px;background:rgba(15,22,36,0.6);scroll-margin-top:80px;min-width:0;}
.bnDepHead{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;align-items:center;}
.bnInitials{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:#1e293b;color:#cbd5e1;font-weight:900;font-size:var(--fs-label);}
.bnDepName{display:grid;gap:3px;min-width:0;}
.bnDepName strong{font-size:var(--fs-read);line-height:1.3;overflow-wrap:anywhere;}
.bnGrade{justify-self:start;padding:2px 8px;border-radius:999px;font-size:var(--fs-fine);font-weight:900;}
.bnGrade[data-grade="hard"]{background:rgba(239,68,68,0.16);color:#fca5a5;}
.bnGrade[data-grade="some"]{background:rgba(245,158,11,0.16);color:#fcd34d;}
.bnGrade[data-grade="spread"]{background:rgba(34,197,94,0.16);color:#86efac;}
.bnShare{display:grid;gap:4px;justify-items:end;font-weight:900;font-size:var(--fs-read);}
.bnShareBar{display:block;width:72px;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;}
.bnShareBar i{display:block;height:6px;border-radius:3px;}
.bnShareBar i[data-grade="hard"]{background:#ef4444;}.bnShareBar i[data-grade="some"]{background:#f59e0b;}.bnShareBar i[data-grade="spread"]{background:#22c55e;}
.bnWhy{margin:10px 0 8px;font-size:var(--fs-read);line-height:1.6;color:#cbd5e1;}
.bnTk{font-weight:900;font-size:var(--fs-label);}
.bnUnlisted{font-size:var(--fs-label);color:#94a3b8;font-weight:700;}
.bnReverseHead{font-size:var(--fs-read);}
.bnReverse{margin-top:14px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.18);display:grid;gap:6px;}
.bnThree{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;}
.bnBullets{margin:0;padding-left:18px;display:grid;gap:8px;font-size:var(--fs-read);line-height:1.6;color:#cbd5e1;}
.bnPartners{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:8px;}
.bnPartners li{display:flex;justify-content:space-between;align-items:center;gap:10px;}
.bnPartner{display:inline-flex;align-items:center;gap:8px;color:#e2e8f0;text-decoration:none;font-size:var(--fs-label);}
.bnFiled{margin:0 0 10px;display:grid;gap:10px;}
.bnFiled div{display:grid;gap:2px;}
.bnFiled dt{font-size:var(--fs-label);color:#94a3b8;font-weight:700;}
.bnFiled dd{margin:0;font-size:var(--fs-read);font-weight:800;}
.bnSources{margin:0 0 10px;padding-left:18px;font-size:var(--fs-read);line-height:1.6;}
.bnRead{margin:0;font-size:var(--fs-read);line-height:1.6;color:#cbd5e1;}
.bnFaq{border-top:1px solid rgba(148,163,184,0.16);padding:10px 0;}
.bnFaq summary{cursor:pointer;font-weight:800;font-size:var(--fs-read);}
.bnFaq .bnRead{margin-top:8px;}
.bnExplore{display:grid;gap:4px;}
.bnExploreLinks{display:flex;flex-wrap:wrap;gap:8px;}
.bnPill{display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid rgba(147,197,253,0.35);color:#dbeafe;text-decoration:none;font-weight:800;font-size:var(--fs-label);}
@media(max-width:900px){.bnHero{grid-template-columns:minmax(0,1fr);}.bnTwo{grid-template-columns:minmax(0,1fr);}}
@media(max-width:640px){.bnMain{padding:20px 14px;}.bnMapWide{display:none!important;}.bnMapNarrow{display:block!important;}.bnH1{font-size:1.625rem;}.bnHeroLeft,.bnGlance,.bnCard{padding:16px;}.bnDepHead{grid-template-columns:32px minmax(0,1fr);}.bnShare{grid-column:2;justify-items:start;}}
`;
