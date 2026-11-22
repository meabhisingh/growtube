/** DOM helpers for content scripts on youtube.com. */

/**
 * Resolves with the first element matching `selector` (now or when it
 * appears), or null after `timeoutMs`.
 */
export function waitForElement<T extends Element = HTMLElement>(
	selector: string,
	opts: { root?: ParentNode; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
	const root = opts.root ?? document;
	const existing = root.querySelector<T>(selector);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve) => {
		const target =
			root instanceof Document ? root.documentElement : (root as Node);
		const done = (el: T | null) => {
			obs.disconnect();
			clearTimeout(timer);
			resolve(el);
		};
		const obs = new MutationObserver(() => {
			const el = root.querySelector<T>(selector);
			if (el) done(el);
		});
		obs.observe(target, { childList: true, subtree: true });
		const timer = setTimeout(() => done(null), opts.timeoutMs ?? 10_000);
		opts.signal?.addEventListener("abort", () => done(null), { once: true });
	});
}

/** YouTube marks dark theme with a `dark` attribute on <html>. */
export function isYouTubeDark(): boolean {
	return document.documentElement.hasAttribute("dark");
}

/** Calls `cb(isDark)` whenever YouTube's theme flips. Returns an unsubscribe fn. */
export function onYouTubeThemeChange(cb: (dark: boolean) => void): () => void {
	const obs = new MutationObserver(() => cb(isYouTubeDark()));
	obs.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["dark"],
	});
	return () => obs.disconnect();
}
