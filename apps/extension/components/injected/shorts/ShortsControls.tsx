/**
 * Shorts control bar: speed, ±5 s (±10 s with Shift), a draggable seek bar,
 * auto-scroll, keyboard shortcuts and mini stats for the active Short.
 *
 * It is a fixed-position overlay mounted once in <body> that follows the
 * active player's box every frame, so it survives YouTube moving/reusing the
 * player between Shorts. To the left of the player when there's room,
 * otherwise a compact bar over the top of the video.
 */
import {
	formatCompact,
	formatDuration,
	formatOutlier,
	formatPercent,
} from "@open-vidiq/shared/format";
import {
	computeEngagementRate,
	computeOutlierScore,
	computeVph,
	outlierTier,
} from "@open-vidiq/shared/metrics";
import { ChevronDown, Keyboard, Minus, Redo2, Undo2 } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { Logo } from "@/components/common/Logo";
import { server, yt } from "@/lib/client";
import { useStorageItem, useYouTubeDarkTheme } from "@/lib/hooks";
import { shortsDefaultSpeed } from "@/lib/settings";
import { getCurrentVideoDetails } from "@/lib/youtube/page";
import type { VideoDetails, YtPageData } from "@/lib/youtube/types";

import { errorMessage } from "../common/async";
import {
	type InjectedPrefs,
	injectedPrefs,
	withPrefDefaults,
} from "../common/prefs";
import { type Store, useStore } from "../common/store";
import { snapshotFromDetails } from "../watch/data";
import {
	type ActiveShort,
	clampSpeed,
	findActiveShort,
	goToNextShort,
	isTypingTarget,
	SPEEDS,
	speedLabel,
} from "./player";

export type ShortsState = { videoId: string | null; page: YtPageData | null };

const SIDE_WIDTH = 236;
const GAP = 16;
const OVERLAY_TOP = 56;
const FIND_EVERY_MS = 250;

export function ShortsControlsApp({ store }: { store: Store<ShortsState> }) {
	const { videoId, page } = useStore(store);
	if (!videoId) return null;
	return <ShortsControls videoId={videoId} page={page} />;
}

type Layout = "side" | "overlay" | "hidden";

