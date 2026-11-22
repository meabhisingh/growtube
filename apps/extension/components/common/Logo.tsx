/**
 * open-vidiq logo (same artwork as public/icon/*.png). The image is inlined
 * as a data URI by scripts/generate-icons.mjs because this renders inside
 * shadow DOM on youtube.com, where chrome-extension:// URLs would need
 * web_accessible_resources.
 */
import type { CSSProperties } from "react";
import { LOGO_DATA_URI } from "./logo-data";

export function Logo({
	size = 24,
	title = "open-vidiq",
	style,
}: {
	size?: number;
	title?: string;
	style?: CSSProperties;
}) {
	return (
		<span
			role="img"
			aria-label={title}
			style={{
				display: "inline-flex",
				width: size,
				height: size,
				flexShrink: 0,
				...style,
			}}
		>
			<img
				src={LOGO_DATA_URI}
				alt=""
				width={size}
				height={size}
				draggable={false}
				style={{ display: "block", width: "100%", height: "100%" }}
			/>
		</span>
	);
}

export default Logo;
