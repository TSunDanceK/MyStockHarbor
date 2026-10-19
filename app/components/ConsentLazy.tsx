"use client";

import { Suspense, lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";

// THE COOKIE DIALOG AND ITS FOOTER LINK LOAD AFTER THE PAGE, NOT WITH IT
// (route JS budget, scripts/route-js-budget.mjs). Both render nothing until
// their region lookup answers (a network round trip), so neither their code
// nor consentClient's need be in every page's first load; the root layout
// went over its budget when they arrived. Each mounts after hydration and is
// fetched then, in parallel with the lookup it was going to wait on anyway.
// React.lazy, not next/dynamic: React is already in the framework chunk, so
// this adds no runtime of its own.
function afterHydration(Component: LazyExoticComponent<ComponentType>) {
  return function Deferred() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    return mounted ? (
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    ) : null;
  };
}

export const CookieConsent = afterHydration(lazy(() => import("./CookieConsent")));
export const CookieSettingsLink = afterHydration(lazy(() => import("./CookieSettingsLink")));
