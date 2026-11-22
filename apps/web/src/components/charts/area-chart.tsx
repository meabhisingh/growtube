import { formatCompact, formatNumber } from "@open-vidiq/shared";
import { cn } from "@open-vidiq/ui/lib/utils";
import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

/**
 * Hand-rolled responsive SVG area/line chart for time series.
 *
 * - Width follows the container (ResizeObserver); height is fixed.
 * - Nice y-axis ticks formatted with `formatCompact`, adaptive time ticks.
 * - Hover / touch-scrub tooltip with the exact value and timestamp.
 * - Accessible: the SVG is `role="img"` with a generated summary, and a
 *   visually hidden range input lets keyboard and screen-reader users step
 *   through every data point (arrow keys, Home/End).
 * - Colors come from theme tokens, so it works in light and dark mode.
 */

export interface ChartPoint {
	/** Timestamp in ms since epoch. */
	t: number;
	value: number;
}

export interface AreaChartProps {
	data: readonly ChartPoint[];
	/** Series name used in the tooltip and accessible summary, e.g. "Views". */
	label: string;
	/** Replaces the generated accessible summary. */
	ariaLabel?: string;
	variant?: "area" | "line";
	/** Height in px (default 240). */
	height?: number;
	/** Any CSS color (default: the theme's `--chart-2`). */
	color?: string;
	/** Exact value shown in the tooltip (default: `formatNumber`). */
	formatValue?: (value: number) => string;
	/**
	 * Y-axis tick labels. Defaults to `formatCompact` with just enough
	 * decimals to keep neighbouring ticks distinct (4.15M vs 4.2M).
	 */
	formatAxisValue?: (value: number) => string;
	/** "datetime" for snapshots, "date" for daily (UTC) data. */
	timeFormat?: "datetime" | "date";
	/** Start the y-axis at zero instead of fitting the data range. */
	zeroBaseline?: boolean;
	className?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MARGIN = { top: 12, right: 14, bottom: 24 };
const TOOLTIP_EDGE = 88;

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});
const utcDateFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeZone: "UTC",
});
const localDateFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(Math.round(entry.contentRect.width));
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

function niceStep(range: number, count: number): number {
	const raw = range / Math.max(count, 1);
	if (!Number.isFinite(raw) || raw <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const normalized = raw / magnitude;
	const factor =
		normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
	return factor * magnitude;
}

function niceTicks(
	min: number,
	max: number,
	count: number,
	nonNegative: boolean,
): { lo: number; hi: number; ticks: number[] } {
	let lo = min;
	let hi = max;
	if (lo === hi) {
		const pad = Math.abs(lo) * 0.1 || 1;
		lo -= pad;
		hi += pad;
	}
	if (nonNegative) lo = Math.max(lo, 0);
	let step = niceStep(hi - lo, count);
	// Counts don't have fractional ticks unless the whole range is tiny.
	if (hi - lo >= count) step = Math.max(step, 1);
	lo = Math.floor(lo / step) * step;
	hi = Math.ceil(hi / step) * step;
	if (hi === lo) hi = lo + step;
	const ticks: number[] = [];
	for (let i = 0; lo + i * step <= hi + step / 2; i++) {
		ticks.push(Number((lo + i * step).toPrecision(12)));
	}
	return { lo, hi, ticks };
}

function distinctCompactLabels(ticks: readonly number[]): string[] {
	let labels: string[] = [];
	for (let digits = 1; digits <= 3; digits++) {
		labels = ticks.map((t) => formatCompact(t, digits));
		if (new Set(labels).size === labels.length) break;
	}
	return labels;
}

function timeTickFormatter(span: number, utc: boolean): Intl.DateTimeFormat {
	const timeZone = utc ? "UTC" : undefined;
	if (span <= 1.5 * DAY_MS) {
		return new Intl.DateTimeFormat(undefined, {
			hour: "numeric",
			minute: "2-digit",
			timeZone,
		});
	}
	if (span <= 240 * DAY_MS) {
		return new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			timeZone,
		});
	}
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "numeric",
		timeZone,
	});
}

function estimateTextWidth(text: string): number {
	return text.length * 6.2;
}

interface Geometry {
	left: number;
	top: number;
	innerW: number;
	innerH: number;
	xs: number[];
	ys: number[];
	linePath: string;
	areaPath: string;
	yTicks: { value: number; y: number; label: string }[];
	xTicks: {
		t: number;
		x: number;
		label: string;
		anchor: "start" | "middle" | "end";
	}[];
}

