// Shared styles for the Capex page's panels (one block, rendered once by the page).
export default function CapexStyles() {
  return (
    <style>{`
        .capexCard { background:#0b1220; border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:24px; margin-top:20px; }
        .capexH2 { margin:0 0 8px; font-size:24px; font-weight:900; }
        .capexH3 { margin:20px 0 8px; font-size:15px; font-weight:800; letter-spacing:0.02em; color:#cbd5e1; }
        .capexLead { font-size:15px; line-height:1.6; opacity:0.92; margin:0 0 4px; }
        .capexNote { font-size:13px; color:rgba(241,245,249,0.62); margin:0 0 8px; }
        .capexList { list-style:none; margin:0; padding:0; }
        .capexRow { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:4px 16px; padding:10px 0; border-top:1px solid rgba(255,255,255,0.06); }
        .capexRowName { font-size:14px; line-height:1.45; min-width:0; }
        .capexSub { color:rgba(241,245,249,0.62); }
        .capexTag { display:inline-block; margin-left:8px; font-size:11px; padding:1px 6px; border-radius:999px; border:1px solid rgba(255,255,255,0.18); color:rgba(241,245,249,0.62); }
        .capexBarCell { display:flex; align-items:center; gap:8px; min-width:0; }
        .capexTrack { position:relative; flex:1; height:10px; background:rgba(255,255,255,0.05); border-radius:0 4px 4px 0; }
        .capexOff { position:absolute; right:-2px; top:-7px; font-size:16px; color:#f1f5f9; }
        .capexPct { font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; min-width:56px; text-align:right; }
        .capexMeta { grid-column:1 / -1; font-size:12px; color:rgba(241,245,249,0.62); font-variant-numeric:tabular-nums; }
        .capexMeta a { color:#93c5fd; }
        .capexSources { font-size:12px; line-height:1.6; color:rgba(241,245,249,0.62); margin:18px 0 0; }
        @media (max-width: 640px) {
          .capexCard { padding:18px; }
          .capexRow { grid-template-columns:1fr; }
        }
      `}</style>
  );
}
