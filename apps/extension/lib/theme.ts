/**
 * Extension pages: toggles the `.dark` class (used by @open-vidiq/ui's
 * `dark:` variant) from the OS color scheme. Call once at page startup.
 *
 *   import "@/assets/tailwind.css";
 *   import { applyColorScheme } from "@/lib/theme";
 *   applyColorScheme();
 */
export function applyColorScheme(
	root: HTMLElement = document.documentElement,
): () => void {
	const mq = window.matchMedia("(prefers-color-scheme: dark)");
	const apply = () => {
		root.classList.toggle("dark", mq.matches);
		root.style.colorScheme = mq.matches ? "dark" : "light";
	};
	apply();
	mq.addEventListener("change", apply);
	return () => mq.removeEventListener("change", apply);
}
