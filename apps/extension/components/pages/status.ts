/** Live status hooks shared by the popup, options page and side panel. */
import { useBackground, useStorageItem } from "@/lib/hooks";
import { aiProvider, serverUrl } from "@/lib/settings";

/** AI provider status, refreshed whenever the provider settings change. */
export function useAiStatus() {
	const [provider] = useStorageItem(aiProvider);
	return useBackground("ai.status", {}, [
		provider.baseURL,
		provider.apiKey,
		provider.model,
		provider.imageModel,
		provider.presetId,
	]);
}

/** open-vidiq server health check, re-run when the server URL changes. */
export function useServerHealth() {
	const [url] = useStorageItem(serverUrl);
	return useBackground("api.health", {}, [url]);
}
