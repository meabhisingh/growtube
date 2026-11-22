/**
 * Safe, minimal Markdown -> React elements (no dangerouslySetInnerHTML, no
 * raw HTML). Handles what LLMs actually emit: headings, paragraphs, bold,
 * italic, strikethrough, inline code, fenced code blocks, (nested) lists,
 * blockquotes, rules, simple tables and links (http/https/mailto only).
 * Streaming-friendly: an unclosed code fence renders as code.
 *
 * Styling uses inline styles + CSS variables, so it works in shadow roots and
 * Tailwind pages alike. Override via:
 *   --ovq-md-link, --ovq-md-code-bg, --ovq-md-border, --ovq-md-muted
 */
import { type CSSProperties, type ReactNode, useMemo } from "react";

export type MarkdownProps = {
	content: string;
	className?: string;
	style?: CSSProperties;
	/** Font size of body text (default inherit) */
	fontSize?: CSSProperties["fontSize"];
};

const S = {
	root: {
		lineHeight: 1.55,
		wordBreak: "break-word",
		overflowWrap: "anywhere",
	} satisfies CSSProperties,
	p: { margin: "0 0 0.6em" } satisfies CSSProperties,
	h: (level: number): CSSProperties => ({
		margin: "0.9em 0 0.4em",
		fontWeight: 600,
		lineHeight: 1.3,
		fontSize: ["1.35em", "1.2em", "1.08em", "1em", "0.95em", "0.9em"][
			level - 1
		],
	}),
	list: { margin: "0 0 0.6em", paddingLeft: "1.4em" } satisfies CSSProperties,
	li: { margin: "0.15em 0" } satisfies CSSProperties,
	code: {
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: "0.9em",
		background: "var(--ovq-md-code-bg, rgba(127,127,127,0.16))",
		borderRadius: 4,
		padding: "0.1em 0.35em",
	} satisfies CSSProperties,
	pre: {
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: "0.85em",
		background: "var(--ovq-md-code-bg, rgba(127,127,127,0.16))",
		borderRadius: 6,
		padding: "0.7em 0.9em",
		margin: "0 0 0.7em",
		overflowX: "auto",
		whiteSpace: "pre",
	} satisfies CSSProperties,
	quote: {
		margin: "0 0 0.6em",
		padding: "0.1em 0 0.1em 0.8em",
		borderLeft: "3px solid var(--ovq-md-border, rgba(127,127,127,0.4))",
		color: "var(--ovq-md-muted, inherit)",
		opacity: 0.9,
	} satisfies CSSProperties,
	hr: {
		border: 0,
		borderTop: "1px solid var(--ovq-md-border, rgba(127,127,127,0.3))",
		margin: "0.8em 0",
	} satisfies CSSProperties,
	a: {
		color: "var(--ovq-md-link, #3ea6ff)",
		textDecoration: "underline",
		textUnderlineOffset: 2,
	} satisfies CSSProperties,
	table: {
		borderCollapse: "collapse",
		margin: "0 0 0.7em",
		fontSize: "0.92em",
		display: "block",
		overflowX: "auto",
	} satisfies CSSProperties,
	cell: {
		border: "1px solid var(--ovq-md-border, rgba(127,127,127,0.3))",
		padding: "0.3em 0.55em",
		textAlign: "left",
		verticalAlign: "top",
	} satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function safeHref(url: string): string | null {
	const u = url.trim();
	if (/^(https?:|mailto:)/i.test(u)) return u;
	if (/^www\./i.test(u)) return `https://${u}`;
	return null;
}

type InlineRule = {
	re: RegExp;
	render: (m: RegExpExecArray, key: string) => ReactNode;
};

const INLINE_RULES: InlineRule[] = [
	{
		re: /`([^`\n]+)`/,
		render: (m, key) => (
			<code key={key} style={S.code}>
				{m[1]}
			</code>
		),
	},
	{
		re: /\[([^\]\n]+)\]\(([^()\s]+(?:\([^()\s]*\))?)(?:\s+"[^"]*")?\)/,
		render: (m, key) => {
			const href = safeHref(m[2] ?? "");
			const children = renderInline(m[1] ?? "", `${key}l`);
			return href ? (
				<a
					key={key}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					style={S.a}
				>
					{children}
				</a>
			) : (
				<span key={key}>{children}</span>
			);
		},
	},
	{
		re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|__(?=\S)([\s\S]+?)(?<=\S)__/,
		render: (m, key) => (
			<strong key={key}>{renderInline(m[1] ?? m[2] ?? "", `${key}b`)}</strong>
		),
	},
	{
		re: /~~(?=\S)([\s\S]+?)(?<=\S)~~/,
		render: (m, key) => (
			<del key={key}>{renderInline(m[1] ?? "", `${key}s`)}</del>
		),
	},
	{
		re: /\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*|(?<![\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/,
		render: (m, key) => (
			<em key={key}>{renderInline(m[1] ?? m[2] ?? "", `${key}i`)}</em>
		),
	},
	{
		re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,:;!?"'\]]/,
		render: (m, key) => (
			<a
				key={key}
				href={m[0]}
				target="_blank"
				rel="noopener noreferrer"
				style={S.a}
			>
				{m[0]}
			</a>
		),
	},
];

function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
	const out: ReactNode[] = [];
	let rest = text;
	let n = 0;
	while (rest) {
		let best: { m: RegExpExecArray; rule: InlineRule } | null = null;
		for (const rule of INLINE_RULES) {
			const m = rule.re.exec(rest);
			if (m && (best === null || m.index < best.m.index)) best = { m, rule };
		}
		if (!best) {
			out.push(rest);
			break;
		}
		if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
		out.push(best.rule.render(best.m, `${keyPrefix}${n++}`));
		rest = rest.slice(best.m.index + best.m[0].length);
	}
	return out;
}

/** Inline text with soft line breaks preserved. */
function renderLines(lines: string[], key: string): ReactNode[] {
	const out: ReactNode[] = [];
	lines.forEach((l, i) => {
		if (i > 0) out.push(<br key={`${key}br${i}`} />);
		out.push(...renderInline(l, `${key}-${i}-`));
	});
	return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

type ListItem = { text: string[]; children: ListNode | null };
type ListNode = { ordered: boolean; start: number; items: ListItem[] };

function parseList(
	lines: string[],
	start: number,
): { node: ListNode; next: number } {
	const first = LIST_RE.exec(lines[start] ?? "");
	const baseIndent = first?.[1]?.length ?? 0;
	const ordered = /\d/.test(first?.[2] ?? "");
	const node: ListNode = {
		ordered,
		start: ordered ? Number.parseInt(first?.[2] ?? "1", 10) : 1,
		items: [],
	};
	let i = start;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const m = LIST_RE.exec(line);
		if (m) {
			const indent = m[1]?.length ?? 0;
			if (indent < baseIndent) break;
			if (indent > baseIndent + 1) {
				const last = node.items.at(-1);
				if (last && !last.children) {
					const nested = parseList(lines, i);
					last.children = nested.node;
					i = nested.next;
					continue;
				}
			}
			if (/\d/.test(m[2] ?? "") !== ordered && indent === baseIndent) break;
			node.items.push({ text: [m[3] ?? ""], children: null });
			i++;
			continue;
		}
		// Continuation line of the previous item (indented, non-empty).
		if (line.trim() && /^\s{2,}/.test(line) && node.items.length) {
			node.items.at(-1)?.text.push(line.trim());
			i++;
			continue;
		}
		break;
	}
	return { node, next: i };
}

function renderList(node: ListNode, key: string): ReactNode {
	const items = node.items.map((item, idx) => (
		<li key={`${key}-${idx}`} style={S.li}>
			{renderLines(item.text, `${key}-${idx}`)}
			{item.children ? renderList(item.children, `${key}-${idx}c`) : null}
		</li>
	));
	return node.ordered ? (
		<ol key={key} start={node.start} style={{ ...S.list, marginBottom: 0 }}>
			{items}
		</ol>
	) : (
		<ul key={key} style={{ ...S.list, marginBottom: 0 }}>
			{items}
		</ul>
	);
}

function splitRow(row: string): string[] {
	return row
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim());
}

function renderBlocks(src: string, keyPrefix = "b"): ReactNode[] {
	const lines = src.replace(/\r\n?/g, "\n").split("\n");
	const out: ReactNode[] = [];
	let i = 0;
	let k = 0;
	const key = () => `${keyPrefix}${k++}`;

	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (!line.trim()) {
			i++;
			continue;
		}
		// Fenced code (an unclosed fence runs to the end: streaming).
		const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
		if (fence) {
			const body: string[] = [];
			i++;
			while (
				i < lines.length &&
				!new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i] ?? "")
			) {
				body.push(lines[i] ?? "");
				i++;
			}
			i++;
			out.push(
				<pre key={key()} style={S.pre} data-lang={fence[2] || undefined}>
					<code>{body.join("\n")}</code>
				</pre>,
			);
			continue;
		}
		const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) {
			const level = heading[1]?.length ?? 1;
			const Tag = `h${Math.min(level + 2, 6)}` as "h3";
			out.push(
				<Tag key={key()} style={S.h(level)}>
					{renderInline(heading[2] ?? "")}
				</Tag>,
			);
			i++;
			continue;
		}
		if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
			out.push(<hr key={key()} style={S.hr} />);
			i++;
			continue;
		}
		if (/^\s*>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
				body.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
				i++;
			}
			out.push(
				<blockquote key={key()} style={S.quote}>
					{renderBlocks(body.join("\n"), `${keyPrefix}q${k}`)}
				</blockquote>,
			);
			continue;
		}
		if (LIST_RE.test(line)) {
			const { node, next } = parseList(lines, i);
			out.push(
				<div key={key()} style={{ marginBottom: "0.6em" }}>
					{renderList(node, `${keyPrefix}l${k}`)}
				</div>,
			);
			i = next;
			continue;
		}
		// Table: header row + separator row.
		if (line.includes("|") && TABLE_SEP_RE.test(lines[i + 1] ?? "")) {
			const header = splitRow(line);
			const rows: string[][] = [];
			i += 2;
			while (
				i < lines.length &&
				(lines[i] ?? "").includes("|") &&
				(lines[i] ?? "").trim()
			) {
				rows.push(splitRow(lines[i] ?? ""));
				i++;
			}
			const tk = key();
			out.push(
				<table key={tk} style={S.table}>
					<thead>
						<tr>
							{header.map((h, c) => (
								<th key={`${tk}h${c}`} style={{ ...S.cell, fontWeight: 600 }}>
									{renderInline(h, `${tk}h${c}`)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r, ri) => (
							<tr key={`${tk}r${ri}`}>
								{header.map((_, c) => (
									<td key={`${tk}r${ri}c${c}`} style={S.cell}>
										{renderInline(r[c] ?? "", `${tk}r${ri}c${c}`)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>,
			);
			continue;
		}
		// Paragraph: until a blank line or another block starts.
		const para: string[] = [];
		while (i < lines.length) {
			const l = lines[i] ?? "";
			// The first line is always consumed, so malformed block starters can't loop forever.
			if (
				!l.trim() ||
				(para.length && (/^\s*(```|~~~|#{1,6}\s|>)/.test(l) || LIST_RE.test(l)))
			)
				break;
			para.push(l.trim());
			i++;
		}
		const pk = key();
		out.push(
			<p key={pk} style={S.p}>
				{renderLines(para, pk)}
			</p>,
		);
	}
	return out;
}

export function Markdown({
	content,
	className,
	style,
	fontSize,
}: MarkdownProps) {
	const nodes = useMemo(() => renderBlocks(content ?? ""), [content]);
	return (
		<div className={className} style={{ ...S.root, fontSize, ...style }}>
			{nodes}
		</div>
	);
}

export default Markdown;
