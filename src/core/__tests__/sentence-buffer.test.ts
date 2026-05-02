import { describe, it, expect } from "vitest";
import { SentenceBuffer } from "../sentence-buffer.js";

describe("SentenceBuffer", () => {
	it("emits a sentence pushed in one piece followed by whitespace", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("Hello world. ")).toEqual(["Hello world."]);
		expect(sb.flush()).toBeNull();
	});

	it("buffers across chunk splits and emits once the boundary arrives", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("Hello wor")).toEqual([]);
		expect(sb.push("ld.")).toEqual([]);
		expect(sb.push(" Next.")).toEqual(["Hello world."]);
		expect(sb.flush()).toBe("Next.");
	});

	it("emits multiple sentences in one push", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("First. Second! Third? ")).toEqual([
			"First.",
			"Second!",
			"Third?",
		]);
		expect(sb.flush()).toBeNull();
	});

	it("returns residue from flush when buffer holds an unterminated tail", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("Hello world. And second")).toEqual(["Hello world."]);
		expect(sb.flush()).toBe("And second");
	});

	it("treats empty/whitespace input as nothing", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("")).toEqual([]);
		expect(sb.push("   \n\t  ")).toEqual([]);
		expect(sb.flush()).toBeNull();
	});

	it("does not emit on a terminator with no following whitespace yet", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("Hello.")).toEqual([]);
		// Now whitespace arrives — sentence completes.
		expect(sb.push(" ")).toEqual(["Hello."]);
	});

	it("handles newline as a boundary whitespace", () => {
		const sb = new SentenceBuffer();
		expect(sb.push("Line one.\nLine two.\n")).toEqual([
			"Line one.",
			"Line two.",
		]);
	});
});