function computeGeometry(
	series: readonly ChartPoint[],
	width: number,
	height: number,
	opts: {
		zeroBaseline: boolean;
		utc: boolean;
		formatAxisValue: ((value: number) => string) | undefined;
	},
): Geometry | null {
	const first = series[0];
	const last = series.at(-1);
	if (!first || !last || width <= 0) return null;

	let minV = first.value;
	let maxV = first.value;
	for (const p of series) {
		if (p.value < minV) minV = p.value;
		if (p.value > maxV) maxV = p.value;
	}
	if (opts.zeroBaseline) minV = Math.min(0, minV);

	const innerH = Math.max(height - MARGIN.top - MARGIN.bottom, 20);
	const tickCount = innerH < 140 ? 3 : 4;
	const { lo, hi, ticks } = niceTicks(minV, maxV, tickCount, minV >= 0);
	const labels = opts.formatAxisValue
		? ticks.map(opts.formatAxisValue)
		: distinctCompactLabels(ticks);
	const left = Math.ceil(Math.max(28, ...labels.map(estimateTextWidth)) + 10);
	const top = MARGIN.top;
	const innerW = Math.max(width - left - MARGIN.right, 20);

	let t0 = first.t;
	let t1 = last.t;
	if (t1 - t0 < 1) {
		t0 -= opts.utc ? DAY_MS : HOUR_MS;
		t1 += opts.utc ? DAY_MS : HOUR_MS;
	}
	const span = t1 - t0;
	const xOf = (t: number) => left + ((t - t0) / span) * innerW;
	const yOf = (v: number) => top + innerH - ((v - lo) / (hi - lo)) * innerH;

	const xs = series.map((p) => xOf(p.t));
	const ys = series.map((p) => yOf(p.value));
	const linePath = xs
		.map(
			(x, i) =>
				`${i === 0 ? "M" : "L"}${x.toFixed(2)},${(ys[i] ?? 0).toFixed(2)}`,
		)
		.join("");
	const baseY = (top + innerH).toFixed(2);
	const firstX = (xs[0] ?? left).toFixed(2);
	const lastX = (xs.at(-1) ?? left).toFixed(2);
	const areaPath = `${linePath}L${lastX},${baseY}L${firstX},${baseY}Z`;

	const xTickCount = Math.max(2, Math.min(6, Math.floor(innerW / 96) + 1));
	const tickFormat = timeTickFormatter(span, opts.utc);
	const xTicks = Array.from({ length: xTickCount }, (_, i) => {
		const t = t0 + (span * i) / (xTickCount - 1);
		const anchor: "start" | "middle" | "end" =
			i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle";
		return { t, x: xOf(t), label: tickFormat.format(t), anchor };
	});
	// Drop neighbours that would print the same label (e.g. short spans).
	const dedupedXTicks = xTicks.filter(
		(tick, i) => i === 0 || tick.label !== xTicks[i - 1]?.label,
	);

	return {
		left,
		top,
		innerW,
		innerH,
		xs,
		ys,
		linePath,
		areaPath,
		yTicks: ticks.map((value, i) => ({
			value,
			y: yOf(value),
			label: labels[i] ?? "",
		})),
		xTicks: dedupedXTicks,
	};
}

function nearestIndex(xs: readonly number[], x: number): number {
	let lo = 0;
	let hi = xs.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if ((xs[mid] ?? 0) < x) lo = mid;
		else hi = mid;
	}
	return Math.abs((xs[lo] ?? 0) - x) <= Math.abs((xs[hi] ?? 0) - x) ? lo : hi;
}

function summarize(
	series: readonly ChartPoint[],
	label: string,
	formatValue: (value: number) => string,
	formatTime: (t: number) => string,
): string {
	const first = series[0];
	const last = series.at(-1);
	if (!first || !last) return `${label} chart with no data.`;
	if (series.length === 1) {
		return `${label} chart with one data point: ${formatValue(first.value)} on ${formatTime(first.t)}.`;
	}
	const peak = series.reduce((m, p) => Math.max(m, p.value), first.value);
	const trend =
		last.value > first.value
			? `rose from ${formatValue(first.value)} to ${formatValue(last.value)}`
			: last.value < first.value
				? `fell from ${formatValue(first.value)} to ${formatValue(last.value)}`
				: `held at ${formatValue(first.value)}`;
	return `${label} chart, ${series.length} data points from ${formatTime(first.t)} to ${formatTime(last.t)}. ${label} ${trend}, peaking at ${formatValue(peak)}.`;
}

