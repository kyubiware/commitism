import { describe, expect, it } from "vitest";
import type { ChangedFile } from "./git.js";
import { buildGroupingSystemPrompt, filterExcludedFiles } from "./grouping.js";

describe("filterExcludedFiles", () => {
	it("includes package-lock.json when package.json is present", () => {
		const files: ChangedFile[] = [
			{ status: "M", path: "package.json", staged: true },
			{ status: "M", path: "package-lock.json", staged: true },
			{ status: "M", path: "src/index.ts", staged: true },
		];

		const { included, excluded } = filterExcludedFiles(files);

		expect(included.map((f) => f.path)).toContain("package-lock.json");
		expect(included.map((f) => f.path)).toContain("package.json");
		expect(included.map((f) => f.path)).toContain("src/index.ts");
		expect(excluded).toEqual([]);
	});

	it("still excludes package-lock.json when no companion package.json exists", () => {
		const files: ChangedFile[] = [
			{ status: "M", path: "package-lock.json", staged: true },
			{ status: "M", path: "src/index.ts", staged: true },
		];

		const { included, excluded } = filterExcludedFiles(files);

		expect(included.map((f) => f.path)).not.toContain("package-lock.json");
		expect(excluded).toContain("package-lock.json");
	});

	it("still excludes unrelated lockfiles when no companion manifest exists", () => {
		const files: ChangedFile[] = [
			{ status: "M", path: "some-random.lock", staged: true },
			{ status: "M", path: "src/index.ts", staged: true },
		];

		const { included, excluded } = filterExcludedFiles(files);

		expect(included.map((f) => f.path)).not.toContain("some-random.lock");
		expect(excluded).toContain("some-random.lock");
	});

	it("still excludes node_modules and dist directories", () => {
		const files: ChangedFile[] = [
			{ status: "M", path: "node_modules/foo/index.js", staged: true },
			{ status: "M", path: "dist/bundle.js", staged: true },
			{ status: "M", path: "src/index.ts", staged: true },
		];

		const { included, excluded } = filterExcludedFiles(files);

		expect(included).toHaveLength(1);
		expect(included[0].path).toBe("src/index.ts");
		expect(excluded).toContain("node_modules/foo/index.js");
		expect(excluded).toContain("dist/bundle.js");
	});

	it("excludes *.min.js and *.log files", () => {
		const files: ChangedFile[] = [
			{ status: "M", path: "vendor.min.js", staged: true },
			{ status: "M", path: "debug.log", staged: true },
			{ status: "M", path: "src/index.ts", staged: true },
		];

		const { included, excluded } = filterExcludedFiles(files);

		expect(included).toHaveLength(1);
		expect(excluded).toContain("vendor.min.js");
		expect(excluded).toContain("debug.log");
	});
});

describe("buildGroupingSystemPrompt", () => {
	it("includes a rule to separate documentation from code", () => {
		const prompt = buildGroupingSystemPrompt();
		expect(prompt).toContain("documentation");
		expect(prompt).toMatch(/separate.*doc/i);
	});

	it("includes rule to keep related files together", () => {
		const prompt = buildGroupingSystemPrompt();
		expect(prompt).toContain("Keep related files together");
	});
});
