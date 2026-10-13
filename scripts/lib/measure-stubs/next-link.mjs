import { createElement } from "react";
export default function Link({ href, children, prefetch, scroll, replace, shallow, passHref, legacyBehavior, ...rest }) {
  void prefetch; void scroll; void replace; void shallow; void passHref; void legacyBehavior;
  return createElement("a", { href: typeof href === "string" ? href : href?.pathname ?? "#", ...rest }, children);
}
