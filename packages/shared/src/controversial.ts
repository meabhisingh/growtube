/**
 * Advertiser-unfriendly keyword detector, modeled on YouTube's advertiser-
 * friendly content guidelines. Free for everyone (vidIQ paywalls this).
 *
 * It's a heuristic: a match means "a human should double-check this", not
 * "this will be demonetized". Context matters (e.g. "shooting a video").
 */

export type ControversialCategory =
	| "violence"
	| "adult"
	| "drugs"
	| "profanity"
	| "tragedy"
	| "sensitive_events"
	| "dangerous_acts"
	| "hateful"
	| "firearms";

export type ControversialMatch = {
	term: string;
	category: ControversialCategory;
	count: number;
};

export const CONTROVERSIAL_CATEGORY_LABELS: Record<
	ControversialCategory,
	string
> = {
	violence: "Violence",
	adult: "Adult content",
	drugs: "Drugs",
	profanity: "Profanity",
	tragedy: "Death & tragedy",
	sensitive_events: "Sensitive events",
	dangerous_acts: "Dangerous acts",
	hateful: "Hateful content",
	firearms: "Firearms",
};

const TERMS: Record<ControversialCategory, string[]> = {
	violence: [
		"kill",
		"killed",
		"killing",
		"murder",
		"murdered",
		"stab",
		"stabbed",
		"beheading",
		"massacre",
		"torture",
		"assault",
		"brutal",
		"gore",
		"bloody",
		"execution",
		"slaughter",
		"attack",
		"fight",
		"beat up",
	],
	adult: [
		"sex",
		"sexy",
		"porn",
		"nude",
		"nudity",
		"naked",
		"nsfw",
		"onlyfans",
		"xxx",
		"fetish",
		"erotic",
		"strip",
		"hookup",
	],
	drugs: [
		"cocaine",
		"heroin",
		"meth",
		"weed",
		"marijuana",
		"cannabis",
		"lsd",
		"mdma",
		"ecstasy",
		"overdose",
		"drug deal",
		"high af",
		"fentanyl",
		"vape",
	],
	profanity: [
		"fuck",
		"fucking",
		"shit",
		"bitch",
		"asshole",
		"bastard",
		"wtf",
		"dick",
	],
	tragedy: [
		"suicide",
		"self harm",
		"self-harm",
		"died",
		"death",
		"dead body",
		"funeral",
		"accident footage",
		"crash footage",
		"tragedy",
	],
	sensitive_events: [
		"war",
		"terrorist",
		"terrorism",
		"bombing",
		"genocide",
		"pandemic",
		"covid",
		"election fraud",
		"riot",
		"hostage",
	],
	dangerous_acts: [
		"prank gone wrong",
		"challenge gone wrong",
		"dangerous challenge",
		"how to hack",
		"explosive",
		"arson",
		"street racing",
	],
	hateful: ["nazi", "racist", "white power", "supremacist", "hate crime"],
	firearms: [
		"gun",
		"guns",
		"rifle",
		"ammo",
		"shooting",
		"shotgun",
		"pistol",
		"ar-15",
		"ak-47",
	],
};

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MATCHERS = Object.entries(TERMS).flatMap(([category, terms]) =>
	terms.map((term) => ({
		term,
		category: category as ControversialCategory,
		re: new RegExp(
			`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`,
			"giu",
		),
	})),
);

/** Scans any mix of title / description / tags / transcript text. */
export function findControversialKeywords(
	...texts: (string | string[] | null | undefined)[]
): ControversialMatch[] {
	const haystack = texts
		.flat()
		.filter((t): t is string => typeof t === "string")
		.join("\n");
	if (!haystack) return [];
	const matches: ControversialMatch[] = [];
	for (const { term, category, re } of MATCHERS) {
		const count = haystack.match(re)?.length ?? 0;
		if (count > 0) matches.push({ term, category, count });
	}
	return matches.sort((a, b) => b.count - a.count);
}
