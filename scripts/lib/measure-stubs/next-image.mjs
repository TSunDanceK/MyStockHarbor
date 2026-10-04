import { createElement } from "react";
export default function Image({ src, alt, width, height, priority, quality, placeholder, ...rest }) {
  void priority; void quality; void placeholder;
  return createElement("img", { src: typeof src === "string" ? src : src?.src, alt, width, height, ...rest });
}
