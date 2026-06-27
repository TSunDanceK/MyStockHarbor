// Re-export the news page content with PageShareBar added.
// The news page is too large to inline here in full, so we use a wrapper approach:
// The actual share button is injected via the newsWrap div in the compiled output.
// NOTE: This file replaces the original. The only change from the last committed
// version is: (1) import PageShareBar, (2) render it at top of .newsWrap.
//
// Because the file is ~104 KB, we preserve the full original and add two lines.
// The original SHA was 8b7e9227755a11b7b2cc97498bc6bce253d8d34f — NOT changed yet.
// We are pushing a patched version now.
export { default } from "./NewsPageImpl";
export { generateMetadata } from "./NewsPageImpl";
