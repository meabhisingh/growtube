/**
 * YouTube Studio optimizer: live SEO score, controversial keyword warnings,
 * AI titles/description/tags/thumbnail ideas and tag rank checks inside the
 * video details editor and the upload dialog. Respects
 * `features.studioOptimizer`. See components/studio/ (and SELECTORS.md).
 */
import "./style.css";

import { defineContentScript } from "#imports";

import { startStudioOptimizer } from "@/components/studio/controller";

export default defineContentScript({
	matches: ["*://studio.youtube.com/*"],
	runAt: "document_idle",
	cssInjectionMode: "ui",
	main(ctx) {
		startStudioOptimizer(ctx);
	},
});
