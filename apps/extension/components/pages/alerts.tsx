/**
 * Competitor outlier alerts UI, shared by the Competitors tool (side panel)
 * and the options page: the settings form, the one-click "Turn on alerts"
 * card and the in-app list of recent alerts. The checks themselves run in the
 * background (lib/competitor-alerts.ts).
 */
import { formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { BellOff, BellRing, RefreshCw, Trash2 } from "lucide-react";
import { useCallback } from "react";

import { jobs } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	ALERT_THRESHOLDS,
	type AlertThreshold,
	type CompetitorAlertSettings,
	competitorAlertLog,
	competitorAlertSettings,
	competitorAlertState,
	competitors,
	withAlertDefaults,
} from "@/lib/settings";

import { useAsyncTask } from "./hooks";
import { OutlierBadge, VphBadge } from "./ui/badges";
import { Field, NativeSelect, Segmented, SwitchRow } from "./ui/controls";
import { ErrorNotice, Notice } from "./ui/feedback";
import { Collapsible } from "./ui/layout";
import { toast } from "./ui/toast";
import { VideoRow } from "./ui/video";
import { formatHour, openLink, watchUrl } from "./utils";

const MIN_AGES = [3, 6, 12, 24];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function useAlertSettings() {
	const [raw, setRaw, loading] = useStorageItem(competitorAlertSettings);
	const settings = withAlertDefaults(raw);
	const update = useCallback(
		(patch: Partial<CompetitorAlertSettings>) =>
			setRaw((prev) => ({ ...withAlertDefaults(prev), ...patch })),
		[setRaw],
	);
	return [settings, update, loading] as const;
}

/** Turns alerts on and runs a first check right away. */
function useEnableAlerts() {
	const [, update] = useAlertSettings();
	return useCallback(async () => {
		await update({ enabled: true });
		toast("Outlier alerts on. Checking your competitors…", {
			tone: "success",
		});
		void jobs.checkAlerts().catch(() => null);
	}, [update]);
}

