/**
 * Simple language detection — Polish vs English.
 * Uses character and word heuristics. No ML needed.
 */

const POLISH_CHARS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g;

const POLISH_COMMON_WORDS = new Set([
	"jest",
	"nie",
	"się",
	"jak",
	"tak",
	"ale",
	"czy",
	"już",
	"tylko",
	"może",
	"tym",
	"tego",
	"które",
	"który",
	"która",
	"przez",
	"przy",
	"jego",
	"jej",
	"ich",
	"będzie",
	"został",
	"została",
	"można",
	"także",
	"również",
	"oraz",
	"jednak",
	"więc",
	"ponieważ",
	"gdyż",
	"aby",
	"żeby",
	"kiedy",
	"gdzie",
	"tutaj",
	"teraz",
	"bardzo",
	"dobrze",
	"proszę",
	"dziękuję",
	"przepraszam",
	"cześć",
	"dzień",
	"dobry",
	"plik",
	"pliku",
	"pliki",
	"katalog",
	"folder",
	"zmiana",
	"zmiany",
	"kod",
	"kodu",
	"funkcja",
	"metoda",
	"klasa",
	"moduł",
]);

export type DetectedLanguage = "en" | "pl";

/**
 * Detect whether text is Polish or English.
 * Returns "pl" if Polish is detected, "en" otherwise.
 */
export function detectLanguage(text: string): DetectedLanguage {
	// Check for Polish-specific characters
	const polishCharMatches = (text.match(POLISH_CHARS) || []).length;
	if (polishCharMatches >= 3) return "pl";

	// Check for common Polish words
	const words = text.toLowerCase().split(/\s+/);
	let polishWordCount = 0;
	for (const word of words) {
		const clean = word.replace(/[^a-ząćęłńóśźż]/gi, "");
		if (POLISH_COMMON_WORDS.has(clean)) {
			polishWordCount++;
		}
	}

	// If more than 5% of words are Polish common words, it's Polish
	const ratio = polishWordCount / Math.max(words.length, 1);
	if (ratio > 0.05 && polishWordCount >= 2) return "pl";

	// Also check for a single Polish diacritic — if text is short
	if (polishCharMatches >= 1 && text.length < 200) return "pl";

	return "en";
}
