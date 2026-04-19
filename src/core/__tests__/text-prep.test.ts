import { describe, it, expect } from "vitest";
import { prepareForSpeech, splitIntoChunks } from "../text-prep.js";

// ── prepareForSpeech ──

describe("prepareForSpeech", () => {
	// -- Code blocks --

	it("removes fenced code blocks", () => {
		const input = "Here is code:\n```js\nconsole.log('hi');\n```\nDone.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("console.log");
		expect(result).toContain("Done");
	});

	it("removes inline fenced code blocks", () => {
		const input = "Run ```echo hi``` now.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("echo");
		expect(result).toContain("now");
	});

	// -- Tables --

	it("removes markdown tables", () => {
		const input = "A table:\n| Name | Age |\n|------|-----|\n| Bob  | 30  |\nEnd.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("Bob");
		expect(result).not.toContain("|");
		expect(result).toContain("End");
	});

	// -- HTML --

	it("strips HTML tags", () => {
		const input = "Hello <b>world</b> and <a href='x'>link</a>.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("<");
		expect(result).toContain("world");
		expect(result).toContain("link");
	});

	// -- Horizontal rules --

	it("removes horizontal rules", () => {
		const input = "Above\n---\nBelow";
		const result = prepareForSpeech(input);
		expect(result).toContain("Above");
		expect(result).toContain("Below");
		expect(result).not.toMatch(/---/);
	});

	// -- Images --

	it("removes images", () => {
		const input = "See ![screenshot](http://example.com/img.png) here.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("screenshot");
		expect(result).not.toContain("http");
		expect(result).toContain("here");
	});

	// -- Links --

	it("keeps link text, removes URL", () => {
		const input = "Check [this guide](https://example.com) out.";
		const result = prepareForSpeech(input);
		expect(result).toContain("this guide");
		expect(result).not.toContain("https");
	});

	// -- Bare URLs --

	it("removes bare URLs", () => {
		const input = "Visit https://example.com/path for details.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("https");
		expect(result).toContain("for details");
	});

	// -- Inline code --

	it("converts file path in backticks to filename with dot notation", () => {
		const input = "Edit `src/core/config.ts` now.";
		const result = prepareForSpeech(input);
		expect(result).toContain("config dot ts");
		expect(result).not.toContain("src/core");
	});

	it("converts simple identifier in backticks to words", () => {
		const input = "Use `camelCase` here.";
		const result = prepareForSpeech(input);
		expect(result).toContain("camel case");
	});

	it("removes code snippets with semicolons in backticks", () => {
		const input = "Like `const x = 1; return x;` works.";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("const");
		expect(result).toContain("works");
	});

	it("removes very long inline code (>50 chars)", () => {
		const longCode = "`" + "a".repeat(60) + "`";
		const input = `See ${longCode} here.`;
		const result = prepareForSpeech(input);
		expect(result).not.toContain("a".repeat(60));
	});

	it("converts CLI flags in backticks", () => {
		const input = "Use `--verbose` flag.";
		const result = prepareForSpeech(input);
		expect(result).toContain("verbose");
		expect(result).not.toContain("--");
	});

	// -- Bare file paths --

	it("converts bare file paths to filename with dot notation", () => {
		const input = "Open ./src/index.ts please.";
		const result = prepareForSpeech(input);
		expect(result).toContain("index dot ts");
		expect(result).not.toContain("./src");
	});

	// -- Headers --

	it("removes heading markers", () => {
		const input = "## My Title\nSome text.";
		const result = prepareForSpeech(input);
		expect(result).toContain("My Title");
		expect(result).not.toContain("##");
	});

	// -- Bold / Italic / Strikethrough --

	it("strips bold markers", () => {
		const input = "This is **important** stuff.";
		const result = prepareForSpeech(input);
		expect(result).toContain("important");
		expect(result).not.toContain("**");
	});

	it("strips italic markers", () => {
		const input = "This is *emphasized* text.";
		const result = prepareForSpeech(input);
		expect(result).toContain("emphasized");
		expect(result).not.toContain("*");
	});

	it("strips strikethrough markers", () => {
		const input = "This is ~~deleted~~ text.";
		const result = prepareForSpeech(input);
		expect(result).toContain("deleted");
		expect(result).not.toContain("~~");
	});

	// -- Blockquotes --

	it("strips blockquote markers", () => {
		const input = "> This is a quote\n> Second line";
		const result = prepareForSpeech(input);
		expect(result).toContain("This is a quote");
		expect(result).not.toMatch(/^>/m);
	});

	// -- List markers --

	it("converts unordered list markers to pauses", () => {
		const input = "Items:\n- First\n- Second\n- Third";
		const result = prepareForSpeech(input);
		expect(result).toContain("First");
		expect(result).toContain("Second");
		expect(result).not.toMatch(/^- /m);
	});

	it("converts ordered list markers to pauses", () => {
		const input = "Steps:\n1. First\n2. Second";
		const result = prepareForSpeech(input);
		expect(result).toContain("First");
		expect(result).not.toMatch(/^\d+\./m);
	});

	// -- Arrows --

	it("removes arrows", () => {
		const input = "A => B and C -> D";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("=>");
		expect(result).not.toContain("->");
	});

	// -- Emojis --

	it("removes common emojis", () => {
		const input = "Done ✅ and failed ❌ and star ⭐";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("✅");
		expect(result).not.toContain("❌");
		expect(result).not.toContain("⭐");
	});

	it("removes unicode emojis from extended ranges", () => {
		const input = "Hello 🎉 world 🚀";
		const result = prepareForSpeech(input);
		expect(result).not.toContain("🎉");
		expect(result).not.toContain("🚀");
		expect(result).toContain("Hello");
		expect(result).toContain("world");
	});

	// -- Whitespace normalization --

	it("collapses multiple blank lines", () => {
		const input = "First\n\n\n\n\nSecond";
		const result = prepareForSpeech(input);
		expect(result).not.toMatch(/\n{3,}/);
		expect(result).toContain("First");
		expect(result).toContain("Second");
	});

	it("collapses multiple spaces", () => {
		const input = "Hello    world";
		const result = prepareForSpeech(input);
		expect(result).toBe("Hello world");
	});

	it("trims the result", () => {
		const input = "  Hello world  ";
		const result = prepareForSpeech(input);
		expect(result).toBe("Hello world");
	});

	// -- Combined / integration --

	it("handles a realistic AI response", () => {
		const input = `## Summary

I've made the following changes:

- Updated \`src/core/config.ts\` to add the new **speed** option
- Fixed a bug in \`./src/utils/helpers.ts\` where the ~~old~~ logic was wrong

\`\`\`typescript
export function getSpeed(): number {
  return 1.0;
}
\`\`\`

See [the docs](https://example.com/docs) for more info ✅`;

		const result = prepareForSpeech(input);

		// Should contain readable text
		expect(result).toContain("Summary");
		expect(result).toContain("following changes");
		expect(result).toContain("speed");
		expect(result).toContain("config dot ts");

		// Should NOT contain
		expect(result).not.toContain("```");
		expect(result).not.toContain("getSpeed");
		expect(result).not.toContain("https");
		expect(result).not.toContain("✅");
		expect(result).not.toContain("**");
		expect(result).not.toContain("~~");
	});

	it("returns empty string for code-only input", () => {
		const input = "```js\nconsole.log('hello');\n```";
		const result = prepareForSpeech(input);
		expect(result).toBe("");
	});
});

