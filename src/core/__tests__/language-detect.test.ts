import { describe, it, expect } from "vitest";
import { detectLanguage } from "../language-detect.js";

describe("detectLanguage", () => {
	// -- English --

	it("detects plain English text", () => {
		expect(detectLanguage("Hello, how are you today?")).toBe("en");
	});

	it("detects English code-related text", () => {
		expect(detectLanguage("I've updated the function to handle edge cases.")).toBe("en");
	});

	it("detects short English text", () => {
		expect(detectLanguage("Done.")).toBe("en");
	});

	it("detects English with technical jargon", () => {
		expect(detectLanguage(
			"The API endpoint returns a JSON response with pagination metadata."
		)).toBe("en");
	});

	// -- Polish --

	it("detects Polish by diacritics (ąćęłńóśźż)", () => {
		expect(detectLanguage("Zmieniłem konfigurację żeby działała lepiej.")).toBe("pl");
	});

	it("detects Polish by common words", () => {
		expect(detectLanguage("Nie jest to tylko zmiana, ale takze poprawka kodu.")).toBe("pl");
	});

	it("detects short Polish text with diacritic", () => {
		expect(detectLanguage("Już gotowe.")).toBe("pl");
	});

	it("detects Polish with just a few diacritics in short text", () => {
		expect(detectLanguage("Proszę.")).toBe("pl");
	});

	it("detects Polish with multiple common words and no diacritics", () => {
		expect(detectLanguage("Tak, jest dobrze, nie trzeba tego zmieniać tylko teraz")).toBe("pl");
	});

	it("detects Polish with programming context", () => {
		expect(detectLanguage("Zaktualizowałem plik konfiguracyjny i poprawiłem funkcję.")).toBe("pl");
	});

	// -- Edge cases --

	it("defaults to English for empty string", () => {
		expect(detectLanguage("")).toBe("en");
	});

	it("defaults to English for single word without indicators", () => {
		expect(detectLanguage("hello")).toBe("en");
	});

	it("defaults to English for code-only content", () => {
		expect(detectLanguage("console.log(x)")).toBe("en");
	});

	it("detects Polish for mixed content when Polish dominates", () => {
		expect(detectLanguage(
			"Funkcja jest gotowa. The variable name stays in English."
		)).toBe("pl");
	});

	it("detects English for mixed content when English dominates", () => {
		const text = "I updated the configuration file, refactored the module, and fixed several edge cases in the parser.";
		expect(detectLanguage(text)).toBe("en");
	});

	it("handles uppercase Polish diacritics", () => {
		expect(detectLanguage("ŁÓDŹ jest piękna.")).toBe("pl");
	});
});
