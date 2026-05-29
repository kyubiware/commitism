import { describe, expect, it } from "vitest";
import { extractToolName, parseToolChecks } from "./hooks.js";

describe("extractToolName", () => {
	describe("direct invocations (existing behavior)", () => {
		it("extracts biome from direct invocation", () => {
			expect(extractToolName("biome check --write")).toBe("biome");
		});

		it("extracts eslint from direct invocation", () => {
			expect(extractToolName("eslint --fix src/foo.ts")).toBe("eslint");
		});

		it("extracts tsc from direct invocation", () => {
			expect(extractToolName("tsc --noEmit")).toBe("tsc");
		});

		it("extracts vitest from direct invocation", () => {
			expect(extractToolName("vitest run")).toBe("vitest");
		});

		it("extracts prettier from direct invocation", () => {
			expect(extractToolName("prettier --write src/foo.ts")).toBe("prettier");
		});
	});

	describe("package manager run scripts (existing behavior)", () => {
		it("maps npm run typecheck to tsc", () => {
			expect(extractToolName("npm run typecheck")).toBe("tsc");
		});

		it("maps pnpm run lint to eslint", () => {
			expect(extractToolName("pnpm run lint")).toBe("eslint");
		});

		it("maps yarn run format to prettier", () => {
			expect(extractToolName("yarn run format")).toBe("prettier");
		});

		it("maps bun typecheck to tsc (no run keyword)", () => {
			expect(extractToolName("bun typecheck")).toBe("tsc");
		});

		it("returns unknown script name as-is", () => {
			expect(extractToolName("npm run custom-script")).toBe("custom-script");
		});

		it("returns null for bare package manager with no script", () => {
			expect(extractToolName("npm run")).toBeNull();
		});
	});

	describe("npx (existing behavior)", () => {
		it("extracts tool from npx invocation", () => {
			expect(extractToolName("npx vitest")).toBe("vitest");
		});
	});

	describe("sh -c wrapper unwrapping", () => {
		it("unwraps sh -c with single quotes and cd && chain", () => {
			expect(
				extractToolName(
					"sh -c 'cd packages/web && pnpm exec prettier --write src/foo.ts src/bar.ts'",
				),
			).toBe("prettier");
		});

		it("unwraps sh -c with double quotes", () => {
			expect(
				extractToolName(
					'sh -c "cd packages/web && pnpm exec eslint --fix --cache --max-warnings 0 src/foo.ts"',
				),
			).toBe("eslint");
		});

		it("unwraps sh -c with pnpm script (no exec)", () => {
			expect(extractToolName("sh -c 'cd packages/web && pnpm typecheck'")).toBe("tsc");
		});

		it("unwraps sh -c with pnpm exec vitest", () => {
			expect(
				extractToolName(
					"sh -c 'cd packages/web && pnpm exec vitest related --run --passWithNoTests src/foo.test.ts'",
				),
			).toBe("vitest");
		});

		it("unwraps bash -c wrapper", () => {
			expect(extractToolName("bash -c 'pnpm exec prettier --write src/foo.ts'")).toBe("prettier");
		});

		it("handles sh -c without cd prefix", () => {
			expect(extractToolName("sh -c 'pnpm exec eslint --fix src/foo.ts'")).toBe("eslint");
		});

		it("handles bare sh -c without quotes", () => {
			expect(extractToolName("sh -c biome")).toBe("biome");
		});

		it("returns null for bare sh without -c", () => {
			expect(extractToolName("sh some-script.sh")).toBeNull();
		});
	});

	describe("pnpm exec", () => {
		it("extracts tool from pnpm exec prettier", () => {
			expect(extractToolName("pnpm exec prettier --write src/foo.ts")).toBe("prettier");
		});

		it("extracts tool from pnpm exec eslint", () => {
			expect(extractToolName("pnpm exec eslint --fix src/foo.ts")).toBe("eslint");
		});

		it("extracts tool from pnpm exec vitest", () => {
			expect(extractToolName("pnpm exec vitest run")).toBe("vitest");
		});

		it("returns null for bare pnpm exec", () => {
			expect(extractToolName("pnpm exec")).toBeNull();
		});
	});

	describe("uv run", () => {
		it("extracts tool from uv run ruff", () => {
			expect(extractToolName("uv run ruff check --fix src/foo.py")).toBe("ruff");
		});

		it("extracts tool from uv run ruff format", () => {
			expect(extractToolName("uv run ruff format src/foo.py")).toBe("ruff");
		});

		it("extracts tool from uv run ty", () => {
			expect(extractToolName("uv run ty check")).toBe("ty");
		});

		it("extracts tool from uv tool run", () => {
			expect(extractToolName("uv tool run ruff")).toBe("ruff");
		});

		it("returns null for bare uv run", () => {
			expect(extractToolName("uv run")).toBeNull();
		});

		it("returns null for bare uv", () => {
			expect(extractToolName("uv")).toBeNull();
		});
	});

	describe("combined: sh -c + uv run", () => {
		it("unwraps sh -c with uv run ruff", () => {
			expect(
				extractToolName("sh -c 'cd packages/youtube-helper && uv run ruff check --fix src/foo.py'"),
			).toBe("ruff");
		});

		it("unwraps sh -c with uv run ruff format", () => {
			expect(
				extractToolName("sh -c 'cd packages/youtube-helper && uv run ruff format src/foo.py'"),
			).toBe("ruff");
		});

		it("unwraps sh -c with uv run ty check", () => {
			expect(extractToolName("sh -c 'cd packages/youtube-helper && uv run ty check'")).toBe("ty");
		});
	});

	describe("safety guards", () => {
		it("returns null for bare sh", () => {
			expect(extractToolName("sh")).toBeNull();
		});

		it("returns null for bare bash", () => {
			expect(extractToolName("bash")).toBeNull();
		});

		it("returns null for bare zsh", () => {
			expect(extractToolName("zsh")).toBeNull();
		});
	});
});

describe("parseToolChecks", () => {
	it("deduplicates sh -c wrapped commands to actual tool names", () => {
		const stderr = [
			"[COMPLETED] sh -c 'cd packages/web && pnpm exec prettier --write src/foo.ts'",
			"[COMPLETED] sh -c 'cd packages/web && pnpm exec eslint --fix src/foo.ts'",
			"[COMPLETED] sh -c 'cd packages/web && pnpm typecheck'",
			"[COMPLETED] sh -c 'cd packages/web && pnpm exec vitest related --run src/foo.test.ts'",
		].join("\n");

		const checks = parseToolChecks(stderr);
		const toolNames = checks.map((c) => c.tool);

		expect(toolNames).toContain("prettier");
		expect(toolNames).toContain("eslint");
		expect(toolNames).toContain("tsc");
		expect(toolNames).toContain("vitest");
		expect(toolNames).not.toContain("sh");
		expect(checks).toHaveLength(4);
	});

	it("handles mixed direct and wrapped commands", () => {
		const stderr = [
			"[COMPLETED] biome check --write",
			"[COMPLETED] sh -c 'cd packages/web && pnpm typecheck'",
		].join("\n");

		const checks = parseToolChecks(stderr);
		const toolNames = checks.map((c) => c.tool);

		expect(toolNames).toContain("biome");
		expect(toolNames).toContain("tsc");
	});
});