export function AreaChart({
	data,
	label,
	ariaLabel,
	variant = "area",
	height = 240,
	color = "var(--chart-2)",
	formatValue = formatNumber,
	formatAxisValue,
	timeFormat = "datetime",
	zeroBaseline = false,
	className,
}: AreaChartProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const width = useElementWidth(containerRef);
	const gradientId = `ovq-area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const [active, setActive] = useState<number | null>(null);

	const utc = timeFormat === "date";
	const formatTime = (t: number) =>
		(utc ? utcDateFormat : dateTimeFormat).format(t);

	const series = useMemo(
		() =>
			data
				.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
				.sort((a, b) => a.t - b.t),
		[data],
	);

	const geo = useMemo(
		() =>
			computeGeometry(series, width, height, {
				zeroBaseline,
				utc,
				formatAxisValue,
			}),
		[series, width, height, zeroBaseline, utc, formatAxisValue],
	);

	const count = series.length;
	const activeIndex = active != null && active < count ? active : null;
	const activePoint = activeIndex != null ? series[activeIndex] : undefined;
	const summary =
		ariaLabel ??
		summarize(series, label, formatValue, (t) => utcOrLocalDate(t, utc));

	function handlePointer(event: ReactPointerEvent<HTMLDivElement>) {
		const el = containerRef.current;
		if (!el || !geo || count === 0) return;
		const x = event.clientX - el.getBoundingClientRect().left;
		setActive(nearestIndex(geo.xs, x));
	}

	const ax = activeIndex != null ? geo?.xs[activeIndex] : undefined;
	const ay = activeIndex != null ? geo?.ys[activeIndex] : undefined;
	const tooltipShift =
		ax == null
			? "-50%"
			: ax < TOOLTIP_EDGE
				? "0%"
				: ax > width - TOOLTIP_EDGE
					? "-100%"
					: "-50%";
	const tooltipBelow =
		geo != null && ay != null && ay < geo.top + geo.innerH * 0.4;
	const focusIndex = activeIndex ?? count - 1;
	const focusPoint = series[focusIndex];

	return (
		<div
			ref={containerRef}
			className={cn(
				"ring-ring/60 relative w-full touch-pan-y outline-none select-none has-[input:focus-visible]:ring-1",
				className,
			)}
			style={{ height }}
			onPointerMove={handlePointer}
			onPointerDown={handlePointer}
			onPointerLeave={() => setActive(null)}
			onPointerCancel={() => setActive(null)}
		>
			{count === 0 && (
				<div className="text-muted-foreground flex h-full items-center justify-center border border-dashed text-xs">
					No data to chart yet
				</div>
			)}

			{geo && (
				<svg
					width={width}
					height={height}
					role="img"
					aria-label={summary}
					className="block overflow-visible"
				>
					<defs>
						<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stopColor={color} stopOpacity={0.32} />
							<stop offset="100%" stopColor={color} stopOpacity={0.02} />
						</linearGradient>
					</defs>

					{geo.yTicks.map((tick, i) => (
						<g key={tick.value}>
							<line
								x1={geo.left}
								x2={geo.left + geo.innerW}
								y1={tick.y}
								y2={tick.y}
								className="stroke-border"
								strokeDasharray={i === 0 ? undefined : "3 4"}
								shapeRendering="crispEdges"
							/>
							<text
								x={geo.left - 8}
								y={tick.y}
								dy="0.32em"
								textAnchor="end"
								className="fill-muted-foreground text-[10px] tabular-nums"
							>
								{tick.label}
							</text>
						</g>
					))}

					{geo.xTicks.map((tick) => (
						<text
							key={tick.t}
							x={tick.x}
							y={height - 6}
							textAnchor={tick.anchor}
							className="fill-muted-foreground text-[10px] tabular-nums"
						>
							{tick.label}
						</text>
					))}

					{variant === "area" && count > 1 && (
						<path d={geo.areaPath} fill={`url(#${gradientId})`} />
					)}
					<path
						d={geo.linePath}
						fill="none"
						stroke={color}
						strokeWidth={2}
						strokeLinejoin="round"
						strokeLinecap="round"
					/>
					{count === 1 && (
						<circle cx={geo.xs[0]} cy={geo.ys[0]} r={4} fill={color} />
					)}

					{ax != null && ay != null && (
						<g>
							<line
								x1={ax}
								x2={ax}
								y1={geo.top}
								y2={geo.top + geo.innerH}
								className="stroke-foreground/30"
								shapeRendering="crispEdges"
							/>
							<circle
								cx={ax}
								cy={ay}
								r={4.5}
								fill={color}
								className="stroke-background"
								strokeWidth={2}
							/>
						</g>
					)}
				</svg>
			)}

			{activePoint && ax != null && ay != null && (
				<div
					aria-hidden="true"
					className="bg-popover text-popover-foreground pointer-events-none absolute z-10 border px-2.5 py-1.5 whitespace-nowrap shadow-md"
					style={{
						left: ax,
						top: tooltipBelow ? ay + 14 : ay - 14,
						transform: `translate(${tooltipShift}, ${tooltipBelow ? "0" : "-100%"})`,
					}}
				>
					<div className="text-sm font-semibold tabular-nums">
						{formatValue(activePoint.value)}{" "}
						<span className="text-muted-foreground text-xs font-normal">
							{label}
						</span>
					</div>
					<div className="text-muted-foreground text-[11px]">
						{formatTime(activePoint.t)}
					</div>
				</div>
			)}

			{focusPoint && (
				<input
					type="range"
					className="sr-only"
					aria-label={`Explore ${label} data points`}
					min={0}
					max={count - 1}
					step={1}
					value={focusIndex}
					aria-valuetext={`${formatValue(focusPoint.value)} ${label}, ${formatTime(focusPoint.t)}`}
					onChange={(event) => setActive(Number(event.currentTarget.value))}
					onFocus={() => setActive((current) => current ?? count - 1)}
					onBlur={() => setActive(null)}
				/>
			)}
		</div>
	);
}

function utcOrLocalDate(t: number, utc: boolean): string {
	return (utc ? utcDateFormat : localDateFormat).format(t);
}
