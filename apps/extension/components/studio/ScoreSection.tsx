/** SEO score ring, character counters and the target keyword field. */
import { formatNumber } from "@open-vidiq/shared/format";
import type { SeoResult } from "@open-vidiq/shared/seo";
import { Plus, X } from "lucide-react";

import { hasInvalidChars, LIMITS, youtubeTagsLength } from "./text";
import {
	Chip,
	cx,
	Meter,
	ScoreRing,
	Spinner,
	scoreLabel,
	scoreTone,
} from "./ui";

export function ScoreSummary({
	seo,
	found,
}: {
	seo: SeoResult;
	found: { title: boolean; description: boolean; tags: boolean };
}) {
	const failed = seo.checks.filter((c) => !c.passed);
	const tone = scoreTone(seo.score);
	return (
		<div className="ovq-score">
			<ScoreRing score={seo.score} />
			<div className="ovq-score-text">
				<div className={cx("ovq-score-label", `ovq-tone-${tone}`)}>
					{scoreLabel(seo.score)}
				</div>
				<div className="ovq-muted">
					{failed.length
						? `${failed.length} improvement${failed.length === 1 ? "" : "s"} available`
						: "Every check passes"}
				</div>
				{!found.tags ? (
					<div className="ovq-muted ovq-small">
						Tags not loaded: score may be low.
					</div>
				) : null}
			</div>
		</div>
	);
}

type CounterRow = {
	label: string;
	value: number;
	max: number;
	state: "ok" | "warn" | "bad";
	message: string | null;
};

export function Counters({
	title,
	description,
	tags,
	found,
}: {
	title: string;
	description: string;
	tags: string[];
	found: { title: boolean; description: boolean; tags: boolean };
}) {
	const rows: CounterRow[] = [];
	if (found.title) {
		const n = title.length;
		rows.push({
			label: "Title",
			value: n,
			max: LIMITS.title,
			state:
				n > LIMITS.title || n === 0 || hasInvalidChars(title)
					? "bad"
					: n > LIMITS.titleVisible
						? "warn"
						: "ok",
			message:
				n === 0
					? "A title is required."
					: n > LIMITS.title
						? `${n - LIMITS.title} over YouTube's 100-character limit.`
						: hasInvalidChars(title)
							? "Studio doesn't allow < or > in titles."
							: n > LIMITS.titleVisible
								? "Past ~70 characters titles get cut off in search."
								: null,
		});
	}
	if (found.description) {
		const n = description.length;
		rows.push({
			label: "Description",
			value: n,
			max: LIMITS.description,
			state:
				n > LIMITS.description || hasInvalidChars(description)
					? "bad"
					: n > LIMITS.description * 0.95
						? "warn"
						: "ok",
			message:
				n > LIMITS.description
					? `${formatNumber(n - LIMITS.description)} over the 5,000-character limit.`
					: hasInvalidChars(description)
						? "Studio doesn't allow < or > in descriptions."
						: null,
		});
	}
	if (found.tags) {
		const n = youtubeTagsLength(tags);
		rows.push({
			label: "Tags",
			value: n,
			max: LIMITS.tags,
			state: n > LIMITS.tags ? "bad" : n > LIMITS.tags * 0.9 ? "warn" : "ok",
			message:
				n > LIMITS.tags
					? `${n - LIMITS.tags} over the 500-character limit: Studio won't save.`
					: n > LIMITS.tags * 0.9
						? "Almost at the 500-character limit."
						: null,
		});
	}
	if (!rows.length) return null;
	return (
		<div className="ovq-counters">
			{rows.map((r) => (
				<div key={r.label} className="ovq-counter">
					<div className="ovq-counter-head">
						<span>{r.label}</span>
						<span className={cx("ovq-counter-value", `ovq-${r.state}`)}>
							{formatNumber(r.value)}/{formatNumber(r.max)}
						</span>
					</div>
					<Meter value={r.value} max={r.max} state={r.state} />
					{r.message ? (
						<div className={cx("ovq-small", `ovq-${r.state}-text`)}>
							{r.message}
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}

export function KeywordField({
	value,
	placeholder,
	onChange,
	suggestions,
	loadingSuggestions,
	tags,
	onAddTag,
	tagsAvailable,
}: {
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
	suggestions: string[];
	loadingSuggestions: boolean;
	tags: string[];
	onAddTag: (tag: string) => void;
	tagsAvailable: boolean;
}) {
	const hasTag = (s: string) =>
		tags.some((t) => t.trim().toLowerCase() === s.trim().toLowerCase());
	return (
		<div className="ovq-keyword">
			<label className="ovq-label" htmlFor="ovq-target-keyword">
				Target keyword
			</label>
			<div className="ovq-input-wrap">
				<input
					id="ovq-target-keyword"
					className="ovq-input"
					value={value}
					placeholder={placeholder || "e.g. budget travel tips"}
					onChange={(e) => onChange(e.target.value)}
					spellCheck={false}
					autoComplete="off"
				/>
				{value ? (
					<button
						type="button"
						className="ovq-input-clear"
						title="Use the first tag"
						aria-label="Clear target keyword"
						onClick={() => onChange("")}
					>
						<X size={12} />
					</button>
				) : null}
			</div>
			<div className="ovq-muted ovq-small">
				{value
					? "Used for the score, AI suggestions and rank checks."
					: placeholder
						? `Defaults to your first tag ("${placeholder}").`
						: "Add tags or type the search phrase you want to rank for."}
			</div>
			{loadingSuggestions || suggestions.length ? (
				<div className="ovq-suggestions">
					<div className="ovq-label ovq-small">
						YouTube searches {loadingSuggestions ? <Spinner size={10} /> : null}
					</div>
					<div className="ovq-chips">
						{suggestions.map((s) => (
							<span key={s} className="ovq-chip-group">
								<Chip
									onClick={() => onChange(s)}
									title="Use as target keyword"
									active={s.toLowerCase() === value.trim().toLowerCase()}
								>
									{s}
								</Chip>
								{tagsAvailable && !hasTag(s) ? (
									<button
										type="button"
										className="ovq-chip-add"
										title={`Add "${s}" as a tag`}
										aria-label={`Add "${s}" as a tag`}
										onClick={() => onAddTag(s)}
									>
										<Plus size={11} />
									</button>
								) : null}
							</span>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