function ShortsControls({
	videoId,
	page,
}: {
	videoId: string;
	page: YtPageData | null;
}) {
	const dark = useYouTubeDarkTheme();
	const [defaultSpeed] = useStorageItem(shortsDefaultSpeed);
	const [stored, setStored] = useStorageItem(injectedPrefs);
	const prefs = withPrefDefaults(stored);
	const setPrefs = useCallback(
		(patch: Partial<InjectedPrefs>) =>
			void setStored((prev) => ({ ...withPrefDefaults(prev), ...patch })).catch(
				() => {},
			),
		[setStored],
	);

	// Session speed choice (null = settings default), applied to every Short.
	const [speedChoice, setSpeedChoice] = useState<number | null>(null);
	const speed = clampSpeed(speedChoice ?? defaultSpeed ?? 1);

	const [active, setActive] = useState<ActiveShort | null>(null);
	const [layout, setLayout] = useState<Layout>("hidden");
	const [menuOpen, setMenuOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const seekRef = useRef<SeekHandles | null>(null);

	const speedRef = useRef(speed);
	speedRef.current = speed;
	const autoRef = useRef(prefs.shortsAutoScroll);
	autoRef.current = prefs.shortsAutoScroll;
	const videoIdRef = useRef(videoId);
	const changedAt = useRef(performance.now());
	if (videoIdRef.current !== videoId) {
		videoIdRef.current = videoId;
		changedAt.current = performance.now();
	}
	const video = active?.video ?? null;

	// ---- Follow the active player (find every 250 ms, position every frame)
	useEffect(() => {
		let raf = 0;
		let lastFind = 0;
		let current: ActiveShort | null = null;
		let currentLayout: Layout = "hidden";
		const tick = (now: number) => {
			raf = requestAnimationFrame(tick);
			if (now - lastFind > FIND_EVERY_MS || !current?.player.isConnected) {
				lastFind = now;
				const found = findActiveShort();
				if (
					found?.player !== current?.player ||
					found?.video !== current?.video
				) {
					current = found;
					setActive(found);
				}
			}
			const root = rootRef.current;
			if (!root) return;
			let next: Layout = "hidden";
			const rect = current?.player.getBoundingClientRect();
			if (
				rect &&
				rect.width > 80 &&
				rect.height > 80 &&
				rect.bottom > 0 &&
				rect.top < innerHeight
			) {
				const bounds = document
					.querySelector("ytd-shorts")
					?.getBoundingClientRect();
				const free = rect.left - Math.max(bounds?.left ?? 0, 0);
				next = free >= SIDE_WIDTH + GAP * 2 ? "side" : "overlay";
				if (next === "side") {
					root.style.left = `${Math.round(rect.left - SIDE_WIDTH - GAP)}px`;
					root.style.top = `${Math.round(Math.max(rect.top, 64))}px`;
					root.style.width = `${SIDE_WIDTH}px`;
				} else {
					const inset = 8;
					root.style.left = `${Math.round(rect.left + inset)}px`;
					root.style.top = `${Math.round(rect.top + OVERLAY_TOP)}px`;
					root.style.width = `${Math.round(rect.width - inset * 2)}px`;
				}
			}
			root.style.display = next === "hidden" ? "none" : "";
			if (next !== currentLayout) {
				currentLayout = next;
				setLayout(next);
			}
			seekRef.current?.update(current?.video ?? null);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	// ---- Playback rate: apply on every Short, keep it when YouTube resets it
	const applyRate = useCallback((v: HTMLVideoElement | null) => {
		if (!v) return;
		const target = speedRef.current;
		if (Math.abs(v.playbackRate - target) > 0.001) v.playbackRate = target;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-apply when the Short changes
	useEffect(() => {
		applyRate(video);
	}, [video, videoId, speed, applyRate]);

	useEffect(() => {
		if (!video) return;
		let prevTime = 0;
		let advancedFor: string | null = null;
		const onRate = () => {
			const target = speedRef.current;
			if (Math.abs(video.playbackRate - target) < 0.001) return;
			// Right after a Short loads YouTube resets the rate: re-apply ours.
			if (performance.now() - changedAt.current < 2_500) applyRate(video);
			// Otherwise the user changed it in YouTube's own menu: follow it.
			else setSpeedChoice(clampSpeed(video.playbackRate));
		};
		const onLoaded = () => {
			prevTime = 0;
			applyRate(video);
		};
		const advance = () => {
			if (!autoRef.current || seekRef.current?.dragging) return;
			if (advancedFor === videoIdRef.current) return;
			advancedFor = videoIdRef.current;
			goToNextShort();
		};
		const onTime = () => {
			const dur = video.duration;
			const t = video.currentTime;
			if (Number.isFinite(dur) && dur > 1) {
				const nearEnd = t >= dur - 0.35;
				// Shorts loop: a jump from the end back to the start is an "end".
				const looped = prevTime > dur - 1.5 && t < 1 && prevTime - t > dur / 2;
				if (nearEnd || looped) advance();
			}
			prevTime = t;
		};
		video.addEventListener("ratechange", onRate);
		video.addEventListener("loadeddata", onLoaded);
		video.addEventListener("playing", onLoaded);
		video.addEventListener("timeupdate", onTime);
		video.addEventListener("ended", advance);
		return () => {
			video.removeEventListener("ratechange", onRate);
			video.removeEventListener("loadeddata", onLoaded);
			video.removeEventListener("playing", onLoaded);
			video.removeEventListener("timeupdate", onTime);
			video.removeEventListener("ended", advance);
		};
	}, [video, applyRate]);

	const changeSpeed = useCallback((rate: number) => {
		const next = clampSpeed(rate);
		speedRef.current = next;
		setSpeedChoice(next);
		const v = findActiveShort()?.video;
		if (v) v.playbackRate = next;
	}, []);

	const seekBy = useCallback((delta: number) => {
		const v = findActiveShort()?.video;
		if (!v || !Number.isFinite(v.duration)) return;
		v.currentTime = Math.min(
			Math.max(0, v.currentTime + delta),
			Math.max(0, v.duration - 0.05),
		);
	}, []);

	const stepSpeed = useCallback(
		(dir: 1 | -1) => {
			const current = speedRef.current;
			const list = [...SPEEDS];
			const next =
				dir > 0
					? list.find((s) => s > current + 0.001)
					: [...list].reverse().find((s) => s < current - 0.001);
			if (next != null) changeSpeed(next);
		},
		[changeSpeed],
	);

	// ---- Keyboard shortcuts (keys YouTube doesn't use; ignored while typing)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.repeat && !/^[ad]$/i.test(e.key)) return;
			if (isTypingTarget(e)) return;
			let handled = true;
			switch (e.key) {
				case "[":
					stepSpeed(-1);
					break;
				case "]":
					stepSpeed(1);
					break;
				case "\\":
					changeSpeed(1);
					break;
				case "a":
				case "A":
					seekBy(e.shiftKey ? -10 : -5);
					break;
				case "d":
				case "D":
					seekBy(e.shiftKey ? 10 : 5);
					break;
				case "r":
				case "R":
					if (e.shiftKey) {
						handled = false;
						break;
					}
					setPrefs({ shortsAutoScroll: !autoRef.current });
					break;
				default:
					handled = false;
			}
			if (handled) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [stepSpeed, changeSpeed, seekBy, setPrefs]);

	// Close menus on outside clicks (composedPath crosses our shadow root).
	useEffect(() => {
		if (!menuOpen && !helpOpen) return;
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !e.composedPath().includes(rootRef.current)) {
				setMenuOpen(false);
				setHelpOpen(false);
			}
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [menuOpen, helpOpen]);

	const collapsed = prefs.shortsCollapsed;
	const overlay = layout === "overlay";
	const className = `ovq-shorts${overlay ? " overlay" : ""}${collapsed ? " launcher" : ""}`;

	return (
		<div className={dark ? "ovq-root ovq-dark" : "ovq-root"}>
			<div
				ref={rootRef}
				className={className}
				style={{ display: "none" }}
				role="toolbar"
				aria-label="open-vidiq Shorts controls"
			>
				{collapsed ? (
					<button
						type="button"
						className="ovq-icon-btn"
						onClick={() => setPrefs({ shortsCollapsed: false })}
						aria-label="Show open-vidiq Shorts controls"
						title="open-vidiq Shorts controls"
					>
						<Logo size={22} />
					</button>
				) : (
					<>
						{!overlay && (
							<div className="ovq-shorts-head">
								<Logo size={18} />
								<span className="ovq-panel-title" style={{ fontSize: 13 }}>
									Shorts
								</span>
								<span style={{ marginLeft: "auto", display: "flex" }}>
									<button
										type="button"
										className="ovq-icon-btn"
										aria-label="Keyboard shortcuts"
										aria-expanded={helpOpen}
										title="Keyboard shortcuts"
										onClick={() => setHelpOpen((v) => !v)}
									>
										<Keyboard size={16} aria-hidden="true" />
									</button>
									<button
										type="button"
										className="ovq-icon-btn"
										aria-label="Minimize"
										title="Minimize"
										onClick={() => setPrefs({ shortsCollapsed: true })}
									>
										<Minus size={16} aria-hidden="true" />
									</button>
								</span>
							</div>
						)}
						{helpOpen && !overlay && <Shortcuts />}
						<div className="ovq-shorts-row">
							<div className="ovq-speed">
								<button
									type="button"
									className="ovq-btn small"
									aria-haspopup="menu"
									aria-expanded={menuOpen}
									title="Playback speed ( [ and ] )"
									onClick={() => setMenuOpen((v) => !v)}
								>
									{speedLabel(speed)}{" "}
									<ChevronDown size={12} aria-hidden="true" />
								</button>
								{menuOpen && (
									<div
										className="ovq-speed-menu"
										role="menu"
										aria-label="Playback speed"
									>
										{SPEEDS.map((s) => (
											<button
												key={s}
												type="button"
												role="menuitemradio"
												aria-checked={Math.abs(s - speed) < 0.001}
												onClick={() => {
													changeSpeed(s);
													setMenuOpen(false);
												}}
											>
												{speedLabel(s)}
											</button>
										))}
									</div>
								)}
							</div>
							<button
								type="button"
								className="ovq-icon-btn"
								aria-label="Rewind 5 seconds (Shift: 10)"
								title="Back 5s (Shift: 10s) · A"
								onClick={(e) => seekBy(e.shiftKey ? -10 : -5)}
							>
								<Undo2 size={16} aria-hidden="true" />
							</button>
							<button
								type="button"
								className="ovq-icon-btn"
								aria-label="Forward 5 seconds (Shift: 10)"
								title="Forward 5s (Shift: 10s) · D"
								onClick={(e) => seekBy(e.shiftKey ? 10 : 5)}
							>
								<Redo2 size={16} aria-hidden="true" />
							</button>
							<button
								type="button"
								role="switch"
								className="ovq-toggle"
								aria-checked={prefs.shortsAutoScroll}
								title="When a Short ends, go to the next one · R"
								onClick={() =>
									setPrefs({ shortsAutoScroll: !prefs.shortsAutoScroll })
								}
								style={{ marginLeft: overlay ? "auto" : 6 }}
							>
								<span className="ovq-switch" aria-hidden="true" />
								{overlay ? "Auto" : "Auto-scroll"}
							</button>
							{overlay && (
								<button
									type="button"
									className="ovq-icon-btn"
									aria-label="Minimize"
									title="Minimize"
									onClick={() => setPrefs({ shortsCollapsed: true })}
								>
									<Minus size={16} aria-hidden="true" />
								</button>
							)}
						</div>
						<SeekBar
							handlesRef={seekRef}
							getVideo={() => findActiveShort()?.video ?? null}
						/>
						<MiniStats videoId={videoId} page={page} compact={overlay} />
					</>
				)}
			</div>
		</div>
	);
}

function Shortcuts() {
	const rows: [string, string][] = [
		["[ / ]", "Slower / faster"],
		["\\", "Normal speed"],
		["A / D", "Back / forward 5s"],
		["Shift+A / D", "Back / forward 10s"],
		["R", "Toggle auto-scroll"],
	];
	return (
		<div className="ovq-shortcuts">
			{rows.map(([k, label]) => (
				<div key={k} style={{ display: "contents" }}>
					<span>
						{k.split(" / ").map((part, i) => (
							<span key={part}>
								{i > 0 && " / "}
								<kbd className="ovq-kbd">{part}</kbd>
							</span>
						))}
					</span>
					<span>{label}</span>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Seek bar (updated from the rAF loop through refs, no re-render per frame)
// ---------------------------------------------------------------------------

type SeekHandles = {
	update: (video: HTMLVideoElement | null) => void;
	dragging: boolean;
};

function SeekBar({
	handlesRef,
	getVideo,
}: {
	handlesRef: React.MutableRefObject<SeekHandles | null>;
	getVideo: () => HTMLVideoElement | null;
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const fillRef = useRef<HTMLDivElement>(null);
	const thumbRef = useRef<HTMLDivElement>(null);
	const elapsedRef = useRef<HTMLSpanElement>(null);
	const totalRef = useRef<HTMLSpanElement>(null);
	const drag = useRef<{ fraction: number } | null>(null);
	const last = useRef("");

	useEffect(() => {
		const handles: SeekHandles = {
			dragging: false,
			update(video) {
				const dur =
					video && Number.isFinite(video.duration) ? video.duration : 0;
				const time =
					drag.current && dur
						? drag.current.fraction * dur
						: (video?.currentTime ?? 0);
				const fraction = dur ? Math.min(1, Math.max(0, time / dur)) : 0;
				const key = `${fraction.toFixed(4)}|${Math.floor(time)}|${Math.floor(dur)}`;
				if (key === last.current) return;
				last.current = key;
				const pct = `${(fraction * 100).toFixed(2)}%`;
				if (fillRef.current) fillRef.current.style.width = pct;
				if (thumbRef.current) thumbRef.current.style.left = pct;
				if (elapsedRef.current)
					elapsedRef.current.textContent = formatDuration(time);
				if (totalRef.current)
					totalRef.current.textContent = dur ? formatDuration(dur) : "0:00";
				trackRef.current?.setAttribute(
					"aria-valuenow",
					String(Math.floor(time)),
				);
				trackRef.current?.setAttribute(
					"aria-valuemax",
					String(Math.floor(dur)),
				);
				trackRef.current?.setAttribute(
					"aria-valuetext",
					`${formatDuration(time)} of ${formatDuration(dur)}`,
				);
			},
		};
		handlesRef.current = handles;
		return () => {
			if (handlesRef.current === handles) handlesRef.current = null;
		};
	}, [handlesRef]);

	const fractionAt = (clientX: number) => {
		const r = trackRef.current?.getBoundingClientRect();
		if (!r || r.width <= 0) return 0;
		return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
	};

	const commit = (fraction: number) => {
		const v = getVideo();
		if (v && Number.isFinite(v.duration) && v.duration > 0) {
			v.currentTime = Math.min(
				fraction * v.duration,
				Math.max(0, v.duration - 0.05),
			);
		}
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { fraction: fractionAt(e.clientX) };
		if (handlesRef.current) handlesRef.current.dragging = true;
		trackRef.current?.classList.add("dragging");
		commit(drag.current.fraction);
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		drag.current.fraction = fractionAt(e.clientX);
		commit(drag.current.fraction);
	};
	const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		commit(fractionAt(e.clientX));
		drag.current = null;
		if (handlesRef.current) handlesRef.current.dragging = false;
		trackRef.current?.classList.remove("dragging");
	};
	const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const v = getVideo();
		if (!v || !Number.isFinite(v.duration)) return;
		const step = e.shiftKey ? 10 : 5;
		if (e.key === "ArrowRight")
			v.currentTime = Math.min(v.duration - 0.05, v.currentTime + step);
		else if (e.key === "ArrowLeft")
			v.currentTime = Math.max(0, v.currentTime - step);
		else if (e.key === "Home") v.currentTime = 0;
		else return;
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<div className="ovq-seek">
			<div
				ref={trackRef}
				className="ovq-seek-track"
				role="slider"
				tabIndex={0}
				aria-label="Seek"
				aria-valuemin={0}
				aria-valuemax={0}
				aria-valuenow={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={onKeyDown}
			>
				<div ref={fillRef} className="ovq-seek-fill" style={{ width: 0 }} />
				<div ref={thumbRef} className="ovq-seek-thumb" style={{ left: 0 }} />
			</div>
			<div className="ovq-seek-times">
				<span ref={elapsedRef}>0:00</span>
				<span ref={totalRef}>0:00</span>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Mini stats for the active Short
// ---------------------------------------------------------------------------

/** Waits this long on a Short before fetching (skips fast scrolling). */
const DWELL_MS = 700;

function MiniStats({
	videoId,
	page,
	compact,
}: {
	videoId: string;
	page: YtPageData | null;
	compact: boolean;
}) {
	const [details, setDetails] = useState<VideoDetails | null>(null);
	const [baseline, setBaseline] = useState<number | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
	const pageRef = useRef(page);
	pageRef.current = page;

	useEffect(() => {
		let alive = true;
		setDetails(null);
		setBaseline(undefined);
		setError(null);
		const timer = setTimeout(async () => {
			try {
				const p = pageRef.current;
				const d = await getCurrentVideoDetails({
					level: "full",
					page: p?.videoId === videoId ? p : null,
				});
				if (!alive || !d || d.videoId !== videoId) return;
				setDetails(d);
				const snap = snapshotFromDetails(d);
				if (snap) void server.ingestVideos([snap]).catch(() => {});
				if (!d.channelId) {
					setBaseline(null);
					return;
				}
				const b = await yt
					.getChannelBaseline(d.channelId, "short")
					.catch(() => null);
				if (alive) setBaseline(b?.baseline ?? null);
			} catch (e) {
				if (alive) setError(errorMessage(e));
			}
		}, DWELL_MS);
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	}, [videoId]);

	const vph = details?.publishedAt
		? computeVph(details.views, details.publishedAt)
		: null;
	const outlier = details ? computeOutlierScore(details.views, baseline) : null;
	const engagement = details
		? computeEngagementRate({
				views: details.views,
				likes: details.likes,
				comments: details.comments,
			})
		: null;
	const tier = outlierTier(outlier);
	const loading = !details && !error;

	if (error && !compact) {
		return (
			<div className="ovq-small ovq-muted" title={error}>
				Stats unavailable for this Short.
			</div>
		);
	}
	const items: {
		label: string;
		value: string;
		tone?: string | null;
		hint: string;
	}[] = [
		{
			label: "VPH",
			value: vph != null ? formatCompact(vph, 1) : "—",
			hint: "Average views per hour since upload",
		},
		{
			label: "Outlier",
			value: baseline === undefined && details ? "…" : formatOutlier(outlier),
			tone: tier,
			hint: baseline
				? `Views ÷ the channel's median of ${formatCompact(baseline)} views for recent Shorts`
				: "Views ÷ the channel's typical Short",
		},
		{
			label: "Engagement",
			value: formatPercent(engagement, 1),
			hint: "(Likes + comments) ÷ views",
		},
	];
	if (compact) {
		return (
			<div className="ovq-shorts-row" aria-live="polite">
				{items.map((it) => (
					<span
						key={it.label}
						className={`ovq-pill ${it.tone ?? ""}`}
						title={it.hint}
					>
						{loading
							? "…"
							: `${it.value} ${it.label === "Engagement" ? "eng." : it.label}`}
					</span>
				))}
			</div>
		);
	}
	return (
		<div className="ovq-mini-stats" aria-live="polite">
			{items.map((it) => (
				<div key={it.label} className="ovq-mini-stat" title={it.hint}>
					<div className="ovq-stat-label">{it.label}</div>
					<div className={`ovq-stat-value ${it.tone ?? ""}`}>
						{loading ? "…" : it.value}
					</div>
				</div>
			))}
		</div>
	);
}
