/**
 * Responsive SVG area chart with hover tooltip. No dependencies, no Tailwind:
 * works inside shadow roots and in extension pages.
 *
 * Colors come from props or CSS variables:
 *   --ovq-chart-color, --ovq-chart-grid, --ovq-chart-axis,
 *   --ovq-chart-tooltip-bg, --ovq-chart-tooltip-fg
 * Text inherits `color` / `font-family` from the parent.
 */
import { formatCompact } from "@growtube/shared/format";
import {
	type CSSProperties,
	type PointerEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

export type ChartPoint = {
	x: number | string | Date;
	y: number | null | undefined;
};

export type AreaChartProps = {
	data: ChartPoint[];
	/** px (default 160) */
	height?: number;
	/** Line/fill color (default var(--ovq-chart-color, #3ea6ff)) */
	color?: string;
	fillOpacity?: number;
	strokeWidth?: number;
	formatX?: (x: number) => string;
	formatY?: (y: number) => string;
	/** Tooltip label for the value, e.g. "views" */
	valueLabel?: string;
	showAxes?: boolean;
	showGrid?: boolean;
	/** Y axis starts at 0 (default) or fits the data range */
	zeroBaseline?: boolean;
	/** Show dots for each point when there are few points (default true) */
	dots?: boolean;
	emptyText?: string;
	ariaLabel?: string;
	className?: string;
	style?: CSSProperties;
};

type Pt = { x: number; y: number };

const toNum = (x: ChartPoint["x"]) =>
	typeof x === "number" ? x : x instanceof Date ? x.getTime() : Date.parse(x);

function niceMax(v: number): number {
	if (v <= 0) return 1;
	const exp = 10 ** Math.floor(Math.log10(v));
	const f = v / exp;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
	return nice * exp;
}

const defaultFormatX = (x: number) => {
	const d = new Date(x);
	if (Number.isNaN(d.getTime()) || x < 1e11) return String(x);
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
	});
};

const PAD = { top: 10, right: 12, bottom: 22, left: 40 };

