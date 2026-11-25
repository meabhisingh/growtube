import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
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
	// .output/growtube-1.0.0-chrome.zip ({{version}} is the manifest version).
	// The hook below renames it to ...-localhost.zip when the build talks to
	// a plain-http server, so a dev ZIP can't pass for the store package.
	zip: { artifactTemplate: "growtube-{{version}}-{{browser}}.zip" },
	hooks: {
		"zip:extension:start": async (wxt) => {
			const manifest = JSON.parse(
				await readFile(resolve(wxt.config.outDir, "manifest.json"), "utf8"),
			) as { host_permissions?: string[] };
			const hosts = manifest.host_permissions ?? [];
			// `zip:store` (GROWTUBE_STORE_ZIP=1 from .env.store): refuse a build
			// whose server isn't the one in .env.store, e.g. because the shell
			// exported its own WXT_SERVER_URL (it wins over --env-file).
			if (process.env.GROWTUBE_STORE_ZIP === "1") {
				const file = parseEnv(
					await readFile(resolve(wxt.config.root, ".env.store"), "utf8"),
				);
				const expected = originPattern(file.WXT_SERVER_URL ?? "");
				if (!expected?.startsWith("https://") || !hosts.includes(expected)) {
					throw new Error(
						`Store ZIP not written: the build's host_permissions (${hosts.join(", ")}) don't include ${expected ?? "an https WXT_SERVER_URL from .env.store"}. Unset WXT_SERVER_URL in your shell and run zip:store again.`,
					);
				}
			}
			if (hosts.some((h) => h.startsWith("http://"))) {
				wxt.config.zip.artifactTemplate =
					"growtube-{{version}}-{{browser}}-localhost.zip";
			}
		},
	},
	// Function form: .env files are loaded before this runs.
	manifest: () => {
		const serverUrl = import.meta.env.WXT_SERVER_URL || DEFAULT_SERVER_URL;
		const serverPattern = originPattern(serverUrl);
		return {
			name: "GrowTube",
			short_name: "GrowTube",
			description:
				"Free YouTube creator toolkit: VPH, outliers, SEO, keyword research and an AI coach. No limits.",
			// sidePanel.open() needs 116; MAIN-world content scripts need 111.
			minimum_chrome_version: "116",
			permissions: [
				"storage",
				"unlimitedStorage",
				"sidePanel",
				// No "tabs": the code reads tab url/title only for YouTube tabs,
				// which the youtube.com host permission already exposes.
				"alarms",
				// Competitor outlier alerts (off until the user turns them on).
				// Chrome shows no install warning for it.
				"notifications",
				// Lets the background rewrite Origin/Referer on its own InnerTube
				// requests (YouTube rejects chrome-extension:// origins). No extra
				// install warning beyond the host permissions below.
				"declarativeNetRequestWithHostAccess",
			],
			host_permissions: [
				"*://*.youtube.com/*",
				"https://suggestqueries-clients6.youtube.com/*",
				...(serverPattern ? [serverPattern] : []),
			],
			// Requested at runtime for the AI provider / server URL the user picks.
			optional_host_permissions: ["https://*/*", "http://*/*"],
			// default_popup and side_panel.default_path are filled in by WXT from
			// entrypoints/popup and entrypoints/sidepanel.
			action: { default_title: "GrowTube" },
		};
	},
});
