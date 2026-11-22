/** Tiny inline trend line (no axes). Shadow-root safe (no Tailwind). */
import { type CSSProperties, useId, useMemo } from "react";

export type SparklineProps = {
	values: (number | null | undefined)[];
	width?: number;
	height?: number;
	/** Default var(--ovq-chart-color, #3ea6ff) */
	color?: string;
	strokeWidth?: number;
	/** Fill under the line */
	area?: boolean;
	/** Dot on the last value */
	lastDot?: boolean;
	ariaLabel?: string;
	style?: CSSProperties;
	className?: string;
};

export function Sparkline({
	values,
	width = 80,
	height = 24,
	color = "var(--ovq-chart-color, #3ea6ff)",
	strokeWidth = 1.5,
	area = true,
	lastDot = true,
	ariaLabel,
	style,
	className,
}: SparklineProps) {
	const gid = `ovq-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const pts = useMemo(() => {
		const nums = values.filter(
			(v): v is number => typeof v === "number" && Number.isFinite(v),
		);
		if (nums.length < 2) return null;
		const min = Math.min(...nums);
		const max = Math.max(...nums);
		const pad = strokeWidth + 1;
		const span = max - min || 1;
		return nums.map((v, i) => ({
			x: pad + (i / (nums.length - 1)) * (width - pad * 2),
			y: pad + (1 - (v - min) / span) * (height - pad * 2),
		}));
	}, [values, width, height, strokeWidth]);

	if (!pts) {
		return (
			<svg
				width={width}
				height={height}
				className={className}
				style={style}
				aria-label={ariaLabel ?? "No trend data"}
				role="img"
			>
				<line
					x1={2}
					x2={width - 2}
					y1={height / 2}
					y2={height / 2}
					style={{ stroke: "currentColor", opacity: 0.25 }}
					strokeDasharray="2 3"
				/>
			</svg>
		);
	}
	const d = pts
		.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
		.join("");
	const last = pts.at(-1);
	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className={className}
			style={{
				display: "inline-block",
				verticalAlign: "middle",
				overflow: "visible",
				...style,
			}}
			role="img"
			aria-label={ariaLabel ?? "Trend"}
		>
			{area && (
				<>
					<defs>
						<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="0%"
								style={{ stopColor: color, stopOpacity: 0.3 }}
							/>
							<stop
								offset="100%"
								style={{ stopColor: color, stopOpacity: 0 }}
							/>
						</linearGradient>
					</defs>
					<path
						d={`${d}L${last?.x.toFixed(1)},${height}L${pts[0]?.x.toFixed(1)},${height}Z`}
						style={{ fill: `url(#${gid})` }}
					/>
				</>
			)}
			<path
				d={d}
				style={{
					fill: "none",
					stroke: color,
					strokeWidth,
					strokeLinejoin: "round",
					strokeLinecap: "round",
				}}
			/>
			{lastDot && last && (
				<circle
					cx={last.x}
					cy={last.y}
					r={strokeWidth + 0.8}
					style={{ fill: color }}
				/>
			)}
		</svg>
	);
}

export default Sparkline;
