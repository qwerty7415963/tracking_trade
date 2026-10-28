import { FloatingPnLCardRenderer } from "@tracking-auto/card-renderer";
import { chromium } from "playwright";

export function createDefaultRenderer(): FloatingPnLCardRenderer {
  // Import only; the browser launches on first render, never in unit tests.
  return new FloatingPnLCardRenderer(() => chromium.launch());
}
