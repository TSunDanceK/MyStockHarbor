import type { CSSProperties } from "react";

export default function StockNewsLoading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div className="newsWrap">
        <div style={topNavRowStyle}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={ghostTopButtonStyle} />
            <div style={ghostTopButtonStyle} />
            <div style={ghostTopButtonStyle} />
            <div style={ghostTopButtonStyle} />
          </div>
        </div>

        <section style={heroShellStyle}>
          <div style={heroLeftStyle}>
            <div style={newsDeskTagStyle}>NEWS DESK</div>

            <div style={loadingStatusWrapStyle}>
              <div style={loadingStatusTextStyle}>Building your stock news briefing…</div>

              <div style={loadingBarTrackStyle}>
                <div style={loadingBarFillStyle} />
              </div>
            </div>

            <div style={{ ...ghostBlockStyle, height: 50, width: "82%", marginTop: 18 }} />
            <div style={{ ...ghostBlockStyle, height: 18, width: "92%", marginTop: 16 }} />
            <div style={{ ...ghostBlockStyle, height: 18, width: "88%", marginTop: 10 }} />
            <div style={{ ...ghostBlockStyle, height: 18, width: "72%", marginTop: 10 }} />

            <div style={heroMetricRowStyle}>
              <div style={heroMetricStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 82 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: 120, marginTop: 12 }} />
              </div>

              <div style={heroMetricStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 96 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: 150, marginTop: 12 }} />
              </div>

              <div style={heroMetricStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 60 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: 70, marginTop: 12 }} />
              </div>
            </div>

            <div style={heroCtaRowStyle}>
              <div style={ghostHeroButtonStyle} />
              <div style={ghostHeroButtonStyle} />
            </div>

            <div style={{ ...ghostBlockStyle, height: 14, width: "58%", marginTop: 12 }} />
          </div>

          <div style={heroRightStyle}>
            <div style={scorePanelStyle}>
              <div style={{ ...ghostBlockStyle, height: 12, width: 90 }} />
              <div style={{ ...ghostBlockStyle, height: 46, width: 120, marginTop: 14 }} />
              <div style={{ ...ghostBlockStyle, height: 28, width: 140, marginTop: 12 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "100%", marginTop: 14 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "92%", marginTop: 10 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "78%", marginTop: 10 }} />
            </div>

            <div style={miniScoreGridStyle}>
              <div style={miniScoreCardStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 92 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: 90, marginTop: 12 }} />
                <div style={{ ...ghostBlockStyle, height: 14, width: 120, marginTop: 10 }} />
              </div>

              <div style={miniScoreCardStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 72 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: 90, marginTop: 12 }} />
                <div style={{ ...ghostBlockStyle, height: 14, width: 110, marginTop: 10 }} />
              </div>
            </div>
          </div>
        </section>

        <section className="newsGrid" style={newsGridStyle}>
          <div style={{ display: "grid", gap: 18 }}>
            <section style={editorialCardStyle}>
              <div style={{ ...ghostBlockStyle, height: 12, width: 110 }} />
              <div style={{ ...ghostBlockStyle, height: 34, width: "58%", marginTop: 12 }} />

              <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
                {[0, 1, 2].map((item) => (
                  <article key={item} style={newsLeadCardStyle}>
                    <div style={newsMetaRowStyle}>
                      <div style={{ ...ghostPillStyle, width: 98 }} />
                      <div style={{ ...ghostBlockStyle, height: 12, width: 90 }} />
                    </div>

                    <div style={{ ...ghostBlockStyle, height: 24, width: "84%", marginTop: 14 }} />
                    <div style={{ ...ghostBlockStyle, height: 16, width: "100%", marginTop: 14 }} />
                    <div style={{ ...ghostBlockStyle, height: 16, width: "94%", marginTop: 10 }} />
                    <div style={{ ...ghostBlockStyle, height: 16, width: "78%", marginTop: 10 }} />

                    <div style={whyItMattersBoxStyle}>
                      <div style={{ ...ghostBlockStyle, height: 11, width: 108 }} />
                      <div style={{ ...ghostBlockStyle, height: 15, width: "96%", marginTop: 12 }} />
                      <div style={{ ...ghostBlockStyle, height: 15, width: "70%", marginTop: 9 }} />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section style={featuredInsightShellStyle}>
              <div style={{ ...ghostBlockStyle, height: 12, width: 120 }} />
              <div style={{ ...ghostBlockStyle, height: 34, width: "52%", marginTop: 12 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "100%", marginTop: 16 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "95%", marginTop: 10 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "86%", marginTop: 10 }} />
              <div style={{ ...ghostBlockStyle, height: 16, width: "80%", marginTop: 10 }} />
            </section>
          </div>

          <aside style={{ display: "grid", gap: 18 }}>
            {[0, 1, 2].map((card) => (
              <section key={card} style={sidebarCardStyle}>
                <div style={{ ...ghostBlockStyle, height: 12, width: 120 }} />
                <div style={{ ...ghostBlockStyle, height: 28, width: "62%", marginTop: 12 }} />
                <div style={{ ...ghostBlockStyle, height: 16, width: "100%", marginTop: 16 }} />
                <div style={{ ...ghostBlockStyle, height: 16, width: "92%", marginTop: 10 }} />
                <div style={{ ...ghostBlockStyle, height: 16, width: "84%", marginTop: 10 }} />
              </section>
            ))}
          </aside>
        </section>

        <section style={bottomStripStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...ghostBlockStyle, height: 28, width: 260 }} />
            <div style={{ ...ghostBlockStyle, height: 16, width: "82%", marginTop: 12 }} />
            <div style={{ ...ghostBlockStyle, height: 16, width: "70%", marginTop: 10 }} />
          </div>

          <div style={bottomStripActionsStyle}>
            <div style={ghostBottomButtonStyle} />
            <div style={ghostBottomButtonStyle} />
            <div style={ghostBottomButtonStyle} />
          </div>
        </section>
      </div>

      <style>{`
        .newsWrap {
          max-width: 1240px;
          margin: 0 auto;
          padding: 24px 40px 42px;
        }

        .newsGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.22fr) minmax(320px, 0.78fr);
          gap: 22px;
          margin-top: 22px;
          align-items: start;
        }

        @keyframes newsPulse {
          0% { opacity: 0.55; }
          50% { opacity: 1; }
          100% { opacity: 0.55; }
        }

        @keyframes newsLoadSlide {
          0% {
            transform: translateX(-110%);
          }
          100% {
            transform: translateX(320%);
          }
        }

        @media (max-width: 1080px) {
          .newsWrap {
            padding: 20px 18px 36px;
          }

          .newsGrid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .newsWrap {
            padding: 16px 14px 32px;
          }

          .newsWrap > section:first-of-type {
            display: block !important;
            padding: 18px !important;
            border-radius: 24px !important;
          }

          .newsWrap > section:first-of-type > div:first-child {
            width: 100% !important;
          }

          .newsWrap > section:first-of-type > div:nth-child(2) {
            display: none !important;
          }

          .newsWrap section[style] {
            max-width: 100%;
          }

          .newsGrid {
            display: none !important;
          }

          .newsWrap > section:last-of-type {
            display: none !important;
          }
        }

        @media (max-width: 480px) {
          .newsWrap {
            padding: 14px 12px 28px;
          }

          .newsWrap > div:first-child {
            display: none !important;
          }

          .newsWrap > section:first-of-type {
            min-height: 62vh;
          }
        }
      `}</style>
    </main>
  );
}

