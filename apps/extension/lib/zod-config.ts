/**
 * Turns off zod's JIT before any schema exists. Import it FIRST in every
 * entrypoint that bundles zod (background, popup, options, side panel).
 *
 * zod v4 compiles fast object parsers with `new Function` and probes for it
 * when the first object schema is created. The extension's CSP blocks eval,
 * so the probe only fails (and zod falls back), but Chrome still logs a CSP
 * violation, and it would make "no new Function" untrue for the bundle.
 * With `jitless` zod never probes or generates code.
 */
import { z } from "zod";

z.config({ jitless: true });
