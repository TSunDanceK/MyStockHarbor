              {aiAnalysis ? (
                <section
                  style={{
                    marginTop: 18,
                    border: "1px solid rgba(59,130,246,0.22)",
                    borderRadius: 18,
                    padding: 18,
                    background:
                      "linear-gradient(180deg, rgba(8,14,28,0.98), rgba(6,10,18,0.98))",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "7px 12px",
                      borderRadius: 999,
                      background:
                        "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                      border: "1px solid rgba(59,130,246,0.32)",
                      color: "#dbeafe",
                      fontWeight: 950,
                      letterSpacing: "0.08em",
                      fontSize: 12,
                    }}
                  >
                    AI COMPANY OUTLOOK
                  </div>

                  <h2
                    style={{
                      margin: "14px 0 0 0",
                      fontSize: 26,
                      lineHeight: 1.12,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    Business snapshot, score read and future potential for {symbol}
                  </h2>

                  <p
                    style={{
                      margin: "10px 0 0 0",
                      lineHeight: 1.7,
                      opacity: 0.82,
                      maxWidth: 860,
                      fontSize: 15,
                    }}
                  >
                    This section is AI-generated, cached for a week, and designed to give a
                    broader business and outlook read without changing your live chart data.
                    It is educational only and not financial advice.
                  </p>

                  <div
                    style={{
                      marginTop: 16,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>Fundamentals score</div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.fundamentalsScore)),
                        }}
                      >
                        {aiAnalysis.fundamentalsScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        {scoreBandLabel(aiAnalysis.fundamentalsScore)}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>Future potential score</div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 34,
                          fontWeight: 950,
                          color: toneColor(scoreTone(aiAnalysis.futurePotentialScore)),
                        }}
                      >
                        {aiAnalysis.futurePotentialScore}/100
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        {scoreBandLabel(aiAnalysis.futurePotentialScore)}
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 18,
                        padding: 18,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={miniLabelStyle}>AI analysis updated</div>
                      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>
                        {formatAiUpdatedLabel(aiAnalysis.generatedAt)}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.72 }}>
                        Refreshed separately from live price and chart data.
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gap: 18,
                    }}
                  >
                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>What this company broadly does</h3>
                      <p style={articleTextStyle}>{aiAnalysis.businessSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>Fundamentals-style read</h3>
                      <p style={articleTextStyle}>{aiAnalysis.fundamentalsSummary}</p>
                    </article>

                    <article style={articleStyle}>
                      <h3 style={articleHeadingStyle}>Future potential analysis</h3>
                      <p style={articleTextStyle}>{aiAnalysis.futurePotentialSummary}</p>
                    </article>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div style={statCardStyle}>
                      <div style={statLabelStyle}>Bullish factors</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bullishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={statLabelStyle}>Risk factors</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.bearishFactors.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={statCardStyle}>
                      <div style={statLabelStyle}>What investors may watch</div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {aiAnalysis.watchPoints.map((item) => (
                          <div key={item} style={articleTextStyle}>
                            • {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
