// The dashboard's index row (#563 COWORK #164 A): the four ETFs, in the brief's
// order, with the indexes they track. Pure, so the landing view and its check
// import it without the server data module.
export const INDEX_ROW = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "DIA", label: "Dow 30" },
  { symbol: "IWM", label: "Russell 2000" },
] as const;
