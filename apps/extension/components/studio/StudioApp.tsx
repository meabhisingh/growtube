/** Root component rendered into the shadow root; follows the controller's store. */
import { useSyncExternalStore } from "react";
import { StudioPanel } from "./StudioPanel";
import type { PanelHostState, Store } from "./store";

export function StudioApp({
	store,
	host,
}: {
	store: Store<PanelHostState>;
	host: Element;
}) {
	const state = useSyncExternalStore(store.subscribe, store.get);
	if (!state.target) return null;
	return (
		<StudioPanel
			key={state.targetKey}
			{...state}
			target={state.target}
			host={host}
		/>
	);
}
