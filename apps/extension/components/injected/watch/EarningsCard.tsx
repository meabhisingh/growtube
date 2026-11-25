/**
 * Watch panel "Estimated earnings" card: a rough ad-revenue range for this
 * video and a sponsorship price range for the channel, from public industry
 * RPM/CPM ranges (`@growtube/shared/earnings`), never YouTube data. The niche
 * is guessed from the video's category/words and can be changed; the choice
 * is remembered per channel (`earningsNiches`, chrome.storage.local).
 */
import {
	EARNINGS_DISCLAIMER,
	estimateAdEarnings,
	estimateSponsorshipRate,
	formatUsdRange,
	getNiche,
	guessNiche,
	isNicheId,
	MIN_SPONSOR_VIEWS,
	NICHES,
	type NicheId,
} from "@growtube/shared/earnings";
import { formatCompact } from "@growtube/shared/format";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { useStorageItem } from "@/lib/hooks";
import { earningsNiches } from "@/lib/settings";
import type { VideoDetails } from "@/lib/youtube/types";

import { Card, Note } from "../common/ui";

/** Remembered niche picks beyond this are dropped (oldest first). */
const MAX_REMEMBERED = 300;

const SELECT_STYLE = {
	height: 28,
	maxWidth: 170,
	padding: "0 8px",
	border: "1px solid var(--ovq-line)",
	borderRadius: "var(--ovq-radius-sm)",
	background: "var(--ovq-bg)",
	fontSize: 12,
	cursor: "pointer",
} as const;

export function EarningsCard({
	details,
	typicalViews,
}: {
	details: VideoDetails;
	/** The channel's typical (median) views of this format, when known */
	typicalViews: number | null;
}) {
	const [picks, setPicks] = useStorageItem(earningsNiches);
	const [open, setOpen] = useState(false);
	const stored = details.channelId ? picks[details.channelId] : undefined;
	const guessed = guessNiche(details);
	const niche: NicheId = isNicheId(stored) ? stored : guessed;
	const profile = getNiche(niche);
	const format = details.isShort ? "short" : "long";

	if (details.isUpcoming || (details.isLive && !details.views)) return null;

	const video = estimateAdEarnings(details.views, { niche, format });
	const sponsor =
		typicalViews != null && typicalViews >= MIN_SPONSOR_VIEWS
			? estimateSponsorshipRate(typicalViews, { niche, format })
			: null;
	const rpm = format === "short" ? profile.shortsRpm : profile.longRpm;

	const choose = (id: string) => {
		const channelId = details.channelId;
		if (!channelId || !isNicheId(id)) return;
		void setPicks((prev) => {
			const next = { ...prev };
			delete next[channelId];
			// Picking the guess again just forgets the override.
			if (id !== guessed) next[channelId] = id;
			const keys = Object.keys(next);
			for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED)))
				delete next[k];
			return next;
		});
	};

	return (
		<Card
			title="Estimated earnings"
			actions={
				<select
					aria-label="Niche used for the estimate"
					value={niche}
					onChange={(e) => choose(e.target.value)}
					style={SELECT_STYLE}
					disabled={!details.channelId}
				>
					{NICHES.map((n) => (
						<option key={n.id} value={n.id}>
							{n.label}
							{n.id === guessed ? " (guess)" : ""}
						</option>
					))}
				</select>
			}
		>
			<div
				className="ovq-seo-score"
				style={{ fontSize: 24, lineHeight: "30px" }}
			>
				{formatUsdRange(video)}
			</div>
			<div className="ovq-small ovq-muted">
				Ad revenue estimate for this {format === "short" ? "Short" : "video"} so
				far, from {formatCompact(details.views, 1)} views
			</div>
			<dl className="ovq-kv" style={{ marginTop: 10 }}>
				<dt>
					{format === "short" ? "Shorts" : "Long-form"} RPM range (
					{profile.label})
				</dt>
				<dd>
					${rpm.low.toFixed(rpm.low < 1 ? 2 : 1)} – $
					{rpm.high.toFixed(rpm.high < 1 ? 2 : 1)} / 1K views
				</dd>
				<dt>Sponsorship per integration</dt>
				<dd>
					{sponsor
						? formatUsdRange(sponsor)
						: typicalViews == null
							? "—"
							: "Too few views"}
				</dd>
			</dl>
			{sponsor ? (
				<div className="ovq-small ovq-muted" style={{ marginTop: 4 }}>
					From the channel's typical {formatCompact(typicalViews, 1)} views per{" "}
					{format === "short" ? "Short" : "video"}.
				</div>
			) : typicalViews != null && typicalViews < MIN_SPONSOR_VIEWS ? (
				<div className="ovq-small ovq-muted" style={{ marginTop: 4 }}>
					Under ~{formatCompact(MIN_SPONSOR_VIEWS)} typical views, brands
					usually offer free products or affiliate deals instead of cash.
				</div>
			) : null}
			<button
				type="button"
				className="ovq-link-btn"
				style={{ marginTop: 8 }}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				{open ? (
					<ChevronUp size={14} aria-hidden="true" />
				) : (
					<ChevronDown size={14} aria-hidden="true" />
				)}
				How this is estimated
			</button>
			{open && (
				<div style={{ marginTop: 6 }}>
					<Note>
						Views × a rough RPM range for the niche (what creators keep per
						1,000 views, from publicly shared creator reports). Sponsorships use
						a CPM-style range on the channel's typical views. These are not
						YouTube numbers: GrowTube can't see anyone's revenue. Real earnings
						depend on audience country, season, video length, ad blockers and
						Partner Program status. Pick the niche that fits best.
					</Note>
				</div>
			)}
			<div className="ovq-small ovq-muted" style={{ marginTop: 8 }}>
				{EARNINGS_DISCLAIMER.split(".")[0]}.
			</div>
		</Card>
	);
}
