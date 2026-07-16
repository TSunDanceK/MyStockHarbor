 import type { CSSProperties } from "react";
import StockNewsTickerJump from "./StockNewsTickerJump";
import type { Metadata } from "next";
import Link from "next/link";
import { getStockNewsBaseData } from "@/lib/stock-news-data";
import {
  buildWhyItMatters,
  buildBeyondHeadline,
  buildWhatItMeans,
} from "@/lib/stock-news-templates";
import { getDailyHistory } from "@/lib/server/historyCache";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";
import WhyThisMatters from "./WhyThisMatters";
import AiInsightCard from "./AiInsightCard";
import { WatermarkVisibilityProvider, HideWatermarksBar, NewsScoreWatermark } from "@/app/components/WatermarkVisibility";
import {
  getLatestEarningsData,
  type LatestEarningsData,
  type EarningsPeriodSummary,
  type EarningsYearSummary,
} from "@/lib/latest-earnings-data";
import SharedLatestEarningsCard from "@/app/components/LatestEarningsCard";
