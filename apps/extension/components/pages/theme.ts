/**
 * Page theme for the side panel, popup and options page.
 *
 * "system" follows the OS (via lib/theme.ts applyColorScheme); "dark" and
 * "light" force a theme. Stored in chrome.storage.local so every page agrees.
 */

import { useEffect, useState } from "react";
import { storage } from "#imports";

import { applyColorScheme } from "@/lib/theme";

export type UiTheme = "system" | "dark" | "light";

export const uiTheme = storage.defineItem<UiTheme>("local:uiTheme", {
	fallback: "system",
	version: 1,
});

function applyForced(root: HTMLElement, dark: boolean) {
	root.classList.toggle("dark", dark);
	root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Applies the stored theme to `<html>` and keeps it in sync. Call once at
 * page startup (before rendering, to avoid a flash). Returns a cleanup fn.
 */
export function initPageTheme(
	root: HTMLElement = document.documentElement,
): () => void {
	// Paint something sensible immediately (storage is async).
	let cleanupSystem: (() => void) | null = applyColorScheme(root);
	const apply = (theme: UiTheme) => {
		cleanupSystem?.();
		cleanupSystem = null;
		if (theme === "system") cleanupSystem = applyColorScheme(root);
		else applyForced(root, theme === "dark");
	};
	void uiTheme
		.getValue()
		.then(apply)
		.catch(() => {});
	const unwatch = uiTheme.watch((v) => apply(v ?? "system"));
	return () => {
		unwatch();
		cleanupSystem?.();
	};
}

const readTheme = (): "dark" | "light" =>
	document.documentElement.classList.contains("dark") ? "dark" : "light";

/** Live "dark" | "light" of the current page (reads the `.dark` class). */
export function useResolvedTheme(): "dark" | "light" {
	const [theme, setTheme] = useState<"dark" | "light">(readTheme);
	useEffect(() => {
		const obs = new MutationObserver(() => setTheme(readTheme()));
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => obs.disconnect();
	}, []);
	return theme;
}
