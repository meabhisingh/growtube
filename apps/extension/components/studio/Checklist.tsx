/** SEO checklist and controversial (advertiser-unfriendly) keyword warnings. */
import {
	CONTROVERSIAL_CATEGORY_LABELS,
	type ControversialMatch,
} from "@growtube/shared/controversial";
import type { SeoCheck } from "@growtube/shared/seo";
import { AlertTriangle, CheckCircle2, Circle, ShieldCheck } from "lucide-react";

import { fieldsContaining } from "./text";

export function Checklist({ checks }: { checks: SeoCheck[] }) {
	const sorted = [...checks].sort(
		(a, b) => Number(a.passed) - Number(b.passed) || b.weight - a.weight,
	);
	return (
		<ul className="ovq-checklist">
			{sorted.map((c) => (
				<li
					key={c.id}
					className={c.passed ? "ovq-check ovq-pass" : "ovq-check ovq-fail"}
				>
					{c.passed ? (
						<CheckCircle2
							size={15}
							className="ovq-check-icon"
							aria-label="Passed"
						/>
					) : (
						<Circle
							size={15}
							className="ovq-check-icon"
							aria-label="Not passed"
						/>
					)}
					<div className="ovq-check-body">
						<div className="ovq-check-label">
							<span>{c.label}</span>
							<span
								className="ovq-check-weight"
								title="Points this check is worth"
							>
								{c.passed ? `${c.weight}` : `+${c.weight}`}
							</span>
						</div>
						{!c.passed ? <div className="ovq-check-hint">{c.hint}</div> : null}
					</div>
				</li>
			))}
		</ul>
	);
}

const FIELD_LABEL = {
	title: "title",
	description: "description",
	tags: "tags",
};

export function ControversialList({
	matches,
	fields,
}: {
	matches: ControversialMatch[];
	fields: { title: string; description: string; tags: string[] };
}) {
	if (!matches.length) {
		return (
			<div className="ovq-empty-row">
				<ShieldCheck size={15} className="ovq-good-text" aria-hidden="true" />
				<span>No advertiser-unfriendly keywords found.</span>
			</div>
		);
	}
	return (
		<div className="ovq-controversial">
			<p className="ovq-muted ovq-small">
				Advertisers may avoid these words. A match doesn't mean the video will
				be demonetized: check the context and rephrase where you can.
			</p>
			<ul className="ovq-flag-list">
				{matches.map((m) => {
					const where = fieldsContaining(m.term, fields);
					return (
						<li key={`${m.category}:${m.term}`} className="ovq-flag">
							<AlertTriangle
								size={14}
								className="ovq-warn-text"
								aria-hidden="true"
							/>
							<div className="ovq-flag-body">
								<div>
									<strong>“{m.term}”</strong>
									{m.count > 1 ? (
										<span className="ovq-muted"> ×{m.count}</span>
									) : null}
								</div>
								<div className="ovq-small ovq-muted">
									{CONTROVERSIAL_CATEGORY_LABELS[m.category]}
									{where.length
										? ` · in ${where.map((w) => FIELD_LABEL[w]).join(", ")}`
										: null}
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