/** Every alert setting (options page, and collapsed in the Competitors tool). */
export function AlertSettingsForm({ idPrefix }: { idPrefix: string }) {
	const [s, update] = useAlertSettings();
	const enable = useEnableAlerts();
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col divide-y">
				<SwitchRow
					icon={BellRing}
					title="Competitor outlier alerts"
					description="About once an hour, check your competitors' uploads from the last 7 days and notify you when one takes off. Runs in this browser only, while you're signed in."
					checked={s.enabled}
					onCheckedChange={(v) =>
						v ? void enable() : void update({ enabled: false })
					}
				/>
				<SwitchRow
					title="Silent notifications"
					description="Show alerts without a sound."
					checked={s.silent}
					disabled={!s.enabled}
					onCheckedChange={(v) => void update({ silent: v })}
				/>
				<SwitchRow
					title="Quiet hours"
					description="During these hours alerts are only added to the list in the Competitors tool, without a notification."
					checked={s.quietHours}
					disabled={!s.enabled}
					onCheckedChange={(v) => void update({ quietHours: v })}
				/>
			</div>
			{s.quietHours ? (
				<div className="flex flex-wrap items-end gap-2">
					<Field label="From" htmlFor={`${idPrefix}-quiet-start`}>
						<NativeSelect
							id={`${idPrefix}-quiet-start`}
							value={s.quietStart}
							disabled={!s.enabled}
							onChange={(e) =>
								void update({ quietStart: Number(e.target.value) })
							}
							className="w-28"
						>
							{HOURS.map((h) => (
								<option key={h} value={h}>
									{formatHour(h)}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Until" htmlFor={`${idPrefix}-quiet-end`}>
						<NativeSelect
							id={`${idPrefix}-quiet-end`}
							value={s.quietEnd}
							disabled={!s.enabled}
							onChange={(e) =>
								void update({ quietEnd: Number(e.target.value) })
							}
							className="w-28"
						>
							{HOURS.map((h) => (
								<option key={h} value={h}>
									{formatHour(h)}
								</option>
							))}
						</NativeSelect>
					</Field>
				</div>
			) : null}
			<Field
				label="Alert when a new video reaches"
				hint="Compared with the channel's usual views (median of its recent uploads older than a day)."
			>
				<Segmented<`${AlertThreshold}`>
					value={`${s.threshold}`}
					onChange={(v) =>
						void update({ threshold: Number(v) as AlertThreshold })
					}
					options={ALERT_THRESHOLDS.map((t) => ({
						value: `${t}` as `${AlertThreshold}`,
						label: `${t}×`,
					}))}
					ariaLabel="Outlier threshold"
					className="self-start"
				/>
			</Field>
			<Field
				label="Minimum age"
				htmlFor={`${idPrefix}-min-age`}
				hint="Very new uploads are skipped until they're this old: early numbers are noisy."
			>
				<NativeSelect
					id={`${idPrefix}-min-age`}
					value={s.minAgeHours}
					onChange={(e) => void update({ minAgeHours: Number(e.target.value) })}
					className="w-40"
				>
					{MIN_AGES.map((h) => (
						<option key={h} value={h}>
							{h} hours
						</option>
					))}
				</NativeSelect>
			</Field>
		</div>
	);
}

/** Outlier alerts block of the Competitors tool. */
export function CompetitorAlertsPanel() {
	const [s, , loading] = useAlertSettings();
	const [list] = useStorageItem(competitors);
	const [log, setLog] = useStorageItem(competitorAlertLog);
	const [state] = useStorageItem(competitorAlertState);
	const enable = useEnableAlerts();
	const check = useAsyncTask(async () => {
		const r = await jobs.checkAlerts();
		toast(
			r.alerts
				? `${r.alerts} new alert${r.alerts === 1 ? "" : "s"}`
				: `Checked ${r.checked} channel${r.checked === 1 ? "" : "s"}: nothing new above ${s.threshold}×`,
			{ tone: r.alerts ? "success" : "info" },
		);
		return r;
	});

	if (loading) return null;

	return (
		<div className="flex flex-col gap-3">
			{!s.enabled ? (
				<Notice
					tone="info"
					icon={BellRing}
					title="Get an alert when a competitor's video takes off"
					actions={
						<Button
							size="xs"
							onClick={() => void enable()}
							disabled={list.length === 0}
						>
							<BellRing /> Turn on alerts
						</Button>
					}
				>
					{list.length === 0 ? "Add a competitor first. " : null}
					GrowTube checks their new uploads about once an hour and notifies you
					when one reaches {s.threshold}× its usual views. Off by default;
					nothing leaves this browser.
				</Notice>
			) : (
				<div className="flex flex-wrap items-center gap-2 text-[11px]">
					<span className="text-muted-foreground min-w-0 flex-1">
						Alerts on at {s.threshold}×
						{state.lastRunAt
							? ` · checked ${formatRelative(state.lastRunAt)}`
							: " · first check pending"}
					</span>
					<Button
						size="xs"
						variant="outline"
						disabled={check.loading || list.length === 0}
						onClick={() => void check.run()}
					>
						<RefreshCw className={check.loading ? "animate-spin" : undefined} />
						Check now
					</Button>
				</div>
			)}
			{check.error ? <ErrorNotice error={check.error} /> : null}
			<Collapsible
				summary={s.enabled ? "Alert settings" : "Alert settings (off)"}
			>
				<AlertSettingsForm idPrefix="sp-alerts" />
			</Collapsible>
			{log.length > 0 ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-muted-foreground text-[11px]">
							Recent alerts
						</span>
						<Button size="xs" variant="ghost" onClick={() => void setLog([])}>
							<Trash2 /> Clear
						</Button>
					</div>
					{log.slice(0, 20).map((a) => (
						<VideoRow
							key={a.videoId}
							video={{
								videoId: a.videoId,
								title: a.title,
								thumbnail: a.thumbnail,
								channelTitle: a.channelTitle,
								views: a.views,
								publishedAt: a.publishedAt,
							}}
							onOpen={(e) => openLink(watchUrl(a.videoId), e)}
							badges={
								<>
									<OutlierBadge score={a.outlier} />
									<VphBadge vph={a.vph} />
									<span
										className="text-muted-foreground inline-flex items-center gap-1 text-[10px]"
										title={new Date(a.at).toLocaleString()}
									>
										{a.notified ? null : (
											<BellOff className="size-3" aria-label="Not notified" />
										)}
										alert {formatRelative(a.at)}
									</span>
								</>
							}
						/>
					))}
				</div>
			) : s.enabled ? (
				<div className="text-muted-foreground text-[11px]">
					No alerts yet. They show up here (and as a notification) when a
					competitor's upload from the last 7 days reaches {s.threshold}× its
					usual views.
				</div>
			) : null}
		</div>
	);
}
