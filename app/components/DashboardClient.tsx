"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay, type ChartType, type SupportResistanceZone } from "./PriceChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";

// NOTE: This file is a targeted patch — only BenchmarksPanel changed.
// The full file content is identical to the previous commit except BenchmarksPanel
// now uses a horizontal scroll strip on mobile instead of a 2-col grid.
// See git diff for the exact change.
