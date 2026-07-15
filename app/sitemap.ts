import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllVideoIds } from "@/lib/videoContent";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import { LESSONS } from "@/app/learn/lessons";

const baseUrl = "https://www.mystockharbor.com";

const mainPages = [
  { path: "", changeFrequency: "daily" as const, priority: 1 },
  { path: "/dashboard", changeFrequency: "daily" as const, priority: 0.95 },
  { path: "/learn", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/pickers", changeFrequency: "daily" as const, priority: 0.9 },
  { path: "/utilities", changeFrequency: "weekly" as const, priority: 0.7 },
  { path: "/insights", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/bottlenecks", changeFrequency: "daily" as const, priority: 0.85 },
  { path: "/upcoming-ipos", changeFrequency: "daily" as const, priority: 0.75 },
  { path: "/headlines", changeFrequency: "hourly" as const, priority: 0.8 },
  { path: "/about", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/contact", changeFrequency: "monthly" as const, priority: 0.5 },
  { path: "/privacy-policy", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/affiliate-disclosure", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/risk-disclaimer", changeFrequency: "monthly" as const, priority: 0.4 },
];

const marketPages = [
  // Market overview / analysis pages
  "/markets/spx",
];

const seoGuides = [
  "/how-to-read-st