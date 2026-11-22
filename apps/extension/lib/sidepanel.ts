/**
 * Opening the side panel from an EXTENSION PAGE (popup, options).
 * Content scripts use `ext.openSidePanel(context)` from `@/lib/client` instead.
 *
 *   <Button onClick={() => openSidePanelFromPage({ tool: "keywords" })}>Keyword research</Button>
 *
 * Must run in a click handler (Chrome requires a user gesture).
 */
import { browser } from "wxt/browser";

import { type CurrentContext, currentContext } from "./context";

export async function openSidePanelFromPage(
	context?: CurrentContext | null,
	opts: { closePopup?: boolean } = {},
): Promise<void> {
	// Kick off open() first, while the gesture is fresh; write the context in
	// parallel (the side panel watches it, so order doesn't matter).
	const opening = browser.windows
		.getCurrent()
		.then((w) =>
			w.id != null ? browser.sidePanel.open({ windowId: w.id }) : undefined,
		);
	if (context !== undefined) {
		await currentContext.setValue(
			context ? { ...context, at: Date.now() } : null,
		);
	}
	await opening;
	if (opts.closePopup) window.close();
}
