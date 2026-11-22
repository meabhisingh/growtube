// Bundles scripts/live-check.ts with the esbuild binary pnpm already installed
// (no extra dependencies) and runs it with Node.
//   node scripts/run-live-check.mjs [--offline]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..", "..");
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");

const esbuildPkg = readdirSync(pnpmDir)
	.filter((d) => /^esbuild@\d/.test(d))
	.sort()
	.at(-1);
if (!esbuildPkg) throw new Error("esbuild not found in node_modules/.pnpm");
const esbuildBin = join(
	pnpmDir,
	esbuildPkg,
	"node_modules",
	"esbuild",
	"bin",
	"esbuild",
);

const outDir = join(appRoot, ".output", "live-check");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "live-check.mjs");

execFileSync(
	process.execPath,
	[
		esbuildBin,
		join(here, "live-check.ts"),
		"--bundle",
		"--platform=node",
		"--format=esm",
		"--target=node20",
		`--outfile=${outFile}`,
		`--alias:@=${appRoot}`,
		"--log-level=warning",
	],
	{ stdio: "inherit", cwd: appRoot },
);

execFileSync(process.execPath, [outFile, ...process.argv.slice(2)], {
	stdio: "inherit",
	cwd: appRoot,
});