const ghostBlockStyle: CSSProperties = {
  borderRadius: 10,
  background:
    "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
  animation: "newsPulse 1.5s ease-in-out infinite",
};

const ghostPillStyle: CSSProperties = {
  height: 28,
  borderRadius: 999,
  background:
    "linear-gradient(90deg, rgba(59,130,246,0.14), rgba(59,130,246,0.24), rgba(59,130,246,0.14))",
  animation: "newsPulse 1.5s ease-in-out infinite",
};

const ghostTopButtonStyle: CSSProperties = {
  width: 128,
  height: 40,
  borderRadius: 999,
  background:
    "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.10), rgba(255,255,255,0.05))",
  animation: "newsPulse 1.5s ease-in-out infinite",
};

const ghostHeroButtonStyle: CSSProperties = {
  width: 190,
  height: 46,
  borderRadius: 14,
  background:
    "linear-gradient(90deg, rgba(59,130,246,0.10), rgba(255,255,255,0.10), rgba(59,130,246,0.10))",
  animation: "newsPulse 1.5s ease-in-out infinite",
};

const ghostBottomButtonStyle: CSSProperties = {
  width: 170,
  height: 44,
  borderRadius: 999,
  background:
    "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.10), rgba(255,255,255,0.05))",
  animation: "newsPulse 1.5s ease-in-out infinite",
};

const loadingStatusWrapStyle: CSSProperties = {
  marginTop: 16,
  maxWidth: 520,
};

const loadingStatusTextStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.04em",
  color: "rgba(219,234,254,0.86)",
};

const loadingBarTrackStyle: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  marginTop: 10,
  width: "100%",
  height: 8,
  borderRadius: 999,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const loadingBarFillStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
  width: "38%",
  borderRadius: 999,
  background:
    "linear-gradient(90deg, rgba(59,130,246,0.92), rgba(96,165,250,0.95), rgba(34,197,94,0.88))",
  animation: "newsLoadSlide 1.35s ease-in-out infinite",
};

const topNavRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 18,
};

const heroShellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.24fr) minmax(280px, 0.76fr)",
  gap: 18,
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 28,
  padding: 22,
  background:
    "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,9,15,0.98))",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 54px rgba(0,0,0,0.36)",
};

const heroLeftStyle: CSSProperties = {
  minWidth: 0,
};

const heroRightStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  alignContent: "start",
};

const newsDeskTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.28)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08))",
  color: "#dbeafe",
  fontSize: 12,
  fontWeight: 950,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const heroMetricRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  marginTop: 18,
};

const heroMetricStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const heroCtaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  marginTop: 18,
};

const scorePanelStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
};

const miniScoreGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const miniScoreCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const newsGridStyle: CSSProperties = {};

const editorialCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const featuredInsightShellStyle: CSSProperties = {
  border: "1px solid rgba(59,130,246,0.22)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(7,12,22,0.96))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const sidebarCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const newsLeadCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.028)",
};

const newsMetaRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const whyItMattersBoxStyle: CSSProperties = {
  marginTop: 14,
  border: "1px solid rgba(59,130,246,0.16)",
  borderRadius: 14,
  padding: 12,
  background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(255,255,255,0.02))",
};

const bottomStripStyle: CSSProperties = {
  marginTop: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))",
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "center",
};

const bottomStripActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};
