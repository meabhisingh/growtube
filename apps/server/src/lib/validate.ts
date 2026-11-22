import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

import { formatZodIssues } from "./http";

/**
 * `zValidator` with the API's error shape: `400 { error, details }` where
 * `details` lists the failing fields.
 */
export function validate<
	Target extends keyof ValidationTargets,
	Schema extends ZodType,
>(target: Target, schema: Schema) {
	return zValidator(target, schema, (result, c) => {
		if (!result.success) {
			return c.json(
				{
					error: `Invalid ${target === "json" ? "request body" : target}`,
					details: formatZodIssues(result.error),
				},
				400,
			);
		}
	});
}
