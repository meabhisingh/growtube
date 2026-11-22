/** Every injected feature can be switched on/off live from the settings. */
export type Feature = {
	start: () => void;
	stop: () => void;
};
