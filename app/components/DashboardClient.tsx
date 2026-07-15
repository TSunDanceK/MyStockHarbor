"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay, type ChartType, type SupportResistanceZone } from "./PriceChart";
import TradingViewChartEmbed from "./TradingViewChartEmbed";
import InteractiveChart from "./InteractiveChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";
import DiscoveryStrip from "./DiscoveryStrip";
import DashboardTicker from "./DashboardTicker";

type Quote = { symbol: string; price: number | null; date: string | null; time: string | null; source: string; };
type Point = { date: string; open?: number; close: number; high?: number; low?: number; volume?: number; };
type ChartInterval = "d" | "w" | "m";
type ChartMode = "basic" | "interactive" | "tradingview";
type SymbolResult = { symbol: string; name: string; exchange: string };
