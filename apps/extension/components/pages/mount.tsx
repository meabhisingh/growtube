/**
 * Boots an extension page: applies the theme before the first paint, then
 * renders `node` into #root.
 */
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initPageTheme } from "./theme";

export function mountPage(node: ReactNode): void {
	initPageTheme();
	const el = document.getElementById("root");
	if (!el) throw new Error("#root is missing");
	createRoot(el).render(<StrictMode>{node}</StrictMode>);
}
