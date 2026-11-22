/** Runs a structured generator from prompts.ts. BACKGROUND ONLY. */
import type { ZodType } from "zod";

import { aiComplete, type CompleteOptions } from "./complete";
import { AiError } from "./errors";
import {
	GENERATORS,
	type GeneratorInput,
	type GeneratorKind,
	type GeneratorOutput,
	isGeneratorKind,
} from "./prompts";
import type { ChatMessage } from "./types";

type UniformGenerator = {
	schema: ZodType;
	build: (input: unknown) => ChatMessage[];
	temperature?: number;
	postProcess?: (output: unknown, input: unknown) => unknown;
};

export async function runGenerator<K extends GeneratorKind>(
	kind: K,
	input: GeneratorInput<K>,
	opts: CompleteOptions = {},
): Promise<GeneratorOutput<K>> {
	if (!isGeneratorKind(kind))
		throw new AiError("UNKNOWN", `Unknown generator "${String(kind)}"`);
	if (input == null || typeof input !== "object") {
		throw new AiError("UNKNOWN", `Generator "${kind}" needs an input object`);
	}
	// The generator table is heterogeneous; treat it uniformly at runtime.
	const def = GENERATORS[kind] as unknown as UniformGenerator;
	const output = await aiComplete(def.build(input), {
		...opts,
		temperature: opts.temperature ?? def.temperature,
		json: def.schema,
	});
	return (
		def.postProcess ? def.postProcess(output, input) : output
	) as GeneratorOutput<K>;
}
