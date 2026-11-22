import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

const DEFAULT_SERVER_URL = "http://localhost:3000";

/** "http://localhost:3000" -> "http://localhost/*" (match patterns ignore ports). */
function originPattern(url: string): string | null {
	try {
		const u = new URL(url);
		return u.protocol === "http:" || u.protocol === "https:"
			? `${u.protocol}//${u.hostname}/*`
			: null;
	} catch {
		return null;
	}
}

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	// Function form: .env files are loaded before this runs.
	manifest: () => {
		const serverUrl = import.meta.env.WXT_SERVER_URL || DEFAULT_SERVER_URL;
		const serverPattern = originPattern(serverUrl);
		return {
			name: "open-vidiq",
			short_name: "open-vidiq",
			description:
				"Free YouTube creator toolkit: VPH, outliers, SEO, keyword research and an AI coach. No limits.",
			// sidePanel.open() needs 116; MAIN-world content scripts need 111.
			minimum_chrome_version: "116",
			permissions: [
				"storage",
				"unlimitedStorage",
				"sidePanel",
				"tabs",
				"alarms",
				// Lets the background rewrite Origin/Referer on its own InnerTube
				// requests (YouTube rejects chrome-extension:// origins). No extra
				// install warning beyond the host permissions below.
				"declarativeNetRequestWithHostAccess",
			],
			host_permissions: [
				"*://*.youtube.com/*",
				"https://suggestqueries-clients6.youtube.com/*",
				"https://i.ytimg.com/*",
				...(serverPattern ? [serverPattern] : []),
			],
			// Requested at runtime for the AI provider / server URL the user picks.
			optional_host_permissions: ["https://*/*", "http://*/*"],
			// default_popup and side_panel.default_path are filled in by WXT from
			// entrypoints/popup and entrypoints/sidepanel.
			action: { default_title: "open-vidiq" },
		};
	},
});
