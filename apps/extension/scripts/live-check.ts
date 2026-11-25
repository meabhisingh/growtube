/**
 * Live smoke test of lib/youtube against real YouTube, from Node.
 * Not part of the extension bundle.
 *
 *   pnpm --filter extension live-check        (see scripts/run-live-check.mjs)
 *
 * Also replays the saved fixtures through the parsers (offline checks), so a
 * parser regression shows up even when YouTube is unreachable.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	findVideoRank,
	getChannel,
	getChannelBaseline,
	getChannelVideos,
	getSearchSuggestions,
	getTranscript,
	getVideoComments,
	getVideoDetails,
	parseAbout,
	parseChannelHeader,
	parseChannelVideosPage,
	parseCommentsHeader,
	parseCommentsPage,
	parseJson3,
	parseNext,
	parsePlayer,
	parseSearchResults,
	parseSuggestionsJsonp,
	search,
} from "../lib/youtube";

// The bundle runs from .output/live-check with cwd = apps/extension.
const fixturesDir = [
	join(process.cwd(), "lib", "youtube", "__fixtures__"),
	join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"lib",
		"youtube",
		"__fixtures__",
	),
].find((d) => existsSync(d)) as string;
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
	if (!ok) failures++;
	console.log(
		`${ok ? "  ok " : "  FAIL"} ${label}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`,
	);
}

async function section(name: string, fn: () => Promise<void> | void) {
	console.log(`\n# ${name}`);
	const t = Date.now();
	try {
		await fn();
	} catch (error) {
		failures++;
		console.log(
			"  FAIL threw:",
			error instanceof Error ? `${error.name}: ${error.message}` : error,
		);
	}
	console.log(`  (${Date.now() - t} ms)`);
}

const offline = process.argv.includes("--offline");

await section("fixtures: player/next", () => {
	const p = parsePlayer(fixture("player.web.json"));
	check("player parsed", !!p && p.videoId === "4mcWzkHrlYI", p?.videoId);
	check("player views exact", (p?.views ?? 0) > 0, p?.views);
	check("player publishedAt", !!p?.publishedAt, p?.publishedAt);
	check("player handle", p?.channelHandle === "@carandbike", p?.channelHandle);
	check("player tags", (p?.keywords.length ?? 0) > 5, p?.keywords.length);
	const short = parsePlayer(fixture("player.web.short.json"));
	check(
		"short eligible",
		short?.isShortsEligible === true && (short?.durationSec ?? 999) <= 180,
		short?.durationSec,
	);
	const live = parsePlayer(fixture("player.web.live.json"));
	check("live flag", live?.isLive === true, live?.isLive);
	const android = parsePlayer(fixture("player.android.json"));
	check(
		"android caption tracks",
		(android?.captionTracks.length ?? 0) > 0,
		android?.captionTracks.map((t) => t.vssId),
	);
	const n = parseNext(fixture("next.json"));
	check(
		"next owner",
		n?.channelId === "UCGRIgtqal_cC7V_cD-Zylkg",
		n?.channelId,
	);
	check("next comments token", !!n?.commentsToken);
	check("next likes", n?.likes != null, n?.likes);
	check(
		"next subscribers",
		(n?.channelSubscribers ?? 0) > 1000,
		n?.channelSubscribers,
	);
	const c = parseCommentsHeader(fixture("next.comments.json"));
	check("comments header exact", c?.exact === true, c);
});

await section("fixtures: channel/search/suggest/transcript", () => {
	const h = parseChannelHeader(
		fixture("browse.channel.json"),
		"UCGRIgtqal_cC7V_cD-Zylkg",
	);
	check("header title", h.title === "carandbike", h.title);
	check("header subscribers", (h.subscribers ?? 0) > 100_000, h.subscribers);
	check("header about token", !!h.aboutToken);
	const a = parseAbout(fixture("browse.about.json"));
	check(
		"about totals",
		(a?.totalViews ?? 0) > 1e8 && (a?.videoCount ?? 0) > 1000,
		a,
	);
	check("about joined", a?.joinedAt === "2015-10-28", a?.joinedAt);
	const vids = parseChannelVideosPage(
		fixture("browse.videos.json"),
		"UCGRIgtqal_cC7V_cD-Zylkg",
		"videos",
	);
	check(
		"videos tab items",
		vids.videos.length >= 4 && !!vids.continuation,
		vids.videos.length,
	);
	check(
		"videos tab fields",
		vids.videos.every((v) => v.views != null && v.publishedAt && v.durationSec),
		vids.videos[0],
	);
	const shorts = parseChannelVideosPage(
		fixture("browse.shorts.json"),
		"UCGRIgtqal_cC7V_cD-Zylkg",
		"shorts",
	);
	check(
		"shorts tab items",
		shorts.videos.length >= 4 &&
			shorts.videos.every((v) => v.isShort && v.views != null),
		shorts.videos[0],
	);
	const cont = parseChannelVideosPage(
		fixture("browse.continuation.json"),
		"UCGRIgtqal_cC7V_cD-Zylkg",
		"videos",
	);
	check("continuation page", cont.videos.length >= 4, cont.videos.length);
	const s = parseSearchResults(fixture("search.json"));
	check("search results", s.length >= 8, s.length);
	check(
		"search has shorts",
		s.some((r) => r.isShort),
		s.filter((r) => r.isShort).length,
	);
	check(
		"search channel ids",
		s.filter((r) => !r.isShort).every((r) => r.channelId),
		s[0],
	);
	const mixed = parseSearchResults(fixture("search.mixed.json"));
	check("mixed search parsed", mixed.length >= 6, mixed.length);
	check(
		"suggestions",
		parseSuggestionsJsonp(
			readFileSync(join(fixturesDir, "suggestions.jsonp.txt"), "utf8"),
		).length > 5,
	);
	const segs = parseJson3(fixture("timedtext.json3.json"));
	check(
		"json3 segments",
		segs.length > 5 && segs.every((x) => x.text && !x.text.includes("\n")),
		segs[0],
	);
});

await section("fixtures: comments", () => {
	// Real capture with the entity mutations stripped: no comment data, no throw.
	const real = parseCommentsPage(fixture("next.comments.json"));
	check("real header total", real.total?.value === 2, real.total);
	check("real: threads without entities skipped", real.comments.length === 0);

	const e = parseCommentsPage(fixture("next.comments.entities.json"));
	check("entities: 2 comments", e.comments.length === 2, e.comments.length);
	const [c1, c2] = e.comments;
	check(
		"entities: text/author/creator",
		c1?.text.startsWith("Thanks for watching") === true &&
			c1.author === "@creator" &&
			c1.isCreator &&
			c1.authorChannelId === "UCcreator",
		c1,
	);
	check(
		"entities: likes/replies",
		c1?.likes === 1200 && c1.replies === 34,
		c1 && { likes: c1.likes, replies: c1.replies },
	);
	check(
		"entities: pinned/hearted",
		c1?.isPinned === true && c1.isHearted === true,
	);
	check(
		"entities: empty counts are 0, not hearted",
		c2?.likes === 0 &&
			c2.replies === 0 &&
			!c2.isHearted &&
			!c2.isPinned &&
			c2.publishedText === "1 day ago (edited)",
		c2,
	);
	check(
		"entities: page token (not the replies token)",
		e.nextToken === "NEXT_PAGE_TOKEN",
		e.nextToken,
	);

	const l = parseCommentsPage(fixture("next.comments.legacy.json"));
	check("legacy: total", l.total?.value === 1234 && l.total.exact, l.total);
	check(
		"legacy: sort tokens",
		l.sortTokens.top === "TOP_TOKEN" && l.sortTokens.newest === "NEWEST_TOKEN",
		l.sortTokens,
	);
	check("legacy: 2 comments", l.comments.length === 2, l.comments.length);
	const [l1, l2] = l.comments;
	check(
		"legacy: fields",
		l1?.text === "Great video, the audio was a bit quiet though." &&
			l1.likes === 5321 &&
			l1.replies === 12 &&
			l1.isPinned &&
			l1.isHearted &&
			l1.authorChannelId === "UClegacy",
		l1,
	);
	check(
		"legacy: missing counts",
		l2?.likes === 0 && l2.replies === 0 && !l2.isPinned,
		l2,
	);
	check("legacy: next token", l.nextToken === "LEGACY_NEXT", l.nextToken);

	const junk = [null, 42, "x", {}, { onResponseReceivedEndpoints: "nope" }];
	check(
		"junk input never throws",
		junk.every((j) => parseCommentsPage(j).comments.length === 0),
	);
});

if (!offline) {
	await section("getVideoDetails (full)", async () => {
		const d = await getVideoDetails("dQw4w9WgXcQ");
		console.log("  ", {
			title: d.title,
			channel: `${d.channelTitle} ${d.channelHandle}`,
			views: d.views,
			likes: d.likes,
			comments: d.comments,
			commentsExact: d.commentsExact,
			publishedAt: d.publishedAt,
			durationSec: d.durationSec,
			isShort: d.isShort,
			category: d.category,
			tags: d.keywords.length,
			subs: d.channelSubscribers,
		});
		check("views > 1e9", d.views > 1e9);
		check("likes", (d.likes ?? 0) > 1e6);
		check("comments exact", d.commentsExact && (d.comments ?? 0) > 1e6);
		check(
			"publishedAt 2009",
			d.publishedAt?.startsWith("2009-10-25") ?? false,
			d.publishedAt,
		);
		check("handle", d.channelHandle === "@RickAstleyYT");
		const basic = await getVideoDetails("acEW1jig230", { level: "basic" });
		check("short detected", basic.isShort, {
			dur: basic.durationSec,
			isShort: basic.isShort,
		});
	});

	await section("getChannel(@carandbike)", async () => {
		const c = await getChannel({ handle: "@carandbike" });
		console.log("  ", {
			...c,
			description: c.description.slice(0, 60),
			links: c.links.length,
		});
		check("channelId", c.channelId === "UCGRIgtqal_cC7V_cD-Zylkg");
		check("subscribers", (c.subscribers ?? 0) > 100_000);
		check("totalViews exact", (c.totalViews ?? 0) > 1e8);
		check("videoCount", (c.videoCount ?? 0) > 1000);
		check("joinedAt", c.joinedAt === "2015-10-28", c.joinedAt);
		check("country", c.country === "India", c.country);
		check("keywords", c.keywords.length > 0, c.keywords);
	});

	await section("getChannelVideos", async () => {
		const id = "UCGRIgtqal_cC7V_cD-Zylkg";
		const v = await getChannelVideos(id, { tab: "videos", limit: 45 });
		check("45 videos with paging", v.length === 45, v.length);
		console.log("   first:", v[0]);
		const s = await getChannelVideos(id, { tab: "shorts", limit: 10 });
		check("shorts", s.length === 10 && s.every((x) => x.isShort), s.length);
		const l = await getChannelVideos(id, { tab: "streams", limit: 5 });
		check("streams", l.length > 0, l[0]);
	});

	await section("getChannelBaseline", async () => {
		const long = await getChannelBaseline("UCGRIgtqal_cC7V_cD-Zylkg", "long");
		const short = await getChannelBaseline("UCGRIgtqal_cC7V_cD-Zylkg", "short");
		console.log("  ", { long, short });
		check("long baseline", (long.baseline ?? 0) > 0 && long.sampleSize >= 20);
		check(
			"short baseline",
			(short.baseline ?? 0) > 0 && short.sampleSize >= 20,
		);
	});

	await section("search + findVideoRank", async () => {
		const r = await search("royal enfield classic 650 review", { limit: 30 });
		check("30 results", r.results.length === 30, r.results.length);
		console.log(
			"   top 3:",
			r.results
				.slice(0, 3)
				.map(
					(x) =>
						`${x.position}. ${x.title} | ${x.channelHandle ?? x.channelTitle} | ${x.views} | ${x.publishedText}`,
				),
		);
		const shorts = await search("royal enfield classic 650 review", {
			type: "short",
			limit: 10,
		});
		check(
			"shorts search",
			shorts.results.length > 0 && shorts.results.every((x) => x.isShort),
			shorts.results.length,
		);
		const target = r.results[2]?.videoId ?? "";
		const rank = await findVideoRank(
			"royal enfield classic 650 review",
			target,
			30,
		);
		check("rank of #3", rank === 3, rank);
		const none = await findVideoRank(
			"royal enfield classic 650 review",
			"dQw4w9WgXcQ",
			20,
		);
		check("unranked -> null", none === null, none);
	});

	await section("getSearchSuggestions", async () => {
		const s = await getSearchSuggestions("royal enfield");
		console.log("  ", s.slice(0, 5));
		check("suggestions", s.length > 5);
		const u = await getSearchSuggestions("café");
		check(
			"utf-8 suggestions",
			u.some((x) => x.includes("café")),
			u.slice(0, 3),
		);
	});

	await section("getTranscript", async () => {
		const t = await getTranscript("4mcWzkHrlYI");
		check("transcript", (t?.segments.length ?? 0) > 50, {
			lang: t?.languageCode,
			kind: t?.kind,
			n: t?.segments.length,
		});
		console.log("   first:", t?.segments.slice(0, 2));
		const m = await getTranscript("dQw4w9WgXcQ");
		check(
			"manual en preferred",
			m?.kind === "manual" && m.languageCode.startsWith("en"),
			{ lang: m?.languageCode, kind: m?.kind },
		);
	});

	await section("getVideoComments", async () => {
		const top = await getVideoComments("dQw4w9WgXcQ", { limit: 60 });
		check(
			"top comments",
			top.comments.length >= 40 && !top.disabled,
			top.comments.length,
		);
		check("comments total", (top.total ?? 0) > 1e6, top.total);
		check(
			"comment fields",
			top.comments.every((c) => c.id && c.text && c.author),
			top.comments[0],
		);
		check(
			"likes parsed",
			top.comments.some((c) => c.likes > 1000),
			top.comments.slice(0, 3).map((c) => c.likes),
		);
		const newest = await getVideoComments("dQw4w9WgXcQ", {
			sort: "newest",
			limit: 20,
		});
		check(
			"newest comments",
			newest.comments.length >= 10,
			newest.comments.slice(0, 2).map((c) => c.publishedText),
		);
	});
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exitCode = failures ? 1 : 0;
