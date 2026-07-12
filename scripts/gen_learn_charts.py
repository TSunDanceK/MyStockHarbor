#!/usr/bin/env python3
"""Generate annotated lesson charts for /learn pages.

Consistent dark theme matching the site (#06080d), synthetic but realistic
price data engineered to demonstrate each concept clearly.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch
import os

BG = "#06080d"
PANEL = "#0a0e16"
GREEN = "#22c55e"
RED = "#ef4444"
BLUE = "#3b82f6"
YELLOW = "#facc15"
ORANGE = "#fb923c"
PURPLE = "#a78bfa"
CYAN = "#22d3ee"
TEXT = "#e2e8f0"
DIM = "#94a3b8"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "text.color": TEXT, "axes.edgecolor": "#1e293b", "axes.labelcolor": DIM,
    "xtick.color": DIM, "ytick.color": DIM, "font.size": 11,
    "font.family": "DejaVu Sans",
})

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "learn")


# ---------------- data engine ----------------
def path(segments, start=100.0, seed=1):
    """segments: list of (n, drift_pct_per_bar, vol_pct). Returns closes."""
    rng = np.random.default_rng(seed)
    closes = [start]
    for n, drift, vol in segments:
        for _ in range(n):
            c = closes[-1]
            closes.append(c * (1 + drift / 100 + rng.normal(0, vol / 100)))
    return np.array(closes[1:])


def ohlc(closes, vol=0.9, seed=2):
    rng = np.random.default_rng(seed)
    n = len(closes)
    o = np.empty(n); h = np.empty(n); l = np.empty(n)
    prev = closes[0] * (1 - rng.normal(0, vol / 200))
    for i in range(n):
        o[i] = prev
        body_hi = max(o[i], closes[i]); body_lo = min(o[i], closes[i])
        h[i] = body_hi * (1 + abs(rng.normal(0, vol / 180)))
        l[i] = body_lo * (1 - abs(rng.normal(0, vol / 180)))
        prev = closes[i] * (1 + rng.normal(0, vol / 600))
    return o, h, l, closes


def sma(x, n):
    out = np.full(len(x), np.nan)
    for i in range(n - 1, len(x)):
        out[i] = x[i - n + 1:i + 1].mean()
    return out


def ema(x, n):
    out = np.empty(len(x)); k = 2 / (n + 1); out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = x[i] * k + out[i - 1] * (1 - k)
    return out


def rsi(x, n=14):
    d = np.diff(x, prepend=x[0])
    up = np.where(d > 0, d, 0.0); dn = np.where(d < 0, -d, 0.0)
    ru, rd = ema(up, 2 * n - 1), ema(dn, 2 * n - 1)
    return 100 - 100 / (1 + ru / np.maximum(rd, 1e-9))


def macd(x):
    line = ema(x, 12) - ema(x, 26)
    sig = ema(line, 9)
    return line, sig, line - sig


def atr14(o, h, l, c):
    pc = np.roll(c, 1); pc[0] = c[0]
    tr = np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc)))
    return ema(tr, 27)


def stoch(h, l, c, n=14, d=3):
    k = np.full(len(c), np.nan)
    for i in range(n - 1, len(c)):
        hh = h[i - n + 1:i + 1].max(); ll = l[i - n + 1:i + 1].min()
        k[i] = 100 * (c[i] - ll) / max(hh - ll, 1e-9)
    k[:n - 1] = 50
    kk = sma(k, d); dd = sma(kk, d)
    return kk, dd


def volume_series(closes, base=1.0, spikes=None, trend_corr=0.6, seed=3):
    rng = np.random.default_rng(seed)
    n = len(closes)
    v = base * (1 + rng.normal(0, 0.25, n)).clip(0.3)
    ret = np.abs(np.diff(closes, prepend=closes[0]) / closes)
    v *= 1 + trend_corr * ret / max(ret.mean(), 1e-9) * 0.35
    if spikes:
        for idx, mult in spikes:
            v[idx] *= mult
    return v


# ---------------- drawing ----------------
def candles(ax, o, h, l, c, lw=0.8):
    n = len(c)
    w = 0.62
    for i in range(n):
        col = GREEN if c[i] >= o[i] else RED
        ax.plot([i, i], [l[i], h[i]], color=col, lw=lw, zorder=2)
        ax.add_patch(Rectangle((i - w / 2, min(o[i], c[i])), w,
                               max(abs(c[i] - o[i]), c[i] * 2e-4),
                               facecolor=col, edgecolor=col, zorder=3))
    ax.set_xlim(-1, n)
    ax.grid(alpha=0.10, lw=0.5)
    for s in ax.spines.values():
        s.set_visible(False)


def zone(ax, y0, y1, x0=None, x1=None, color=BLUE, alpha=0.16, label=None, label_side="left"):
    xmin, xmax = ax.get_xlim()
    x0 = xmin if x0 is None else x0
    x1 = xmax if x1 is None else x1
    ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, facecolor=color,
                           alpha=alpha, edgecolor=color, lw=0.8, zorder=1))
    if label:
        lx = x0 + 1 if label_side == "left" else x1 - 1
        ha = "left" if label_side == "left" else "right"
        ax.text(lx, (y0 + y1) / 2, label, color=color, fontsize=10.5,
                fontweight="bold", va="center", ha=ha, zorder=6)


def note(ax, xy, text, xytext, color=YELLOW, fs=10.5):
    ax.annotate(text, xy=xy, xytext=xytext, color=color, fontsize=fs,
                fontweight="bold", zorder=7,
                arrowprops=dict(arrowstyle="->", color=color, lw=1.4))


def title(ax, t):
    ax.set_title(t, color=TEXT, fontsize=13, fontweight="bold", loc="left", pad=10)


def save(fig, slug, which):
    d = os.path.join(OUT, slug)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, f"{which:02d}.png")
    fig.savefig(p, dpi=110, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)
    print("saved", p)


def fig1(h=4.6):
    fig, ax = plt.subplots(figsize=(10.4, h))
    return fig, ax


def fig2(hr=(3, 1.15)):
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(10.4, 6.0), sharex=True,
                                  gridspec_kw=dict(height_ratios=hr, hspace=0.08))
    ax2.set_facecolor(PANEL)
    ax2.grid(alpha=0.10, lw=0.5)
    for s in ax2.spines.values():
        s.set_visible(False)
    return fig, ax, ax2


# =====================================================================
# SUPPORT & RESISTANCE
# =====================================================================
def sr_01():
    c = path([(18, -0.5, 1.1), (14, 0.7, 1.0), (16, -0.6, 1.0), (12, 0.8, 1.0),
              (14, -0.55, 0.9), (16, 0.5, 1.0)], 112, seed=11)
    o, h, l, c = ohlc(c, seed=11)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    lo = np.min(l); zone(ax, lo, lo * 1.025, color=GREEN, label="SUPPORT ZONE")
    hi = np.max(h); zone(ax, hi * 0.975, hi, color=RED, label="RESISTANCE ZONE")
    lows = [np.argmin(l[:25]), 25 + np.argmin(l[25:52]), 52 + np.argmin(l[52:])]
    for i, x in enumerate(lows):
        note(ax, (x, l[x]), f"touch {i+1}", (x - 4, l[x] * 0.955), color=GREEN)
    title(ax, "Support & resistance are ZONES — areas where price repeatedly reacts")
    save(fig, "support-and-resistance", 1)


def sr_02():
    c = path([(26, 0.05, 0.9), (8, 1.5, 0.9), (10, -0.75, 0.7), (26, 0.85, 1.0)], 100, seed=12)
    o, h, l, c = ohlc(c, seed=12)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    lvl = np.max(h[:26])
    zone(ax, lvl * 0.99, lvl * 1.015, x1=34, color=RED, label="RESISTANCE")
    zone(ax, lvl * 0.99, lvl * 1.015, x0=34, color=GREEN, label="NOW SUPPORT", label_side="right")
    bx = 26 + np.argmax(c[26:34] > lvl * 1.02)
    note(ax, (bx, c[bx]), "breakout", (bx - 12, c[bx] * 1.06))
    rx = 34 + np.argmin(l[34:44])
    note(ax, (rx, l[rx]), "retest holds as support", (rx - 6, l[rx] * 0.93), color=GREEN)
    title(ax, "The role flip: broken resistance becomes support on the retest")
    save(fig, "support-and-resistance", 2)


def sr_03():
    c = path([(20, -0.5, 0.9), (6, 0.15, 0.7), (26, 0.85, 0.9)], 108, seed=13)
    o, h, l, c = ohlc(c, seed=13)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    zlo, zhi = np.min(l[18:28]), np.min(l[18:28]) * 1.028
    zone(ax, zlo, zhi, color=GREEN, label="SUPPORT ZONE")
    stop = zlo * 0.982
    ax.axhline(stop, color=RED, lw=1.6, ls="--")
    ax.text(1, stop * 0.995, "STOP — beyond the zone, not inside it", color=RED,
            fontsize=10.5, fontweight="bold", va="top")
    ent = 26
    ax.axhline(c[ent], color=YELLOW, lw=1.2, ls=":")
    note(ax, (ent, c[ent]), "entry on the bounce", (ent - 16, c[ent] * 1.05))
    tgt = np.max(h) * 0.995
    ax.axhline(tgt, color=CYAN, lw=1.6, ls="--")
    ax.text(1, tgt * 1.005, "TARGET — next resistance", color=CYAN, fontsize=10.5, fontweight="bold")
    title(ax, "Structure defines the trade: entry at the zone, stop beyond it, target at the next level")
    save(fig, "support-and-resistance", 3)


# =====================================================================
# TRENDS
# =====================================================================
def trend_swings(seed, up=True):
    if up:
        segs = [(9, 1.3, 0.8), (5, -0.9, 0.7), (9, 1.4, 0.8), (6, -0.85, 0.7),
                (10, 1.3, 0.8), (5, -0.8, 0.7), (9, 1.4, 0.8)]
    else:
        segs = [(9, -1.3, 0.8), (5, 1.0, 0.7), (9, -1.4, 0.8), (6, 0.9, 0.7),
                (10, -1.3, 0.8), (5, 0.85, 0.7), (9, -1.4, 0.8)]
    return path(segs, 100 if up else 160, seed=seed)


def swing_points(c, w=4):
    hi, lo = [], []
    for i in range(w, len(c) - w):
        seg = c[i - w:i + w + 1]
        if c[i] == seg.max(): hi.append(i)
        if c[i] == seg.min(): lo.append(i)
    def dedup(idx):
        out = []
        for i in idx:
            if not out or i - out[-1] > w: out.append(i)
        return out
    return dedup(hi), dedup(lo)


def trends_01():
    c = trend_swings(21, up=True)
    o, h, l, c = ohlc(c, seed=21)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    his, los = swing_points(c)
    for i, x in enumerate(his[:4]):
        ax.annotate(f"HH", (x, h[x] * 1.012), color=CYAN, fontweight="bold", ha="center", fontsize=11)
    for i, x in enumerate(los[:4]):
        ax.annotate(f"HL", (x, l[x] * 0.985), color=YELLOW, fontweight="bold", ha="center", fontsize=11)
    title(ax, "Uptrend structure: higher highs (HH) and higher lows (HL)")
    save(fig, "how-to-identify-stock-trends", 1)


def trends_02():
    c = trend_swings(22, up=False)
    o, h, l, c = ohlc(c, seed=22)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    his, los = swing_points(c)
    for x in his[:4]:
        ax.annotate("LH", (x, h[x] * 1.012), color=RED, fontweight="bold", ha="center", fontsize=11)
    for x in los[:4]:
        ax.annotate("LL", (x, l[x] * 0.985), color=ORANGE, fontweight="bold", ha="center", fontsize=11)
    if his:
        x = his[1] if len(his) > 1 else his[0]
        note(ax, (x, h[x]), "bounces stall below prior highs", (x - 8, h[x] * 1.09), color=RED)
    title(ax, "Downtrend structure: lower highs (LH) and lower lows (LL)")
    save(fig, "how-to-identify-stock-trends", 2)


def trends_03():
    c = path([(70, -0.28, 0.8), (30, 0.15, 0.7), (90, 0.55, 0.8)], 150, seed=23)
    o, h, l, c = ohlc(c, vol=0.7, seed=23)
    fig, ax = fig1(5.0)
    candles(ax, o, h, l, c, lw=0.5)
    m50, m200 = sma(c, 50), sma(c, 120)
    ax.plot(m50, color=CYAN, lw=1.8, label="MA50")
    ax.plot(m200, color=ORANGE, lw=1.8, label="MA200")
    cross = next(i for i in range(121, len(c)) if m50[i] > m200[i] and m50[i - 1] <= m200[i - 1])
    note(ax, (cross, m50[cross]), "golden cross confirms the new trend", (cross - 55, m50[cross] * 1.14))
    px = 155
    note(ax, (px, l[px]), "pullbacks hold above rising MAs", (px - 30, l[px] * 0.85), color=GREEN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "Confirmation: price above MA50, MA50 above MA200, both rising")
    save(fig, "how-to-identify-stock-trends", 3)


# =====================================================================
# TIMEFRAMES
# =====================================================================
def tf_01():
    cd = path([(30, 0.9, 0.7), (12, -1.0, 0.6), (18, 0.9, 0.7)], 100, seed=31)
    od, hd, ld, cd = ohlc(cd, seed=31)
    ci = path([(40, -0.5, 0.9)], 138, seed=32)
    oi, hi_, li, ci = ohlc(ci, vol=1.1, seed=32)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10.4, 4.4))
    candles(a1, od, hd, ld, cd)
    a1.set_title("DAILY — pullback in an uptrend", color=GREEN, fontsize=11.5, fontweight="bold", loc="left")
    x0, x1 = 30, 42
    a1.add_patch(Rectangle((x0, ld[x0:x1].min() * 0.99), x1 - x0,
                           hd[x0:x1].max() * 1.01 - ld[x0:x1].min() * 0.99,
                           facecolor="none", edgecolor=YELLOW, lw=1.5, ls="--", zorder=6))
    candles(a2, oi, hi_, li, ci)
    a2.set_title("INTRADAY (same pullback) — looks like a downtrend", color=RED, fontsize=11.5, fontweight="bold", loc="left")
    fig.suptitle("One stock, two stories: the timeframe changes the picture", color=TEXT,
                 fontsize=13, fontweight="bold", x=0.055, ha="left")
    save(fig, "timeframes", 1)


def tf_02():
    c = path([(24, 1.0, 0.8), (10, -1.0, 0.6), (6, 0.2, 0.5), (20, 1.1, 0.8)], 95, seed=33)
    o, h, l, c = ohlc(c, seed=33)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    zlo = l[28:40].min()
    zone(ax, zlo, zlo * 1.03, x0=20, color=BLUE, label="HTF support zone")
    ex = 40
    note(ax, (ex, c[ex]), "LTF entry trigger inside the zone", (ex - 22, c[ex] * 1.09))
    title(ax, "Top-down: higher timeframe picks the zone, lower timeframe times the entry")
    save(fig, "timeframes", 2)


def tf_03():
    c = path([(120, 0.02, 1.5)], 100, seed=34)
    o, h, l, c = ohlc(c, vol=1.2, seed=34)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.5)
    lvl = np.percentile(l, 12)
    ax.axhline(lvl, color=BLUE, lw=1.5, ls="--")
    ax.text(2, lvl * 0.99, "intraday 'support'", color=BLUE, fontsize=10.5, fontweight="bold", va="top")
    breaks = [i for i in range(len(l)) if l[i] < lvl][:2]
    for b in breaks:
        note(ax, (b, l[b]), "false break (noise)", (b + 4, l[b] * 0.96), color=RED)
    title(ax, "Lower timeframes lie more often: noise breaks levels that the daily never notices")
    save(fig, "timeframes", 3)


# =====================================================================
# ATR
# =====================================================================
def atr_01():
    c = path([(35, 0.15, 0.55), (20, -1.5, 2.4), (25, 0.3, 0.8)], 100, seed=41)
    o, h, l, c = ohlc(c, vol=1.0, seed=41)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c)
    a = atr14(o, h, l, c)
    ax2.plot(a, color=ORANGE, lw=1.8)
    ax2.fill_between(range(len(a)), a, a.min(), color=ORANGE, alpha=0.15)
    ax2.set_ylabel("ATR(14)")
    pk = int(np.argmax(a))
    ax2.annotate("volatility expands", (pk, a[pk]), (pk - 26, a[pk] * 0.92),
                 color=YELLOW, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.3))
    title(ax, "ATR measures movement, not direction — it rises when candles get bigger")
    save(fig, "atr", 1)


def atr_02():
    c = path([(55, 0.02, 0.45), (22, 1.6, 1.6)], 100, seed=42)
    o, h, l, c = ohlc(c, vol=0.8, seed=42)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c)
    a = atr14(o, h, l, c)
    ax2.plot(a, color=ORANGE, lw=1.8)
    ax2.set_ylabel("ATR(14)")
    tr = int(np.argmin(a[20:60])) + 20
    ax2.annotate("compression: market coiling", (tr, a[tr]), (tr - 22, a[tr] * 1.6),
                 color=CYAN, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color=CYAN, lw=1.3))
    note(ax, (58, c[58]), "expansion arrives", (38, c[58] * 1.06))
    title(ax, "Quiet precedes loud: low, flat ATR after a base often marks the coil before the move")
    save(fig, "atr", 2)


def atr_03():
    c = path([(16, 0.3, 0.9), (5, -0.8, 0.8), (4, 0.2, 0.6), (20, 1.1, 0.9)], 100, seed=43)
    o, h, l, c = ohlc(c, seed=43)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    ent_i = 16; ent = c[ent_i]
    a = atr14(o, h, l, c)[ent_i]
    ax.axhline(ent, color=YELLOW, lw=1.2, ls=":")
    ax.text(1, ent * 1.004, "entry", color=YELLOW, fontsize=10.5, fontweight="bold")
    tight = ent - 0.6 * a
    ax.axhline(tight, color=RED, lw=1.5, ls="--")
    ax.text(1, tight * 0.995, "tight stop — killed by normal noise", color=RED, fontsize=10.5, fontweight="bold", va="top")
    wide = ent - 2 * a
    ax.axhline(wide, color=GREEN, lw=1.6, ls="--")
    ax.text(1, wide * 0.994, "2-ATR stop — survives the shakeout", color=GREEN, fontsize=10.5, fontweight="bold", va="top")
    dip = ent_i + np.argmin(l[ent_i:ent_i + 10])
    note(ax, (dip, l[dip]), "shakeout", (dip + 3, l[dip] * 0.965), color=ORANGE)
    title(ax, "Stops belong beyond normal noise — ATR tells you how much noise is normal")
    save(fig, "atr", 3)


# =====================================================================
# BOLLINGER
# =====================================================================
def boll(c, n=20, k=2):
    m = sma(c, n)
    sd = np.full(len(c), np.nan)
    for i in range(n - 1, len(c)):
        sd[i] = c[i - n + 1:i + 1].std()
    return m, m + k * sd, m - k * sd


def bb_01():
    c = path([(30, 0.1, 0.5), (25, 0.6, 1.7), (25, 0.05, 0.6)], 100, seed=51)
    o, h, l, c = ohlc(c, seed=51)
    m, u, lo_ = boll(c)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(m, color=YELLOW, lw=1.5, label="Middle band (SMA20)")
    ax.plot(u, color=CYAN, lw=1.4, label="Upper band (+2σ)")
    ax.plot(lo_, color=CYAN, lw=1.4, label="Lower band (−2σ)")
    ax.fill_between(range(len(c)), u, lo_, color=CYAN, alpha=0.06)
    note(ax, (44, u[44]), "bands widen with volatility", (28, u[44] * 1.07), color=CYAN)
    note(ax, (72, u[72]), "and tighten as it fades", (60, u[72] * 1.08), color=CYAN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT, fontsize=9.5)
    title(ax, "Bollinger anatomy: a 20-SMA wrapped in ±2 standard deviation bands")
    save(fig, "bollinger-bands", 1)


def bb_02():
    c = path([(45, 0.015, 0.38), (25, 1.5, 1.1)], 100, seed=52)
    o, h, l, c = ohlc(c, vol=0.65, seed=52)
    m, u, lo_ = boll(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(m, color=YELLOW, lw=1.3)
    ax.plot(u, color=CYAN, lw=1.3); ax.plot(lo_, color=CYAN, lw=1.3)
    width = (u - lo_) / m
    sq = int(np.nanargmin(width[25:48])) + 25
    note(ax, (sq, u[sq]), "THE SQUEEZE — bands at their tightest", (16, u[sq] * 1.12))
    bo = 47
    note(ax, (bo, c[bo]), "breakout with volume", (bo - 5, c[bo] * 1.10), color=GREEN)
    v = volume_series(c, spikes=[(46, 2.6), (47, 3.2), (48, 2.4)], seed=52)
    ax2.bar(range(len(v)), v, color=[GREEN if c[i] >= o[i] else RED for i in range(len(c))], alpha=0.85)
    ax2.set_ylabel("Volume")
    title(ax, "The squeeze: volatility coils, then resolves — direction comes from the break")
    save(fig, "bollinger-bands", 2)


def bb_03():
    c = path([(40, 0.02, 0.75), (30, 1.15, 0.8)], 100, seed=53)
    o, h, l, c = ohlc(c, seed=53)
    m, u, lo_ = boll(c)
    fig, ax = fig1(5.0)
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(m, color=YELLOW, lw=1.4)
    ax.plot(u, color=CYAN, lw=1.3); ax.plot(lo_, color=CYAN, lw=1.3)
    tag = 20 + int(np.nanargmin((c - lo_)[20:38]))
    note(ax, (tag, lo_[tag]), "range: band tags revert to the middle", (tag - 16, lo_[tag] * 0.93), color=GREEN)
    note(ax, (58, u[58]), "trend: price WALKS the upper band — strength, not a sell", (30, u[58] * 1.10), color=ORANGE)
    ax.axvline(41, color=DIM, lw=1, ls=":")
    title(ax, "Two regimes, two rules: fade the bands in ranges, respect the walk in trends")
    save(fig, "bollinger-bands", 3)


# =====================================================================
# EMA20
# =====================================================================
def ema_01():
    c = path([(45, 0.85, 0.8), (30, -0.95, 0.8)], 100, seed=61)
    o, h, l, c = ohlc(c, seed=61)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    e, m = ema(c, 20), sma(c, 50)
    ax.plot(e, color=CYAN, lw=1.8, label="EMA20")
    ax.plot(m, color=ORANGE, lw=1.8, label="MA50")
    note(ax, (52, e[52]), "EMA20 turns quickly", (56, e[52] * 1.09), color=CYAN)
    note(ax, (66, m[66]), "MA50 lags behind", (60, m[66] * 0.88), color=ORANGE)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "Responsiveness: the EMA20 hugs price and turns first at the reversal")
    save(fig, "ema20", 1)


def ema_02():
    segs = [(10, 1.3, 0.6), (4, -0.9, 0.5), (9, 1.3, 0.6), (4, -0.95, 0.5),
            (9, 1.25, 0.6), (4, -0.9, 0.5), (10, 1.3, 0.6)]
    c = path(segs, 100, seed=62)
    o, h, l, c = ohlc(c, vol=0.7, seed=62)
    fig, ax = fig1()
    candles(ax, o, h, l, c)
    e = ema(c, 20)
    ax.plot(e, color=CYAN, lw=1.8, label="EMA20")
    touches = []
    for i in range(22, len(c) - 2):
        if l[i] <= e[i] * 1.005 and c[i] >= e[i] * 0.99:
            if not touches or i - touches[-1] > 8:
                touches.append(i)
    for t in touches[:3]:
        note(ax, (t, l[t]), "pullback entry", (t - 6, l[t] * 0.91), color=GREEN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "The rail: momentum uptrends pull back to the EMA20 and resume")
    save(fig, "ema20", 2)


def ema_03():
    c = path([(90, 0.0, 1.15)], 100, seed=63)
    o, h, l, c = ohlc(c, seed=63)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    e = ema(c, 20)
    ax.plot(e, color=CYAN, lw=1.8, label="EMA20 (flat)")
    crosses = [i for i in range(21, len(c)) if (c[i] - e[i]) * (c[i - 1] - e[i - 1]) < 0]
    for x in crosses[2:8:2]:
        ax.annotate("✕", (x, e[x]), color=RED, fontsize=13, fontweight="bold", ha="center", va="center", zorder=8)
    ax.text(len(c) * 0.35, max(c) * 1.01, "every cross whipsaws", color=RED, fontsize=11, fontweight="bold")
    ax.legend(loc="lower left", frameon=False, labelcolor=TEXT)
    title(ax, "The failure mode: a flat EMA20 in a range generates endless false signals")
    save(fig, "ema20", 3)


# =====================================================================
# MACD
# =====================================================================
def macd_panel(ax2, line, sig, hist):
    ax2.axhline(0, color=DIM, lw=1)
    ax2.bar(range(len(hist)), hist, color=[GREEN if x >= 0 else RED for x in hist], alpha=0.75, width=0.7)
    ax2.plot(line, color=CYAN, lw=1.6)
    ax2.plot(sig, color=ORANGE, lw=1.4)


def macd_01():
    c = path([(25, -0.6, 0.8), (35, 0.9, 0.8), (20, -0.5, 0.8)], 110, seed=71)
    o, h, l, c = ohlc(c, seed=71)
    line, sig, hist = macd(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    ax2.annotate("MACD line", (46, line[46]), (30, line[46] + abs(line).max() * 0.5),
                 color=CYAN, fontweight="bold", arrowprops=dict(arrowstyle="->", color=CYAN, lw=1.2))
    ax2.annotate("signal line", (56, sig[56]), (62, sig[56] + abs(line).max() * 0.45),
                 color=ORANGE, fontweight="bold", arrowprops=dict(arrowstyle="->", color=ORANGE, lw=1.2))
    ax2.annotate("histogram = gap between them", (33, hist[33]), (8, min(hist) * 0.9),
                 color=TEXT, fontweight="bold", arrowprops=dict(arrowstyle="->", color=TEXT, lw=1.2))
    ax2.text(1, abs(line).max() * 0.75, "zero line", color=DIM, fontsize=9.5)
    title(ax, "MACD anatomy: two EMAs' distance, its smoothed signal, and the histogram")
    save(fig, "macd", 1)


def macd_02():
    c = path([(20, -0.7, 0.8), (12, 0.9, 0.7), (8, -0.6, 0.6), (18, 1.1, 0.8),
              (8, -0.7, 0.7), (18, 1.0, 0.8)], 120, seed=72)
    o, h, l, c = ohlc(c, seed=72)
    line, sig, hist = macd(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    bulls = [i for i in range(1, len(c)) if line[i] > sig[i] and line[i - 1] <= sig[i - 1]]
    for b in bulls:
        good = line[b] > 0
        ax2.plot(b, line[b], "o", color=GREEN if good else RED, ms=8, zorder=9)
    ax2.text(2, max(line) * 0.8, "● crosses above zero = with the regime", color=GREEN, fontsize=10, fontweight="bold")
    ax2.text(2, max(line) * 0.55, "● crosses below zero = counter-trend, lower odds", color=RED, fontsize=10, fontweight="bold")
    title(ax, "Signal-line crosses filtered by the zero line: trade with the regime")
    save(fig, "macd", 2)


def macd_03():
    c = path([(22, -0.8, 0.8), (14, 0.3, 0.5), (30, 1.1, 0.8), (14, 0.25, 0.9), (10, -0.9, 0.9)], 120, seed=73)
    o, h, l, c = ohlc(c, seed=73)
    line, sig, hist = macd(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    b1 = next(i for i in range(20, len(c)) if line[i] > sig[i] and line[i - 1] <= sig[i - 1])
    ax2.annotate("1. bullish cross below zero", (b1, line[b1]), (b1 - 18, min(line) * 0.95),
                 color=YELLOW, fontweight="bold", arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.3))
    z = next(i for i in range(b1, len(c)) if line[i] > 0)
    ax2.annotate("2. zero-line cross = regime change", (z, 0), (z - 4, max(line) * 0.75),
                 color=CYAN, fontweight="bold", arrowprops=dict(arrowstyle="->", color=CYAN, lw=1.3))
    hpk = 40 + int(np.argmax(hist[40:70]))
    ax2.annotate("3. shrinking histogram warns", (min(hpk + 16, len(c) - 8), hist[min(hpk + 16, len(c) - 8)]),
                 (hpk - 6, max(line) * 0.45), color=ORANGE, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color=ORANGE, lw=1.3))
    title(ax, "A regime change in sequence: cross → zero line → histogram deceleration")
    save(fig, "macd", 3)


# =====================================================================
# MOVING AVERAGES
# =====================================================================
def ma_01():
    c = path([(150, 0.42, 0.85)], 100, seed=81)
    o, h, l, c = ohlc(c, vol=0.75, seed=81)
    fig, ax = fig1(5.0)
    candles(ax, o, h, l, c, lw=0.45)
    m50, m200 = sma(c, 50), sma(c, 110)
    ax.plot(m50, color=CYAN, lw=1.8, label="MA50")
    ax.plot(m200, color=ORANGE, lw=1.8, label="MA200")
    note(ax, (100, m50[100]), "pullbacks respect the MA50", (60, m50[100] * 1.15), color=CYAN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "The healthy stack: price > MA50 > MA200, all rising")
    save(fig, "moving-averages", 1)


def ma_02():
    c = path([(65, -0.5, 0.85), (25, 0.15, 0.6), (80, 0.65, 0.85)], 170, seed=82)
    o, h, l, c = ohlc(c, vol=0.7, seed=82)
    fig, ax = fig1(5.0)
    candles(ax, o, h, l, c, lw=0.45)
    m50, m200 = sma(c, 50), sma(c, 110)
    ax.plot(m50, color=CYAN, lw=1.8, label="MA50")
    ax.plot(m200, color=ORANGE, lw=1.8, label="MA200")
    cross = next(i for i in range(111, len(c)) if m50[i] > m200[i] and m50[i - 1] <= m200[i - 1])
    ax.plot(cross, m50[cross], "o", color=YELLOW, ms=11, zorder=9)
    note(ax, (cross, m50[cross]), "GOLDEN CROSS", (cross - 45, m50[cross] * 1.18))
    lo = int(np.argmin(c))
    note(ax, (lo, l[lo]), "the low was long before the cross", (lo + 6, l[lo] * 0.9), color=DIM)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "Golden cross: reliable confirmation of the turn — but late by design")
    save(fig, "moving-averages", 2)


def ma_03():
    c = path([(90, 0.55, 0.8), (25, -1.05, 0.9), (45, 0.8, 0.8)], 100, seed=83)
    o, h, l, c = ohlc(c, vol=0.7, seed=83)
    fig, ax = fig1(5.0)
    candles(ax, o, h, l, c, lw=0.45)
    m200 = sma(c, 90)
    ax.plot(m200, color=ORANGE, lw=2.0, label="MA200 (rising)")
    touch = 90 + int(np.argmin(np.abs(l[90:120] - m200[90:120])))
    zone(ax, m200[touch] * 0.97, m200[touch] * 1.03, x0=touch - 12, x1=touch + 12, color=GREEN, alpha=0.2)
    note(ax, (touch, l[touch]), "the BUY ZONE test: correction into a rising MA200", (touch - 62, l[touch] * 0.92), color=GREEN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    title(ax, "The MA200 test: where long-term buyers habitually defend strong stocks")
    save(fig, "moving-averages", 3)


# =====================================================================
# RSI
# =====================================================================
def rsi_panel(ax2, r):
    ax2.plot(r, color=PURPLE, lw=1.7)
    ax2.axhline(70, color=RED, lw=1, ls="--"); ax2.axhline(30, color=GREEN, lw=1, ls="--")
    ax2.fill_between(range(len(r)), 70, 100, color=RED, alpha=0.07)
    ax2.fill_between(range(len(r)), 0, 30, color=GREEN, alpha=0.07)
    ax2.set_ylim(0, 100); ax2.set_ylabel("RSI(14)")


def rsi_01():
    c = path([(25, 0.9, 0.8), (18, -1.0, 0.8), (25, 0.8, 0.8)], 100, seed=91)
    o, h, l, c = ohlc(c, seed=91)
    r = rsi(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ax2.text(1, 80, "overbought > 70", color=RED, fontsize=10, fontweight="bold")
    ax2.text(1, 16, "oversold < 30", color=GREEN, fontsize=10, fontweight="bold")
    title(ax, "RSI anatomy: recent up-moves vs down-moves compressed to a 0–100 scale")
    save(fig, "rsi", 1)


def rsi_02():
    c = path([(55, 1.05, 0.65), (12, -0.3, 0.6)], 100, seed=92)
    o, h, l, c = ohlc(c, vol=0.7, seed=92)
    r = rsi(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ob = [i for i in range(len(r)) if r[i] > 70]
    if ob:
        x0, x1 = ob[0], ob[-1]
        ax2.annotate("overbought for weeks — while price keeps climbing",
                     ((x0 + x1) / 2, 76), ((x0 + x1) / 2 - 26, 38), color=YELLOW, fontweight="bold",
                     arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.3))
    title(ax, "Why 'overbought' isn't a sell signal: strong trends live above 70")
    save(fig, "rsi", 2)


def rsi_03():
    c = path([(20, 1.0, 0.7), (9, -1.15, 0.7), (25, 1.0, 0.7)], 100, seed=93)
    o, h, l, c = ohlc(c, seed=93)
    r = rsi(c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ax2.axhline(40, color=CYAN, lw=1.2, ls=":")
    ax2.text(1, 42, "bull-range floor ≈ 40", color=CYAN, fontsize=10, fontweight="bold")
    dip = 20 + int(np.argmin(r[20:34]))
    ax2.annotate("dip bottoms near 40 and hooks up = buy-the-dip zone",
                 (dip, r[dip]), (dip - 14, 12), color=GREEN, fontweight="bold",
                 arrowprops=dict(arrowstyle="->", color=GREEN, lw=1.3))
    zlo = l[20:34].min()
    zone(ax, zlo, zlo * 1.025, x0=12, x1=42, color=BLUE, alpha=0.14, label="support")
    title(ax, "The bull-range dip buy: RSI ~40 at support inside an intact uptrend")
    save(fig, "rsi", 3)


# =====================================================================
# STOCHASTIC
# =====================================================================
def stoch_panel(ax2, kk, dd):
    ax2.plot(kk, color=CYAN, lw=1.6, label="%K")
    ax2.plot(dd, color=ORANGE, lw=1.4, label="%D")
    ax2.axhline(80, color=RED, lw=1, ls="--"); ax2.axhline(20, color=GREEN, lw=1, ls="--")
    ax2.set_ylim(0, 100); ax2.set_ylabel("Stoch(14,3)")
    ax2.legend(loc="upper left", frameon=False, labelcolor=TEXT, fontsize=9)


def sto_01():
    c = path([(20, 0.7, 0.9), (15, -0.8, 0.9), (15, 0.75, 0.9), (15, -0.6, 0.9)], 100, seed=101)
    o, h, l, c = ohlc(c, seed=101)
    kk, dd = stoch(h, l, c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    stoch_panel(ax2, kk, dd)
    ax2.text(2, 88, "overbought > 80", color=RED, fontsize=9.5, fontweight="bold")
    ax2.text(2, 8, "oversold < 20", color=GREEN, fontsize=9.5, fontweight="bold")
    title(ax, "Stochastic: where did price close inside its recent high–low range?")
    save(fig, "stochastic", 1)


def sto_02():
    c = path([(12, -0.85, 0.6), (12, 0.85, 0.6), (12, -0.85, 0.6), (12, 0.85, 0.6),
              (12, -0.85, 0.6), (12, 0.85, 0.6)], 100, seed=102)
    o, h, l, c = ohlc(c, vol=0.6, seed=102)
    kk, dd = stoch(h, l, c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    zone(ax, min(l), min(l) * 1.02, color=GREEN, alpha=0.12, label="range support")
    zone(ax, max(h) * 0.985, max(h), color=RED, alpha=0.12, label="range resistance")
    stoch_panel(ax2, kk, dd)
    for i in range(16, len(c)):
        if np.isnan(kk[i]) or np.isnan(dd[i]) or np.isnan(kk[i-1]) or np.isnan(dd[i-1]):
            continue
        if kk[i] > dd[i] and kk[i - 1] <= dd[i - 1] and kk[i] < 25:
            ax2.plot(i, kk[i], "^", color=GREEN, ms=9, zorder=9)
        if kk[i] < dd[i] and kk[i - 1] >= dd[i - 1] and kk[i] > 75:
            ax2.plot(i, kk[i], "v", color=RED, ms=9, zorder=9)
    title(ax, "Home turf: %K/%D crosses at the extremes, at the range edges")
    save(fig, "stochastic", 2)


def sto_03():
    c = path([(70, 0.85, 0.6)], 100, seed=103)
    o, h, l, c = ohlc(c, vol=0.6, seed=103)
    kk, dd = stoch(h, l, c)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    stoch_panel(ax2, kk, dd)
    count = 0
    for i in range(16, len(c)):
        if np.isnan(kk[i]) or np.isnan(dd[i]) or np.isnan(kk[i-1]) or np.isnan(dd[i-1]):
            continue
        if kk[i] < dd[i] and kk[i - 1] >= dd[i - 1] and kk[i] > 72 and count < 4:
            ax2.plot(i, kk[i], "v", color=RED, ms=9, zorder=9)
            count += 1
    ax2.text(6, 40, "every 'sell signal' punished — the trend just continues", color=RED, fontsize=10.5, fontweight="bold")
    title(ax, "The failure mode: strong trends pin stochastic at the extreme")
    save(fig, "stochastic", 3)


# =====================================================================
# VOLUME
# =====================================================================
def vol_01():
    c = path([(22, 0.35, 0.8), (6, 0.7, 0.7), (8, -0.9, 0.7), (10, 0.3, 0.6), (6, 1.4, 0.8), (18, 0.9, 0.8)], 100, seed=111)
    o, h, l, c = ohlc(c, seed=111)
    lvl = max(h[:24]) * 1.0
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    ax.axhline(lvl, color=RED, lw=1.4, ls="--")
    ax.text(1, lvl * 1.006, "resistance", color=RED, fontsize=10.5, fontweight="bold")
    v = volume_series(c, spikes=[(26, 0.5), (27, 0.45), (51, 2.8), (52, 3.3), (53, 2.5)], seed=111)
    ax2.bar(range(len(v)), v, color=[GREEN if c[i] >= o[i] else RED for i in range(len(c))], alpha=0.85)
    ax2.set_ylabel("Volume")
    note(ax, (27, h[27]), "weak-volume breakout fails", (10, h[27] * 1.09), color=RED)
    note(ax, (52, c[52]), "volume-backed breakout holds", (33, c[52] * 1.08), color=GREEN)
    ax2.annotate("surge = conviction", (52, v[52]), (60, v[52] * 0.85), color=YELLOW,
                 fontweight="bold", arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.3))
    title(ax, "Volume is the lie detector: real breakouts come with real participation")
    save(fig, "volume", 1)


def vol_02():
    c = path([(38, -0.85, 0.9), (4, -2.6, 1.6), (18, 0.9, 0.9)], 130, seed=112)
    o, h, l, c = ohlc(c, seed=112)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    v = volume_series(c, spikes=[(40, 3.2), (41, 4.5), (42, 3.0)], seed=112)
    ax2.bar(range(len(v)), v, color=[GREEN if c[i] >= o[i] else RED for i in range(len(c))], alpha=0.85)
    ax2.set_ylabel("Volume")
    note(ax, (41, l[41]), "capitulation flush + reversal", (18, l[41] * 0.94), color=YELLOW)
    ax2.annotate("climax volume", (41, v[41]), (48, v[41] * 0.8), color=YELLOW,
                 fontweight="bold", arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.3))
    title(ax, "Climax: extreme volume after a long move marks exhaustion, not continuation")
    save(fig, "volume", 2)


def vol_03():
    c = path([(14, 1.1, 0.7), (7, -0.55, 0.5), (13, 1.1, 0.7), (7, -0.5, 0.5), (14, 1.1, 0.7)], 100, seed=113)
    o, h, l, c = ohlc(c, vol=0.7, seed=113)
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    up_idx = list(range(0, 14)) + list(range(21, 34)) + list(range(41, 55))
    v = volume_series(c, seed=113)
    for i in range(len(v)):
        v[i] *= 1.5 if i in up_idx else 0.55
    ax2.bar(range(len(v)), v, color=[GREEN if c[i] >= o[i] else RED for i in range(len(c))], alpha=0.85)
    ax2.set_ylabel("Volume")
    ax2.annotate("expands on advances", (8, v[8]), (14, v[8] * 1.25), color=GREEN,
                 fontweight="bold", arrowprops=dict(arrowstyle="->", color=GREEN, lw=1.3))
    ax2.annotate("dries up on pullbacks", (17, v[17]), (22, v[17] * 2.6), color=CYAN,
                 fontweight="bold", arrowprops=dict(arrowstyle="->", color=CYAN, lw=1.3))
    title(ax, "The healthy signature: loud advances, quiet pullbacks — accumulation")
    save(fig, "volume", 3)


# =====================================================================
# VWAP
# =====================================================================
def vwap_calc(c, v):
    return np.cumsum(c * v) / np.cumsum(v)


def vw_01():
    c = path([(78, 0.03, 0.35)], 100, seed=121)
    o, h, l, c = ohlc(c, vol=0.4, seed=121)
    v = volume_series(c, seed=121)
    vw = vwap_calc(c, v)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(vw, color=YELLOW, lw=2.0, label="VWAP")
    note(ax, (30, vw[30]), "the session's volume-weighted fair price", (8, vw[30] * 1.012))
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    ax.set_xlabel("intraday bars")
    title(ax, "VWAP: price oscillates around the day's fair value")
    save(fig, "vwap", 1)


def vw_02():
    c = path([(25, -0.22, 0.4), (12, 0.35, 0.35), (10, 0.05, 0.25), (30, 0.28, 0.35)], 97, seed=122)
    o, h, l, c = ohlc(c, vol=0.4, seed=122)
    v = volume_series(c, seed=122)
    vw = vwap_calc(c, v)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(vw, color=YELLOW, lw=2.0, label="VWAP")
    rec = next(i for i in range(26, len(c)) if c[i] > vw[i])
    note(ax, (rec, c[rec]), "VWAP reclaim", (rec - 16, c[rec] * 1.02), color=GREEN)
    rt = rec + 8 + int(np.argmin(np.abs(c[rec + 8:rec + 16] - vw[rec + 8:rec + 16])))
    note(ax, (rt, c[rt]), "retest holds from above — control flips to buyers", (rt - 6, c[rt] * 0.975), color=CYAN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    ax.set_xlabel("intraday bars")
    title(ax, "The reclaim: crossing and holding VWAP flips control of the session")
    save(fig, "vwap", 2)


def vw_03():
    c = path([(20, 0.05, 0.3), (8, 0.9, 0.45), (12, -0.5, 0.35), (20, 0.05, 0.3)], 100, seed=123)
    o, h, l, c = ohlc(c, vol=0.4, seed=123)
    v = volume_series(c, seed=123)
    vw = vwap_calc(c, v)
    fig, ax = fig1()
    candles(ax, o, h, l, c, lw=0.6)
    ax.plot(vw, color=YELLOW, lw=2.0, label="VWAP")
    pk = int(np.argmax(c))
    note(ax, (pk, c[pk]), "stretched far above VWAP", (pk - 14, c[pk] * 1.02), color=ORANGE)
    rv = pk + 8 + int(np.argmin(np.abs(c[pk + 8:pk + 16] - vw[pk + 8:pk + 16])))
    note(ax, (rv, c[rv]), "reverts to fair value", (rv + 2, c[rv] * 0.982), color=CYAN)
    ax.legend(loc="upper left", frameon=False, labelcolor=TEXT)
    ax.set_xlabel("intraday bars")
    title(ax, "Extension mean-reverts: on quiet days, distance from VWAP acts like gravity")
    save(fig, "vwap", 3)


# =====================================================================
# RSI DIVERGENCE
# =====================================================================
def rsidiv_01():
    c = path([(20, -0.95, 0.7), (9, 0.9, 0.6), (14, -0.85, 0.5), (16, 1.0, 0.7)], 120, seed=131)
    o, h, l, c = ohlc(c, seed=131)
    r = rsi(c)
    lo1 = int(np.argmin(c[:24])); lo2 = 31 + int(np.argmin(c[31:46]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ax.plot([lo1, lo2], [l[lo1], l[lo2]], color=RED, lw=1.8, ls="--")
    ax.text((lo1 + lo2) / 2, min(l[lo1], l[lo2]) * 0.988, "price: lower low", color=RED, fontsize=10.5, fontweight="bold", ha="center", va="top")
    ax2.plot([lo1, lo2], [r[lo1], r[lo2]], color=GREEN, lw=1.8, ls="--")
    ax2.text((lo1 + lo2) / 2 - 6, max(r[lo1], r[lo2]) + 8, "RSI: HIGHER low = divergence", color=GREEN, fontsize=10.5, fontweight="bold")
    title(ax, "Bullish RSI divergence: a new price low made with less momentum")
    save(fig, "rsi-divergence", 1)


def rsidiv_02():
    c = path([(22, 0.95, 0.7), (8, -0.8, 0.6), (14, 0.85, 0.5), (14, -1.0, 0.75)], 100, seed=132)
    o, h, l, c = ohlc(c, seed=132)
    r = rsi(c)
    h1 = int(np.argmax(c[:26])); h2 = 32 + int(np.argmax(c[32:46]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ax.plot([h1, h2], [h[h1], h[h2]], color=GREEN, lw=1.8, ls="--")
    ax.text((h1 + h2) / 2 - 6, max(h[h1], h[h2]) * 1.025, "price: HIGHER high", color=GREEN, fontsize=10.5, fontweight="bold")
    ax2.plot([h1, h2], [r[h1], r[h2]], color=RED, lw=1.8, ls="--")
    ax2.text((h1 + h2) / 2 - 8, min(r[h1], r[h2]) - 16, "RSI: LOWER high = divergence", color=RED, fontsize=10.5, fontweight="bold")
    zone(ax, max(h) * 0.985, max(h) * 1.005, color=RED, alpha=0.10, label="resistance")
    title(ax, "Bearish RSI divergence at resistance: the rally stretches on fading thrust")
    save(fig, "rsi-divergence", 2)


def rsidiv_03():
    c = path([(20, -0.95, 0.7), (9, 0.9, 0.6), (14, -0.85, 0.5), (24, 1.05, 0.7)], 120, seed=133)
    o, h, l, c = ohlc(c, seed=133)
    r = rsi(c)
    lo1 = int(np.argmin(c[:24])); mid = 20 + int(np.argmax(c[20:32])); lo2 = 31 + int(np.argmin(c[31:46]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    rsi_panel(ax2, r)
    ax.plot([lo1, lo2], [l[lo1], l[lo2]], color=RED, lw=1.6, ls="--")
    ax2.plot([lo1, lo2], [r[lo1], r[lo2]], color=GREEN, lw=1.6, ls="--")
    ax2.text(lo1, r[lo1] - 14, "divergence = the warning", color=GREEN, fontsize=10, fontweight="bold")
    trig = h[mid]
    ax.axhline(trig, color=YELLOW, lw=1.4, ls=":")
    bx = next(i for i in range(lo2, len(c)) if c[i] > trig)
    note(ax, (bx, c[bx]), "TRIGGER: break of the interim swing high", (bx - 20, c[bx] * 1.08))
    title(ax, "Warning + trigger: the divergence alerts, the structure break confirms")
    save(fig, "rsi-divergence", 3)


# =====================================================================
# MACD DIVERGENCE
# =====================================================================
def macddiv_01():
    c = path([(22, -0.9, 0.7), (10, 0.85, 0.6), (16, -0.75, 0.5), (18, 0.95, 0.7)], 120, seed=141)
    o, h, l, c = ohlc(c, seed=141)
    line, sig, hist = macd(c)
    lo1 = int(np.argmin(c[:26])); lo2 = 34 + int(np.argmin(c[34:50]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    ax.plot([lo1, lo2], [l[lo1], l[lo2]], color=RED, lw=1.8, ls="--")
    ax.text((lo1 + lo2) / 2 - 5, min(l[lo1], l[lo2]) * 0.955, "price: lower low", color=RED, fontsize=10.5, fontweight="bold")
    ax2.plot([lo1, lo2], [line[lo1], line[lo2]], color=GREEN, lw=1.8, ls="--")
    ax2.text(lo1 + 2, min(line) * 0.85, "MACD: higher low = divergence", color=GREEN, fontsize=10.5, fontweight="bold")
    title(ax, "Bullish MACD divergence: the second sell-off carries less momentum")
    save(fig, "macd-divergence", 1)


def macddiv_02():
    c = path([(24, 0.9, 0.7), (8, -0.75, 0.6), (16, 0.8, 0.5), (14, -1.0, 0.75)], 100, seed=142)
    o, h, l, c = ohlc(c, seed=142)
    line, sig, hist = macd(c)
    h1 = int(np.argmax(c[:28])); h2 = 34 + int(np.argmax(c[34:49]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    ax.plot([h1, h2], [h[h1], h[h2]], color=GREEN, lw=1.8, ls="--")
    ax.text((h1 + h2) / 2 - 6, max(h[h1], h[h2]) * 1.03, "price: higher high", color=GREEN, fontsize=10.5, fontweight="bold")
    ax2.plot([h1, h2], [line[h1], line[h2]], color=RED, lw=1.8, ls="--")
    ax2.text(h1, max(line) * 1.02, "MACD peaks lower; histogram shrinks first", color=RED, fontsize=10.5, fontweight="bold")
    title(ax, "Bearish MACD divergence: shrinking histogram, then a lower MACD peak")
    save(fig, "macd-divergence", 2)


def macddiv_03():
    c = path([(22, -0.9, 0.7), (10, 0.85, 0.6), (16, -0.75, 0.5), (26, 1.0, 0.7)], 120, seed=143)
    o, h, l, c = ohlc(c, seed=143)
    line, sig, hist = macd(c)
    lo1 = int(np.argmin(c[:26])); mid = 22 + int(np.argmax(c[22:34])); lo2 = 34 + int(np.argmin(c[34:50]))
    fig, ax, ax2 = fig2()
    candles(ax, o, h, l, c, lw=0.6)
    macd_panel(ax2, line, sig, hist)
    zlo = min(l[lo1], l[lo2])
    zone(ax, zlo * 0.99, zlo * 1.03, x1=lo2 + 10, color=BLUE, alpha=0.12, label="support")
    ax2.plot([lo1, lo2], [line[lo1], line[lo2]], color=GREEN, lw=1.6, ls="--")
    ax2.text(lo1 + 1, min(line) * 0.85, "1. divergence at support", color=GREEN, fontsize=10, fontweight="bold")
    crossi = next(i for i in range(lo2, len(c)) if line[i] > sig[i] and line[i - 1] <= sig[i - 1])
    ax2.plot(crossi, line[crossi], "o", color=YELLOW, ms=9, zorder=9)
    ax2.annotate("2. bullish cross", (crossi, line[crossi]), (crossi + 5, min(line) * 0.5),
                 color=YELLOW, fontweight="bold", arrowprops=dict(arrowstyle="->", color=YELLOW, lw=1.2))
    trig = h[mid]
    ax.axhline(trig, color=YELLOW, lw=1.3, ls=":")
    bx = next(i for i in range(lo2, len(c)) if c[i] > trig)
    note(ax, (bx, c[bx]), "3. structure break = entry", (bx - 18, c[bx] * 1.08))
    title(ax, "The full sequence: divergence at a level → bullish cross → price confirmation")
    save(fig, "macd-divergence", 3)


ALL = [sr_01, sr_02, sr_03, trends_01, trends_02, trends_03, tf_01, tf_02, tf_03,
       atr_01, atr_02, atr_03, bb_01, bb_02, bb_03, ema_01, ema_02, ema_03,
       macd_01, macd_02, macd_03, ma_01, ma_02, ma_03, rsi_01, rsi_02, rsi_03,
       sto_01, sto_02, sto_03, vol_01, vol_02, vol_03, vw_01, vw_02, vw_03,
       rsidiv_01, rsidiv_02, rsidiv_03, macddiv_01, macddiv_02, macddiv_03]

if __name__ == "__main__":
    import sys
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for f in ALL:
        if only and only not in f.__name__:
            continue
        try:
            f()
        except Exception as e:
            print("FAILED", f.__name__, ":", e)