// ── splitIntoChunks ──

describe("splitIntoChunks", () => {
	it("returns empty array for empty string", () => {
		expect(splitIntoChunks("")).toEqual([]);
	});

	it("returns single chunk for short text", () => {
		const chunks = splitIntoChunks("Hello world.");
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBe("Hello world.");
	});

	it("splits on paragraph breaks", () => {
		const text = "First paragraph here.\n\nSecond paragraph here.";
		const chunks = splitIntoChunks(text);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0]).toContain("First");
		expect(chunks[chunks.length - 1]).toContain("Second");
	});

	it("splits long paragraphs into sentence-sized chunks", () => {
		const sentences = Array.from({ length: 10 }, (_, i) =>
			`This is sentence number ${i + 1} which is quite long and descriptive.`
		).join(" ");
		const chunks = splitIntoChunks(sentences);
		expect(chunks.length).toBeGreaterThan(1);
		// No chunk should be excessively long
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThan(300);
		}
	});

	it("merges short consecutive sentences", () => {
		const text = "Hi. Ok. Yes.";
		const chunks = splitIntoChunks(text);
		// These are short enough to be merged into one chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toContain("Hi");
		expect(chunks[0]).toContain("Ok");
		expect(chunks[0]).toContain("Yes");
	});

	it("handles text without sentence-ending punctuation", () => {
		const text = "This text has no period at the end";
		const chunks = splitIntoChunks(text);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBe("This text has no period at the end");
	});

	it("produces clean chunks without leading dots", () => {
		const text = ". First item.\n\n. Second item.";
		const chunks = splitIntoChunks(text);
		for (const chunk of chunks) {
			expect(chunk).not.toMatch(/^\./);
		}
	});

	it("filters out empty chunks", () => {
		const text = "Hello.\n\n\n\nWorld.";
		const chunks = splitIntoChunks(text);
		for (const chunk of chunks) {
			expect(chunk.length).toBeGreaterThan(0);
		}
	});
});
