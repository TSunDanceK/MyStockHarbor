import type { Lesson } from "./lessons";

// The "How to Read Financial Data" (Fundamentals) module.
// Kept in its own file so the large shared lessons.ts stays untouched.
// Cast via unknown because "Fundamentals" is intentionally not in the base
// Lesson["category"] union in lessons.ts (which we do not modify).
export const FUNDAMENTALS_LESSONS = [
  {
    slug: "how-to-read-financial-data",
    title: "How to Read Financial Data",
    category: "Fundamentals",
    summary:
      "Charts tell you what a stock's price is doing; financial data tells you what the business behind it is doing. This is your map to the three financial statements, the numbers that matter, and how to read them without getting lost.",
    sections: [
      {
        heading: "What financial data actually is",
        body: [
          "Every listed company has to publish its financial results. Those results are just a structured record of three things: what the company sold and earned, what it owns and owes, and where its cash actually went. Learn to read those three records and you can size up almost any business.",
          "You do not need an accounting degree. Ninety percent of the value comes from a handful of numbers and, more importantly, from how those numbers change over time. A single quarter is a snapshot; three to five years of numbers is a story.",
          "Financial data is reported on a schedule. Most companies report a full set every quarter (three months) and a fuller, audited set once a year. The market reacts hardest at these earnings dates, because that is when the numbers are refreshed and compared against what investors expected.",
        ],
        image: {
          src: "/learn/how-to-read-financial-data/01.svg",
          caption:
            "The three financial statements and the single question each one answers. Together they describe a whole business.",
        },
      },
      {
        heading: "Fundamentals vs technicals",
        body: [
          "Technical analysis - the charts, indicators and patterns covered in the rest of these lessons - studies price and volume. It is about timing and behaviour: what buyers and sellers are doing right now.",
          "Fundamental analysis studies the business: revenue, profit, debt, cash flow and how expensive the shares are relative to all of that. It is about value and durability: whether the thing you are buying is actually worth owning.",
          "Neither one is 'better'. Many investors use fundamentals to decide WHAT to own and technicals to decide WHEN to buy or sell it. A strong chart on a weak business can reverse fast; a great business bought at a crazy price can still be a poor investment for years.",
        ],
      },
      {
        heading: "The three statements at a glance",
        body: [
          "The income statement (also called the profit and loss, or P&L) shows performance over a period. It starts with revenue at the top and works down through costs to net profit at the bottom. It answers: is the company making money?",
          "The balance sheet is a snapshot on one day. It lists assets (what the company owns) on one side and liabilities plus equity (what it owes and what belongs to shareholders) on the other. It answers: is the company financially solid?",
          "The cash flow statement tracks the actual cash moving in and out over a period, split into operating, investing and financing activities. It answers: is the company generating real cash, not just accounting profit? Profit can be massaged; cash is much harder to fake.",
        ],
      },
      {
        heading: "Where this shows up on MyStockHarbor",
        body: [
          "On any stock page, the 'About' section gives you the company profile - sector, industry, market cap, beta, 52-week range and dividend - which is the context you read every other number against.",
          "The latest earnings card surfaces the most-watched income-statement numbers: EPS (actual vs estimate and the surprise), revenue (actual vs estimate), gross and operating margin, net income and management's guidance. The Valuation section shows the key multiples - P/E, P/S, P/B and EV/EBITDA - so you can judge how expensive the shares are.",
          "The share-dilution chart tracks the number of shares outstanding over time, which is one of the most overlooked fundamentals: a growing share count quietly shrinks every existing shareholder's slice of the business. Use these lessons to understand what each of those numbers means before you rely on them.",
        ],
        image: {
          src: "/learn/how-to-read-financial-data/02.svg",
          caption:
            "The fundamental data surfaced across a MyStockHarbor stock page, mapped to the statement each number comes from.",
        },
      },
      {
        heading: "A simple order of operations",
        body: [
          "1. Start with growth. Is revenue rising over several years? A shrinking top line makes everything else an uphill battle.",
          "2. Check profitability. Are margins healthy and stable or improving? Rising margins on rising revenue is the gold standard.",
          "3. Check the cash. Does the business generate free cash flow, and does operating cash flow roughly track reported profit? If profit is up but cash is not, ask why.",
          "4. Check the balance sheet. Is debt manageable? Could the company survive a bad year?",
          "5. Only then, check valuation. A great business is not a great investment at any price. Compare the multiples against the company's own history and its peers.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Judging a company on one quarter instead of a multi-year trend - single quarters are noisy.",
          "Looking at profit but ignoring cash flow and the balance sheet - a profitable company can still run out of money.",
          "Comparing raw numbers across very different companies instead of using ratios and margins that put everything on the same scale.",
          "Treating a low price-to-earnings ratio as automatically 'cheap' without asking why the market priced it that low.",
          "Forgetting share count: rising net income means little per share if the share count is rising just as fast.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Financial data boils down to three statements: income (profit), balance sheet (solidity) and cash flow (real cash).",
          "Trends over 3-5 years matter far more than any single quarter.",
          "Read growth, then profitability, then cash, then the balance sheet, and value the business last.",
          "Fundamentals tell you what to own; technicals help with timing. Use both.",
        ],
      },
    ],
  },
  {
    slug: "income-statement",
    title: "The Income Statement",
    category: "Fundamentals",
    summary:
      "The income statement is the company's scoreboard: how much it sold, what it cost, and what was left as profit. Read it top to bottom and you can see not just whether a business makes money, but how well and whether that is improving.",
    sections: [
      {
        heading: "What it is",
        body: [
          "The income statement (or profit and loss) covers a period of time - a quarter or a year. It answers one question in stages: of every pound or dollar of sales, how much survives all the way down to profit?",
          "It is built as a waterfall. Revenue sits at the top. Costs are subtracted in layers, and each subtotal along the way tells you something different about how the business is run. The single number at the bottom - net income - is what most headlines quote, but the layers above it are where the real insight lives.",
        ],
        image: {
          src: "/learn/income-statement/01.svg",
          caption:
            "The income-statement waterfall: revenue at the top, costs subtracted in layers, net income at the bottom. Each subtotal is a different lens on the business.",
        },
      },
      {
        heading: "The flow: from revenue to profit",
        body: [
          "Revenue (also called sales or the 'top line') is the total value of goods or services sold. Growing revenue is the first thing to look for - it is very hard to build a good investment case on a business whose sales are shrinking.",
          "Subtract the cost of goods sold (COGS) - the direct cost of producing what was sold - and you get gross profit. Subtract operating expenses (sales and marketing, admin, research and development) and you get operating income, also called EBIT (earnings before interest and tax). This is profit from the core business before financing and tax.",
          "Finally, subtract interest paid on debt and taxes, and you reach net income - the 'bottom line', the profit that belongs to shareholders. Some statements also show EBITDA (operating income with depreciation and amortisation added back), a rough proxy for cash profitability that is popular in valuation.",
        ],
      },
      {
        heading: "Margins - the real story",
        body: [
          "A margin is a profit subtotal expressed as a percentage of revenue, and margins are where an income statement gives up its secrets. Gross margin (gross profit divided by revenue) shows pricing power and production efficiency. Operating margin (operating income divided by revenue) shows how well the whole operation is run. Net margin (net income divided by revenue) is what is left after everything.",
          "The level matters, but the trend matters more. Expanding margins on rising revenue means the company is growing AND getting more efficient - the strongest signal on the whole statement. Falling margins while revenue grows can mean the company is 'buying' growth with discounts or rising costs, which is far less valuable.",
          "Margins are only meaningful within an industry. A software company might run a 25% net margin; a supermarket living on 2-3% is completely normal. Always compare a company to its own history and its direct peers, never to an unrelated sector.",
        ],
        image: {
          src: "/learn/income-statement/02.svg",
          caption:
            "The same revenue, two very different businesses. Healthy, stable-to-rising margins (left) versus margins being squeezed each year (right).",
        },
      },
      {
        heading: "Earnings per share (EPS)",
        body: [
          "EPS is net income (less any preferred dividends) divided by the weighted-average number of shares outstanding over the period. It converts total profit into profit per share, which is what actually matters to you as the owner of a few shares rather than the whole company.",
          "Because it is per share, EPS can move for two very different reasons: the company earned more, or the share count changed. A company that grows profit but issues lots of new shares can show flat or falling EPS - the pie got bigger but was cut into more slices. This is why the share-dilution chart on MyStockHarbor sits right alongside the earnings data.",
          "You will see 'basic' and 'diluted' EPS. Diluted EPS assumes all options and convertible securities become shares, so it is the more conservative, more honest figure. When in doubt, use diluted.",
        ],
      },
      {
        heading: "Growth and earnings surprises",
        body: [
          "Growth is usually quoted year-over-year (this quarter versus the same quarter a year ago), which strips out seasonal effects. Steady, durable revenue and EPS growth is worth more than a single explosive quarter that cannot be repeated.",
          "At each earnings date, results are compared against analysts' consensus estimates. Beating on EPS and revenue is a positive surprise; missing is a negative one. MyStockHarbor's earnings card shows the actual, the estimate and the surprise for exactly this reason.",
          "Crucially, the market often reacts more to guidance - management's forecast for upcoming quarters - than to the results just reported. A company can beat on the quarter but fall sharply because it cut its outlook, because share prices reflect the future, not the past.",
        ],
      },
      {
        heading: "Positive, negative and risk signals",
        body: [
          "Positive (green): revenue and EPS growing over several years; gross, operating and net margins stable or expanding; consistently beating estimates and raising guidance; net income backed up by similar operating cash flow.",
          "Negative (red): revenue flat or falling; margins compressing year after year; net income propped up by one-off gains rather than the core business; EPS flattered by financial engineering while the actual business stalls.",
          "Risk / it-depends (amber): explosive growth that is priced for perfection, so any wobble hurts; margins at an unusually high point in a cyclical industry that may not last; profit that depends heavily on a single product or customer. None of these are automatically bad - they just need a closer look.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Reading only the headline net income or EPS and ignoring the margin trend that explains it.",
          "Comparing margins across unrelated industries - a 3% net margin is a disaster for software and perfectly healthy for a grocer.",
          "Ignoring share dilution, so rising net income masks flat or falling EPS.",
          "Treating a single strong or weak quarter as the trend instead of looking across several years.",
          "Focusing on the results just reported while ignoring the guidance that the market actually trades on.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Read the income statement as a waterfall: revenue at the top, profit subtotals in layers, net income at the bottom.",
          "Margins - and especially their trend - reveal more than the raw profit figure.",
          "EPS is profit per share, so always watch the share count alongside it.",
          "Growth, estimate beats and guidance drive how the market reacts at earnings.",
        ],
      },
    ],
  },
  {
    slug: "balance-sheet-and-cash-flow",
    title: "The Balance Sheet & Cash Flow",
    category: "Fundamentals",
    summary:
      "Profit is an opinion; cash is a fact. The balance sheet shows whether a company is financially solid, and the cash flow statement shows whether its profits turn into real money. Together they tell you if a business can survive a bad year.",
    sections: [
      {
        heading: "Two questions these answer",
        body: [
          "The income statement tells you whether a company is profitable. It does not tell you whether the company could pay its bills next month, or whether that profit actually arrived as cash. Those two gaps are exactly what the balance sheet and cash flow statement fill.",
          "This is not a technicality. Companies can report healthy profits and still go bust because they run out of cash or drown in debt. Reading these two statements is how you avoid businesses that look fine on the surface and are fragile underneath.",
        ],
      },
      {
        heading: "The balance sheet: what a company owns and owes",
        body: [
          "The balance sheet is a snapshot on a single date, and it always balances to one simple identity: Assets = Liabilities + Equity. Everything the company owns was funded either by money it owes (liabilities) or by money belonging to shareholders (equity).",
          "Assets include cash, inventory, money owed by customers (receivables), and long-term items like property and equipment. Liabilities include money owed to suppliers (payables), short-term borrowing and long-term debt. Equity - assets minus liabilities - is the shareholders' stake, also called book value.",
          "Two of the most useful things to find here are the cash pile and the total debt. A company with lots of cash and little debt has options and can weather a downturn. A company with thin cash and heavy debt has very little room for error if business slows.",
        ],
        image: {
          src: "/learn/balance-sheet-and-cash-flow/01.svg",
          caption:
            "The balance-sheet identity: everything a company owns (assets) is funded by what it owes (liabilities) plus what shareholders own (equity).",
        },
      },
      {
        heading: "Liquidity and solvency: can it pay its bills?",
        body: [
          "Liquidity is about the short term. The current ratio (current assets divided by current liabilities) asks whether the company has enough near-term resources to cover what is due within a year. A ratio comfortably above 1 is reassuring; below 1 can signal a cash squeeze. The quick ratio is the stricter version that excludes inventory.",
          "Solvency is about the long term - the overall debt load. The debt-to-equity ratio compares total borrowings to shareholders' equity. What counts as 'high' varies hugely by industry: utilities and banks carry lots of debt by design, while a software firm carrying the same level would be a warning.",
          "Interest coverage (operating income divided by interest expense) shows how easily the company can service its debt from profits. A low or falling coverage ratio means more of the profit is being eaten by lenders, leaving less for shareholders and less cushion if earnings dip.",
        ],
      },
      {
        heading: "The cash flow statement: follow the cash",
        body: [
          "The cash flow statement splits all cash movement into three buckets. Operating cash flow is the cash generated by the core business - the single most important line. Investing cash flow covers money spent on or received from long-term assets, most notably capital expenditure (capex) on property and equipment. Financing cash flow covers raising or repaying debt, issuing shares, paying dividends and buying back stock.",
          "The pattern across these buckets is revealing. A healthy, maturing company typically shows strong positive operating cash flow, negative investing cash flow (it is investing in itself) and financing outflows (paying down debt or returning cash to shareholders). A company whose cash mostly comes from repeatedly raising debt or issuing shares - rather than from operations - is living on outside money.",
        ],
        image: {
          src: "/learn/balance-sheet-and-cash-flow/02.svg",
          caption:
            "The three cash-flow buckets. Operating cash funds the business; capex is subtracted to reach free cash flow - the cash left for debt, dividends and buybacks.",
        },
      },
      {
        heading: "Free cash flow - the number that funds everything",
        body: [
          "Free cash flow (FCF) is operating cash flow minus capital expenditure. It is the cash left over after the company has paid to keep its operations running and invested in its future. This is the money genuinely available to pay down debt, pay dividends, buy back shares or make acquisitions.",
          "FCF is one of the hardest numbers to fake, which is why serious investors lean on it. A company that consistently produces strong free cash flow has real financial freedom. One that reports profits but never converts them into free cash flow deserves scrutiny.",
          "FCF yield (free cash flow divided by market value) lets you compare that cash generation to the price of the shares, a bit like an interest rate on the business. Higher can mean better value - as always, provided the cash flow is durable.",
        ],
      },
      {
        heading: "Quality of earnings: cash vs profit",
        body: [
          "Over time, operating cash flow should broadly track - or exceed - reported net income. When it does, earnings are 'high quality': the profit is showing up as real cash.",
          "A persistent gap where net income keeps rising but operating cash flow lags is a classic warning sign. It can be innocent (a fast-growing company tying up cash in inventory and receivables) or serious (aggressive accounting inflating profit). Either way it is worth understanding before you trust the profit figure.",
          "A quick sanity check: are customer receivables or inventory growing much faster than sales? That can mean the company is booking sales it has not been paid for, or building stock it cannot shift - both of which drain cash even as profit looks fine.",
        ],
      },
      {
        heading: "Positive, negative and risk signals",
        body: [
          "Positive (green): strong and growing free cash flow; operating cash flow that matches or beats net income; a solid cash position with manageable debt; a current ratio comfortably above 1; interest easily covered by profits.",
          "Negative (red): negative or steadily falling free cash flow; cash flow that keeps lagging reported profit; rising debt with weakening interest coverage; a current ratio below 1; negative shareholder equity (liabilities exceed assets).",
          "Risk / it-depends (amber): high debt that is normal for the industry but still limits flexibility; heavy capex that will either pay off or destroy value depending on execution; a big cash pile that could be a war chest or a sign management has run out of good ideas.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Trusting reported profit without ever checking whether it turns into cash.",
          "Judging debt in isolation instead of relative to the industry and to the company's ability to service it.",
          "Ignoring free cash flow, which is where a company's real financial freedom lives.",
          "Overlooking receivables or inventory ballooning faster than sales - an early sign of trouble.",
          "Reading a single balance sheet date instead of watching how debt, cash and equity trend over several years.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "The balance sheet shows solidity: assets funded by liabilities plus equity, with cash and debt the headline items.",
          "Liquidity (current ratio) and solvency (debt-to-equity, interest coverage) tell you if a company can survive stress.",
          "Cash flow splits into operating, investing and financing; operating cash flow is the one that matters most.",
          "Free cash flow funds dividends, buybacks and debt repayment - and cash should track profit over time.",
        ],
      },
    ],
  },
  {
    slug: "valuation-and-key-ratios",
    title: "Valuation & Key Ratios",
    category: "Fundamentals",
    summary:
      "A great company can be a poor investment if you overpay. Ratios turn raw financial data into a common language so you can judge how expensive a stock is, how profitable the business is, and how financially healthy it stands - and compare it fairly to any other.",
    sections: [
      {
        heading: "Why ratios exist",
        body: [
          "Raw numbers are hard to compare. A company earning $1bn sounds huge, but if the market values it at $500bn, that profit is thin relative to the price. Ratios solve this by putting everything on the same scale, so a tiny company and a giant can be compared side by side.",
          "There are three families worth knowing: valuation ratios (how expensive the shares are), quality and return ratios (how good the business is), and health ratios (how financially solid it is). MyStockHarbor's Valuation section focuses on the first family, showing the multiples most investors check first.",
          "The golden rule with every ratio: a number in isolation means little. Compare it to the company's own history, to its direct competitors, and to its industry. 'High' and 'low' only exist relative to something.",
        ],
      },
      {
        heading: "Valuation multiples: P/E, P/S, P/B, EV/EBITDA",
        body: [
          "Price-to-earnings (P/E) is the most quoted: share price divided by earnings per share, or equivalently market value divided by net income. It tells you how many years of current earnings you are paying for. A broad market average has historically sat somewhere around the mid-teens to low twenties, but fast-growing companies command higher P/Es because investors expect earnings to rise.",
          "Price-to-sales (P/S) compares value to revenue. It is useful when a company has little or no profit yet - common for young, fast-growing firms - because there is still revenue to measure against. Price-to-book (P/B) compares value to net asset value (equity); it matters most for asset-heavy businesses like banks and insurers, where a P/B below 1 can signal either genuine cheapness or real distress.",
          "EV/EBITDA compares enterprise value (market value plus debt, minus cash) to EBITDA. Because it includes debt and ignores capital structure and tax differences, it lets you compare companies with very different debt loads more fairly than P/E does. In every case, lower generally means cheaper - but cheap and good are not the same thing.",
        ],
        image: {
          src: "/learn/valuation-and-key-ratios/01.svg",
          caption:
            "The four valuation multiples shown on a MyStockHarbor stock page, and roughly how to read low, fair and rich readings for each.",
        },
      },
      {
        heading: "PEG: valuation with growth in mind",
        body: [
          "A high P/E is not automatically expensive if the company is growing fast. The PEG ratio adjusts for this by dividing the P/E by the earnings growth rate. As a rough rule of thumb, a PEG around 1 suggests the price and the growth are roughly in balance; well below 1 can indicate a bargain relative to growth, and well above 1 can indicate you are paying a lot for that growth.",
          "PEG is a useful sanity check, not a precise instrument, because it depends entirely on a growth forecast that may not come true. Treat it as a way to compare fast growers to slow growers on fairer terms, not as a guarantee.",
        ],
      },
      {
        heading: "Quality and returns: ROE, ROA, ROIC, margins",
        body: [
          "Return on equity (ROE) is net income divided by shareholders' equity - how much profit the company generates on the money shareholders have invested. Consistently high ROE (often cited as above roughly 15%) is a hallmark of a strong business. But watch the source: ROE can be pumped up by piling on debt, so a high ROE alongside high debt is less impressive than a high ROE with little debt.",
          "Return on assets (ROA) uses total assets instead of equity, so it is far less distorted by borrowing than ROE and shows how efficiently the whole asset base is used (it still reflects some leverage, since net income is after interest). Return on invested capital (ROIC) is the most rigorous of the three: it measures returns on all the capital in the business, debt and equity, and comparing it to the cost of that capital tells you whether the company is genuinely creating value.",
          "Alongside these, the margins from the income statement lesson - gross, operating and net - are the everyday quality gauges. High, stable or rising margins plus high returns on capital is the profile of a quality business.",
        ],
        image: {
          src: "/learn/valuation-and-key-ratios/02.svg",
          caption:
            "Quality and health ratios grouped: returns (ROE, ROA, ROIC), profitability (margins) and balance-sheet strength (debt-to-equity, current ratio).",
        },
      },
      {
        heading: "Financial health and dividends",
        body: [
          "The health ratios from the previous lesson belong in any valuation check. Debt-to-equity shows the debt load, the current ratio shows short-term liquidity, and interest coverage shows how comfortably debt is serviced. A cheap-looking stock with a fragile balance sheet is cheap for a reason.",
          "For income investors, two dividend numbers matter. Dividend yield is the annual dividend divided by the share price - the income return you receive. The payout ratio is dividends divided by net income, showing how much of profit is being paid out. A payout ratio comfortably below 100% leaves room to keep paying through a bad year; a ratio above 100% means the company is paying out more than it earns, which rarely lasts.",
          "Be wary of an unusually high dividend yield. It sometimes reflects a great income opportunity, but often it means the share price has fallen sharply because the market expects the dividend to be cut - a so-called yield trap.",
        ],
      },
      {
        heading: "Using ratios without being fooled (value traps)",
        body: [
          "The most common trap is assuming low equals cheap. A stock can have a low P/E because the market correctly expects its earnings to fall. Buying it because the ratio looks low - without asking why - is how investors walk into 'value traps': cheap stocks that keep getting cheaper.",
          "Always pair a valuation ratio with a quality and a health check. A low multiple on a business with growing revenue, solid margins, strong free cash flow and low debt is genuinely interesting. The same low multiple on a business with shrinking sales, falling margins and heavy debt is usually a warning, not an opportunity.",
          "And always compare like with like. Different industries carry different 'normal' multiples for good reasons - growth rates, capital intensity and risk all differ - so a bank and a software firm should never be judged on the same P/E.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Assuming a low P/E, P/S or P/B automatically means a stock is cheap, without asking why the market priced it there.",
          "Comparing multiples across unrelated industries that naturally trade on very different levels.",
          "Trusting a high ROE without checking whether it is driven by genuine profitability or just heavy debt.",
          "Chasing a high dividend yield that is really a signal of an expected dividend cut.",
          "Using a single ratio in isolation instead of combining valuation, quality and health.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Ratios put companies of any size on the same scale; always compare to history and peers.",
          "Valuation multiples (P/E, P/S, P/B, EV/EBITDA, PEG) show how expensive; lower is cheaper but not always better.",
          "Quality ratios (ROE, ROA, ROIC, margins) show how good the business is - check the source of high returns.",
          "Cheap plus weak is a value trap; combine valuation with quality and financial health before deciding.",
        ],
      },
    ],
  },
  {
    slug: "financial-red-flags-green-flags",
    title: "Red Flags, Green Flags & Risk Signs",
    category: "Fundamentals",
    summary:
      "This lesson pulls everything together into a practical checklist: the signs of a healthy business, the warning signs of a troubled one, the amber signals that need context - and how each one tends to move the share price.",
    sections: [
      {
        heading: "How to use this checklist",
        body: [
          "By now you have met the three statements and the main ratios. This lesson is the summary you can keep coming back to: a set of signals grouped into green (encouraging), red (warning) and amber (depends on context).",
          "No single signal decides anything. What you are looking for is the weight of evidence. A business flashing several green signals and no reds is on solid ground; one flashing multiple reds deserves real caution regardless of how exciting the story sounds. Read them together, and always over several years rather than a single quarter.",
        ],
        image: {
          src: "/learn/financial-red-flags-green-flags/01.svg",
          caption:
            "A quick-reference signal board: green flags (healthy), red flags (warning) and amber signs (context needed), grouped by where they appear in the financials.",
        },
      },
      {
        heading: "Green flags: signs of a healthy business",
        body: [
          "Revenue and earnings per share rising consistently over several years, not just one lucky quarter.",
          "Margins that are high for the industry and stable or expanding - the business is efficient and has pricing power.",
          "Strong and growing free cash flow, with operating cash flow that matches or exceeds reported net income (high-quality earnings).",
          "High returns on capital (ROE and especially ROIC) driven by real profitability rather than heavy borrowing.",
          "A solid balance sheet: manageable or net-negative debt, a comfortable current ratio, and interest easily covered.",
          "Shareholder-friendly capital use: a falling share count from buybacks, or a sustainable dividend with a payout ratio well under 100%, plus a habit of meeting or beating guidance.",
        ],
      },
      {
        heading: "Red flags: signs of trouble",
        body: [
          "Revenue flat or declining, or margins shrinking year after year - the core business is weakening.",
          "Net income rising while operating cash flow falls or lags - profit that is not turning into cash.",
          "Rising debt with deteriorating interest coverage, or a current ratio slipping below 1 - a tightening financial squeeze.",
          "Negative and worsening free cash flow, so the company depends on outside money to keep going.",
          "A rising share count that quietly dilutes existing holders, or a dividend payout ratio above 100% that cannot be sustained.",
          "Receivables or inventory growing much faster than sales, frequent one-off 'adjustments' that flatter profit, or auditor 'going concern' language - all classic accounting warning signs.",
        ],
      },
      {
        heading: "Amber signs: it depends on context",
        body: [
          "A very high valuation multiple: justified if growth is genuinely exceptional, dangerous if that growth stumbles even slightly.",
          "High debt that is normal for the industry (utilities, banks, telecoms) but still reduces flexibility in a downturn.",
          "Peak margins in a cyclical business - great now, but they may be near the top of the cycle and set to fall.",
          "A very high dividend yield, which can be a genuine income opportunity or a market warning that a cut is coming.",
          "A large cash pile: a war chest for opportunities, or a sign management cannot find productive uses for it.",
          "Negative earnings at an early-stage growth company: acceptable if cash reserves are strong and losses are narrowing, risky if cash is running low.",
        ],
      },
      {
        heading: "How each signal tends to impact the market",
        body: [
          "Growth and margin trends drive the biggest long-term re-ratings. A company that keeps growing and expanding margins tends to see its valuation multiple rise over time; one whose growth stalls often sees the multiple compress, which can hurt the share price even if profits are still positive.",
          "Balance-sheet and liquidity problems tend to cause sharp, sudden derating. Markets tolerate a lot until survival is in question - then repricing can be brutal and fast. This is why debt and cash flow warnings deserve outsized attention.",
          "Dividend cuts are punished heavily, because they break trust with income investors and signal that management sees trouble ahead. Share dilution pressures the price more quietly, by shrinking each holder's claim on future profits. And at earnings dates, guidance usually moves the stock more than the results just reported, because price reflects expected future profits, not past ones.",
        ],
      },
      {
        heading: "A five-minute health check",
        body: [
          "1. Growth: is revenue up over 3-5 years? 2. Margins: stable or improving? 3. Cash: positive free cash flow, and does operating cash flow track profit? 4. Balance sheet: is debt manageable and liquidity comfortable? 5. Returns: is ROE/ROIC solid and not just leverage?",
          "6. Shareholders: is the share count steady or falling, and is any dividend covered? 7. Valuation: are the multiples reasonable versus history and peers for the growth on offer?",
          "Run those seven checks and you will have a grounded view of almost any company in a few minutes. Then use the technical lessons - trend, support and resistance, RSI, MACD - to help decide timing. Fundamentals tell you whether something is worth owning; charts help you decide when to act.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Reacting to one signal in isolation instead of weighing green, red and amber together.",
          "Letting an exciting story override multiple red flags in the actual numbers.",
          "Assuming amber signals are automatically bad - many are perfectly fine in the right context.",
          "Judging any signal on a single quarter rather than a multi-year trend.",
          "Forgetting that the market trades on future expectations (guidance), not just reported results.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Weigh signals together and over several years - the balance of evidence matters more than any single number.",
          "Green flags cluster around growth, margins, cash and a strong balance sheet; red flags around the opposite.",
          "Amber signals - high valuations, industry-normal debt, big yields - need context, not a reflex reaction.",
          "Liquidity shocks and dividend cuts hit prices hardest; guidance moves stocks more than past results.",
        ],
      },
    ],
  },
] as unknown as Lesson[];
