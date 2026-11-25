/**
 * Channel Audit "Estimated earnings": a monthly ad-revenue range from the
 * views of uploads published in the last 30 days, a per-video range for a
 * typical upload and a sponsorship price range per integration. Rough public
 * industry RPM/CPM ranges (`@growtube/shared/earnings`), never YouTube data.
 * The niche is guessed from the uploads' categories and can be changed; the
 * choice is remembered per channel (`earningsNiches`).
 */
import {
	EARNINGS_DISCLAIMER,
	estimateAdEarnings,
	estimateMonthlyEarnings,
	estimateSponsorshipRate,
	formatUsdRange,
	getNiche,
	guessChannelNiche,
	isNicheId,
	MIN_SPONSOR_VIEWS,
	NICHES,
	type NicheId,
} from "@growtube/shared/earnings";
import { formatCompact } from "@growtube/shared/format";
import { CircleDollarSign } from "lucide-react";
import { useMemo } from "react";

import { useStorageItem } from "@/lib/hooks";
import { earningsNiches } from "@/lib/settings";
import type { VideoDetails } from "@/lib/youtube/types";

import { InfoTip, NativeSelect } from "../../../ui/controls";
import { Collapsible, Section, StatGrid, StatTile } from "../../../ui/layout";

const MAX_REMEMBERED = 300;
const WINDOW_DAYS = 30;

export function EarningsSection({
	channelId,
	videos,
	typicalViews,
}: {
	channelId: string;
	/** Recent uploads with exact views and publish dates */
	videos: VideoDetails[];
	/** Typical (median) views per settled upload */
	typicalViews: number | null;
}) {
	const [picks, setPicks] = useStorageItem(earningsNiches);
	const guessed = useMemo(() => guessChannelNiche(videos), [videos]);
	const stored = picks[channelId];
	const niche: NicheId = isNicheId(stored) ? stored : guessed;
	const profile = getNiche(niche);

	const monthly = useMemo(
		() => estimateMonthlyEarnings(videos, { niche, windowDays: WINDOW_DAYS }),
		[videos, niche],
	);
	const perVideo = estimateAdEarnings(typicalViews, { niche, format: "long" });
	const sponsor =
		typicalViews != null && typicalViews >= MIN_SPONSOR_VIEWS
			? estimateSponsorshipRate(typicalViews, { niche, format: "long" })
			: null;
	const shortsSponsor =
		typicalViews != null && typicalViews >= MIN_SPONSOR_VIEWS
			? estimateSponsorshipRate(typicalViews, { niche, format: "short" })
			: null;

	const choose = (id: string) => {
		if (!isNicheId(id)) return;
		void setPicks((prev) => {
			const next = { ...prev };
			delete next[channelId];
			if (id !== guessed) next[channelId] = id;
			const keys = Object.keys(next);
			for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED)))
				delete next[k];
			return next;
		});
	};

	return (
		<Section
			title="Estimated earnings"
			icon={CircleDollarSign}
			description="Rough ranges from public industry RPM/CPM figures, not YouTube data."
			actions={
				<InfoTip label="How this is estimated" side="left">
					Monthly: views of the uploads published in the last {WINDOW_DAYS} days
					× the niche's RPM range (what creators keep per 1,000 views).
					Back-catalog views of older videos aren't included, so channels with
					evergreen libraries likely earn more. Sponsorship: the channel's
					typical views × a CPM-style range. {EARNINGS_DISCLAIMER}
				</InfoTip>
			}
		>
			<div className="flex items-center gap-2 text-xs">
				<label
					htmlFor={`earnings-niche-${channelId}`}
					className="text-muted-foreground shrink-0"
				>
					Niche
				</label>
				<NativeSelect
					id={`earnings-niche-${channelId}`}
					value={niche}
					onChange={(e) => choose(e.target.value)}
					className="min-w-0 flex-1"
				>
					{NICHES.map((n) => (
						<option key={n.id} value={n.id}>
							{n.label}
							{n.id === guessed ? " (guess)" : ""}
						</option>
					))}
				</NativeSelect>
			</div>
			<StatGrid className="grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
				<StatTile
					label="Monthly (est.)"
					value={monthly ? formatUsdRange(monthly.range) : "—"}
					sub={
						monthly
							? `${monthly.uploads} upload${monthly.uploads === 1 ? "" : "s"} · ${formatCompact(monthly.views)} views, last ${WINDOW_DAYS} days`
							: `No uploads in the last ${WINDOW_DAYS} days`
					}
				/>
				<StatTile
					label="Per typical video (est.)"
					value={formatUsdRange(perVideo)}
					sub={
						typicalViews != null
							? `${formatCompact(typicalViews)} median views`
							: "Not enough uploads"
					}
				/>
				<StatTile
					label="Sponsorship / integration"
					value={sponsor ? formatUsdRange(sponsor) : "—"}
					sub={
						sponsor
							? "long-form, per video"
							: typicalViews == null
								? "Not enough uploads"
								: "Too few views for cash deals"
					}
				/>
				<StatTile
					label="Shorts mention"
					value={shortsSponsor ? formatUsdRange(shortsSponsor) : "—"}
					sub="if views were similar"
				/>
			</StatGrid>
			<Collapsible summary="Ranges used">
				<ul className="text-muted-foreground flex flex-col gap-1 text-[11px] leading-relaxed">
					<li>
						Long-form RPM ({profile.label}): ${profile.longRpm.low} – $
						{profile.longRpm.high} per 1,000 views
					</li>
					<li>
						Shorts RPM: ${profile.shortsRpm.low} – ${profile.shortsRpm.high} per
						1,000 views
					</li>
					<li>
						Sponsorship CPM: ${profile.sponsorCpm.low} – $
						{profile.sponsorCpm.high} per 1,000 typical views
					</li>
					<li>
						Assumes the channel is in the YouTube Partner Program. Real numbers
						vary with audience country, season, video length and ad blockers.
					</li>
				</ul>
			</Collapsible>
		</Section>
	);
}
