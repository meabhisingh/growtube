import { defineRelations, defineRelationsPart } from "drizzle-orm";

import * as schema from "./schema";

export const youtubeRelations = defineRelationsPart(
	{
		channels: schema.channels,
		videos: schema.videos,
		videoSnapshots: schema.videoSnapshots,
		channelSnapshots: schema.channelSnapshots,
	},
	(r) => ({
		channels: {
			videos: r.many.videos({
				from: r.channels.id,
				to: r.videos.channelId,
			}),
			snapshots: r.many.channelSnapshots({
				from: r.channels.id,
				to: r.channelSnapshots.channelId,
			}),
		},
		videos: {
			channel: r.one.channels({
				from: r.videos.channelId,
				to: r.channels.id,
			}),
			snapshots: r.many.videoSnapshots({
				from: r.videos.id,
				to: r.videoSnapshots.videoId,
			}),
		},
		videoSnapshots: {
			video: r.one.videos({
				from: r.videoSnapshots.videoId,
				to: r.videos.id,
				optional: false,
			}),
		},
		channelSnapshots: {
			channel: r.one.channels({
				from: r.channelSnapshots.channelId,
				to: r.channels.id,
				optional: false,
			}),
		},
	}),
);

export const relations = {
	...defineRelations(schema),
	...schema.authRelations,
	...youtubeRelations,
};
