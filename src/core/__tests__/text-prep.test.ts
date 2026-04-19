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

	// -- Number+unit separation --

	it("separates number from unit", () => {
		expect(prepareForSpeech("Takes 500ms to run.")).toContain("500 ms");
		expect(prepareForSpeech("Needs 4GB of RAM.")).toContain("4 GB");
		expect(prepareForSpeech("Running at 2GHz.")).toContain("2 GHz");
	});

	it("preserves ordinals", () => {
		const result = prepareForSpeech("The 1st, 2nd, 3rd, and 4th items.");
		expect(result).toContain("1st");
		expect(result).toContain("2nd");
		expect(result).toContain("3rd");
		expect(result).toContain("4th");
	});

	it("handles decimal+unit", () => {
		expect(prepareForSpeech("Clock at 2.5GHz.")).toContain("2.5 GHz");
	});

	// -- English shorthands --

	it("expands e.g. to for example", () => {
		const result = prepareForSpeech("Use a tool, e.g. vitest.");
		expect(result).toContain("for example");
		expect(result).not.toContain("e.g.");
	});

	it("expands i.e. to that is", () => {
		const result = prepareForSpeech("The runtime, i.e. Node.js.");
		expect(result).toContain("that is");
		expect(result).not.toContain("i.e.");
	});

	it("expands vs. to versus", () => {
		const result = prepareForSpeech("Jest vs. Vitest.");
		expect(result).toContain("versus");
	});

	// -- Polish shorthands --

	it("expands np. to na przyk\u0142ad", () => {
		const result = prepareForSpeech("U\u017cyj narz\u0119dzia, np. vitest.");
		expect(result).toContain("na przyk\u0142ad");
		expect(result).not.toContain("np.");
	});

	it("expands tj. to to jest", () => {
		const result = prepareForSpeech("\u015arodowisko, tj. Node.");
		expect(result).toContain("to jest");
		expect(result).not.toContain("tj.");
	});

	it("expands m.in. to mi\u0119dzy innymi", () => {
		const result = prepareForSpeech("Obs\u0142uguje m.in. TypeScript.");
		expect(result).toContain("mi\u0119dzy innymi");
		expect(result).not.toContain("m.in.");
	});

	it("expands itd. to i tak dalej", () => {
		const result = prepareForSpeech("Pliki, foldery, itd.");
		expect(result).toContain("i tak dalej");
	});

	it("expands itp. to i tym podobne", () => {
		const result = prepareForSpeech("Kolory, rozmiary itp.");
		expect(result).toContain("i tym podobne");
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
		expect(chunks[0].text).toBe("Hello world.");
		expect(chunks[0].pauseBefore).toBe(0);
	});

	it("splits on paragraph breaks with pause hints", () => {
		const text = "First paragraph here.\n\nSecond paragraph here.";
		const chunks = splitIntoChunks(text);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0].text).toContain("First");
		expect(chunks[0].pauseBefore).toBe(0);
		// Second paragraph chunk should have a paragraph pause
		const secondParaChunk = chunks.find(c => c.text.includes("Second"))!;
		expect(secondParaChunk.pauseBefore).toBeGreaterThan(0);
	});

	it("splits long paragraphs into sentence-sized chunks", () => {
		const sentences = Array.from({ length: 10 }, (_, i) =>
			`This is sentence number ${i + 1} which is quite long and descriptive.`
		).join(" ");
		const chunks = splitIntoChunks(sentences);
		expect(chunks.length).toBeGreaterThan(1);
		// No chunk should be excessively long
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeLessThan(300);
		}
	});

	it("merges short consecutive sentences", () => {
		const text = "Hi. Ok. Yes.";
		const chunks = splitIntoChunks(text);
		// These are short enough to be merged into one chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toContain("Hi");
		expect(chunks[0].text).toContain("Ok");
		expect(chunks[0].text).toContain("Yes");
	});

	it("handles text without sentence-ending punctuation", () => {
		const text = "This text has no period at the end";
		const chunks = splitIntoChunks(text);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toBe("This text has no period at the end");
	});

	it("produces clean chunks without leading dots", () => {
		const text = ". First item.\n\n. Second item.";
		const chunks = splitIntoChunks(text);
		for (const chunk of chunks) {
			expect(chunk.text).not.toMatch(/^\./);
		}
	});

	it("filters out empty chunks", () => {
		const text = "Hello.\n\n\n\nWorld.";
		const chunks = splitIntoChunks(text);
		for (const chunk of chunks) {
			expect(chunk.text.length).toBeGreaterThan(0);
		}
	});

	it("assigns zero pause to chunks within the same paragraph", () => {
		const longPara = Array.from({ length: 5 }, (_, i) =>
			`Sentence ${i + 1} is moderately long and adds to the paragraph.`
		).join(" ");
		const chunks = splitIntoChunks(longPara);
		expect(chunks.length).toBeGreaterThan(1);
		// All chunks in the same paragraph: first has 0, rest also 0
		for (const chunk of chunks) {
			expect(chunk.pauseBefore).toBe(0);
		}
	});

	it("assigns paragraph pause to first chunk of each new paragraph", () => {
		const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
		const chunks = splitIntoChunks(text);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].pauseBefore).toBe(0);
		expect(chunks[1].pauseBefore).toBeGreaterThan(0);
		expect(chunks[2].pauseBefore).toBeGreaterThan(0);
	});
});