export function AreaChart({
	data,
	height = 160,
	color = "var(--ovq-chart-color, #3ea6ff)",
	fillOpacity = 0.25,
	strokeWidth = 2,
	formatX = defaultFormatX,
	formatY = (y) => formatCompact(y, 1),
	valueLabel,
	showAxes = true,
	showGrid = true,
	zeroBaseline = true,
	dots = true,
	emptyText = "Not enough data yet",
	ariaLabel,
	className,
	style,
}: AreaChartProps) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [hover, setHover] = useState<number | null>(null);
	const gradientId = `ovq-area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const measure = () =>
			setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const points = useMemo<Pt[]>(
		() =>
			data
				.map((p) => ({ x: toNum(p.x), y: p.y }))
				.filter(
					(p): p is Pt =>
						Number.isFinite(p.x) &&
						typeof p.y === "number" &&
						Number.isFinite(p.y),
				)
				.sort((a, b) => a.x - b.x),
		[data],
	);

	const pad = showAxes ? PAD : { top: 6, right: 6, bottom: 6, left: 6 };
	const innerW = Math.max(1, width - pad.left - pad.right);
	const innerH = Math.max(1, height - pad.top - pad.bottom);

	const scale = useMemo(() => {
		if (!points.length) return null;
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const rawMin = Math.min(...ys);
		const rawMax = Math.max(...ys);
		const minY = zeroBaseline
			? Math.min(0, rawMin)
			: rawMin - (rawMax - rawMin) * 0.1;
		const maxY = zeroBaseline
			? niceMax(rawMax)
			: rawMax + (rawMax - rawMin) * 0.1 || rawMax + 1;
		const sx = (x: number) =>
			pad.left +
			(maxX === minX ? innerW / 2 : ((x - minX) / (maxX - minX)) * innerW);
		const sy = (y: number) =>
			pad.top + innerH - ((y - minY) / (maxY - minY || 1)) * innerH;
		return { minX, maxX, minY, maxY, sx, sy };
	}, [points, innerW, innerH, pad.left, pad.top, zeroBaseline]);

	const onMove = useCallback(
		(e: PointerEvent<SVGSVGElement>) => {
			if (!scale || !points.length) return;
			const rect = e.currentTarget.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			let best = 0;
			let bestD = Number.POSITIVE_INFINITY;
			points.forEach((p, i) => {
				const d = Math.abs(scale.sx(p.x) - mx);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			setHover(best);
		},
		[points, scale],
	);

	const empty = points.length < 2;
	const line =
		scale && !empty
			? points
					.map(
						(p, i) =>
							`${i ? "L" : "M"}${scale.sx(p.x).toFixed(1)},${scale.sy(p.y).toFixed(1)}`,
					)
					.join("")
			: "";
	const area =
		scale && !empty
			? `${line}L${scale.sx(points.at(-1)?.x ?? 0).toFixed(1)},${(pad.top + innerH).toFixed(1)}L${scale.sx(points[0]?.x ?? 0).toFixed(1)},${(pad.top + innerH).toFixed(1)}Z`
			: "";
	const yTicks = scale
		? [0, 0.5, 1].map((t) => scale.minY + (scale.maxY - scale.minY) * t)
		: [];
	const hp = hover != null ? points[hover] : undefined;

	return (
		<div
			ref={wrapRef}
			className={className}
			style={{ position: "relative", width: "100%", height, ...style }}
			role="img"
			aria-label={ariaLabel ?? "Chart"}
		>
			{empty ? (
				<div
					style={{
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 12,
						opacity: 0.6,
						border: "1px dashed var(--ovq-chart-grid, rgba(127,127,127,0.3))",
						borderRadius: 10,
					}}
				>
					{emptyText}
				</div>
			) : width > 0 && scale ? (
				<svg
					aria-hidden="true"
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					style={{ display: "block", overflow: "visible", touchAction: "none" }}
					onPointerMove={onMove}
					onPointerLeave={() => setHover(null)}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="0%"
								style={{ stopColor: color, stopOpacity: fillOpacity }}
							/>
							<stop
								offset="100%"
								style={{ stopColor: color, stopOpacity: 0 }}
							/>
						</linearGradient>
					</defs>
					{showGrid &&
						yTicks.map((t) => (
							<line
								key={`g${t}`}
								x1={pad.left}
								x2={pad.left + innerW}
								y1={scale.sy(t)}
								y2={scale.sy(t)}
								style={{
									stroke: "var(--ovq-chart-grid, rgba(127,127,127,0.18))",
								}}
								strokeDasharray="3 3"
							/>
						))}
					{showAxes &&
						yTicks.map((t) => (
							<text
								key={`y${t}`}
								x={pad.left - 6}
								y={scale.sy(t)}
								textAnchor="end"
								dominantBaseline="middle"
								style={{
									fill: "var(--ovq-chart-axis, currentColor)",
									fontSize: 10,
									opacity: 0.65,
								}}
							>
								{formatY(t)}
							</text>
						))}
					{showAxes &&
						[scale.minX, scale.maxX].map((x, i) => (
							<text
								key={`x${x}${i}`}
								x={scale.sx(x)}
								y={height - 6}
								textAnchor={i === 0 ? "start" : "end"}
								style={{
									fill: "var(--ovq-chart-axis, currentColor)",
									fontSize: 10,
									opacity: 0.65,
								}}
							>
								{formatX(x)}
							</text>
						))}
					<path d={area} style={{ fill: `url(#${gradientId})` }} />
					<path
						d={line}
						style={{
							fill: "none",
							stroke: color,
							strokeWidth,
							strokeLinejoin: "round",
							strokeLinecap: "round",
						}}
					/>
					{dots &&
						points.length <= 24 &&
						points.map((p) => (
							<circle
								key={`d${p.x}`}
								cx={scale.sx(p.x)}
								cy={scale.sy(p.y)}
								r={2.2}
								style={{ fill: color }}
							/>
						))}
					{hp && (
						<g pointerEvents="none">
							<line
								x1={scale.sx(hp.x)}
								x2={scale.sx(hp.x)}
								y1={pad.top}
								y2={pad.top + innerH}
								style={{
									stroke: "var(--ovq-chart-axis, currentColor)",
									opacity: 0.35,
								}}
							/>
							<circle
								cx={scale.sx(hp.x)}
								cy={scale.sy(hp.y)}
								r={4}
								style={{
									fill: color,
									stroke: "var(--ovq-chart-tooltip-fg, #fff)",
									strokeWidth: 1.5,
								}}
							/>
						</g>
					)}
				</svg>
			) : null}
			{hp && scale && !empty && (
				<div
					style={{
						position: "absolute",
						pointerEvents: "none",
						top: Math.max(0, scale.sy(hp.y) - 46),
						left: Math.min(
							Math.max(scale.sx(hp.x) - 60, 0),
							Math.max(0, width - 120),
						),
						minWidth: 120,
						padding: "6px 10px",
						borderRadius: 10,
						fontSize: 11,
						lineHeight: 1.35,
						background: "var(--ovq-chart-tooltip-bg, rgba(20,20,20,0.92))",
						color: "var(--ovq-chart-tooltip-fg, #fff)",
						boxShadow:
							"0 1px 2px rgba(0,0,0,0.08), 0 6px 20px -4px rgba(0,0,0,0.22)",
						whiteSpace: "nowrap",
						zIndex: 1,
					}}
				>
					<div style={{ opacity: 0.75 }}>{formatX(hp.x)}</div>
					<div style={{ fontWeight: 600 }}>
						{formatY(hp.y)}
						{valueLabel ? ` ${valueLabel}` : ""}
					</div>
				</div>
			)}
		</div>
	);
}

export default AreaChart;
