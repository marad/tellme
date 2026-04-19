/**
 * Prepare text for natural speech — transform AI assistant output into
 * something that sounds good when read aloud by TTS.
 *
 * This is NOT just markdown stripping. It's a full transformation from
 * "text meant to be read with eyes" to "text meant to be heard".
 */

/**
 * Transform AI response text into speakable text.
 */
export function prepareForSpeech(text: string): string {
	let result = text;

	// ── Phase 1: Remove entire blocks that should never be spoken ──

	// Code blocks → short announcement
	result = result.replace(/```[\w]*\n[\s\S]*?```/g, "\n");
	result = result.replace(/```[\s\S]*?```/g, "\n");

	// Tables (lines with pipes) → skip
	result = result.replace(/^\|.*\|$/gm, "");
	// Table separator lines
	result = result.replace(/^[\s]*[-|:]+[-|:\s]+$/gm, "");

	// HTML tags
	result = result.replace(/<[^>]+>/g, "");

	// Horizontal rules
	result = result.replace(/^[\s]*[-*_]{3,}\s*$/gm, "");

	// ── Phase 2: Transform inline elements ──

	// Images ![alt](url) → skip
	result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");

	// Links [text](url) → just the text
	result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

	// Bare URLs → skip
	result = result.replace(/https?:\/\/[^\s)>\]]+/g, "");

	// Inline code `something` — context-aware transformation
	// MUST come before bare file path handling
	result = result.replace(/`([^`]+)`/g, (_match, code: string) => {
		const trimmed = code.trim();

		// File paths inside backticks → just the filename
		if (trimmed.includes("/")) {
			const parts = trimmed.split("/").filter(Boolean);
			const filename = parts[parts.length - 1] || "";
			if (filename.includes(".")) {
				const dotIdx = filename.lastIndexOf(".");
				return ` ${filename.slice(0, dotIdx)} dot ${filename.slice(dotIdx + 1)} `;
			}
			return ` ${filename} `;
		}

		// Skip if it's a multi-statement code snippet
		if (trimmed.includes(";") || trimmed.includes("{") || trimmed.includes("}")) {
			return "";
		}

		// Skip if very long (likely code)
		if (trimmed.length > 50) return "";

		// CLI flags: --something → "something"
		if (/^--?\w[\w-]*$/.test(trimmed)) {
			return " " + trimmed.replace(/^--?/, "") + " ";
		}

		// Simple identifiers / short expressions → speak as words
		return " " + codeToWords(trimmed) + " ";
	});

	// Remaining bare file paths (not in backticks) → just the filename
	result = result.replace(/(?:[~.]?\/)+[\w.\/-]+/g, (path: string) => {
		const parts = path.split("/").filter(Boolean);
		const filename = parts[parts.length - 1] || "";
		if (filename.includes(".")) {
			const dotIdx = filename.lastIndexOf(".");
			return ` ${filename.slice(0, dotIdx)} dot ${filename.slice(dotIdx + 1)}`;
		}
		return ` ${filename}`;
	});

	// ── Phase 3: Clean markdown formatting ──

	// Headers → just the text
	result = result.replace(/^#{1,6}\s+/gm, "");

	// Bold **text** or __text__
	result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
	result = result.replace(/__([^_]+)__/g, "$1");

	// Italic *text* or _text_
	result = result.replace(/\*([^*]+)\*/g, "$1");
	result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");

	// Strikethrough
	result = result.replace(/~~([^~]+)~~/g, "$1");

	// Blockquotes
	result = result.replace(/^>\s?/gm, "");

	// List markers → slight pause (period)
	result = result.replace(/^[\s]*[-*+]\s+/gm, ". ");
	result = result.replace(/^[\s]*\d+\.\s+/gm, ". ");

	// ── Phase 4: Clean up symbols and artifacts ──

	// Arrows → skip
	result = result.replace(/[=-]>/g, " ");
	result = result.replace(/<[=-]/g, " ");

	// Emojis — remove most, keep common ones by replacing with words
	result = result.replace(/✅/g, "");
	result = result.replace(/❌/g, "");
	result = result.replace(/⭐/g, "");
	result = result.replace(/🔊/g, "");
	result = result.replace(/📥/g, "");
	result = result.replace(/📦/g, "");
	// Remove remaining emojis (broad unicode ranges)
	result = result.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");
	result = result.replace(/[\u{2600}-\u{26FF}]/gu, "");
	result = result.replace(/[\u{2700}-\u{27BF}]/gu, "");

	// Remaining pipe chars (from broken tables)
	result = result.replace(/\|/g, " ");

	// Multiple dashes
	result = result.replace(/-{2,}/g, " ");

	// Backticks (orphaned)
	result = result.replace(/`/g, "");

	// Asterisks/underscores (orphaned)
	result = result.replace(/\*+/g, "");

	// Hash marks (orphaned)
	result = result.replace(/^#+\s*/gm, "");

	// Parentheses with only whitespace/nothing
	result = result.replace(/\(\s*\)/g, "");

	// Square brackets with only whitespace/nothing
	result = result.replace(/\[\s*\]/g, "");

	// ── Phase 5: Normalize whitespace for natural speech ──

	// Multiple newlines → double (pause)
	result = result.replace(/\n{3,}/g, "\n\n");

	// Lines that are only whitespace
	result = result.replace(/^\s+$/gm, "");

	// Multiple spaces
	result = result.replace(/ {2,}/g, " ");

	// Leading/trailing whitespace per line
	result = result.replace(/^[ \t]+|[ \t]+$/gm, "");

	// Multiple periods (from list conversion)
	result = result.replace(/\.{2,}/g, ".");

	// Period after period with space
	result = result.replace(/\.\s*\./g, ".");

	return result.trim();
}

/**
 * Convert code-like identifiers to spoken words.
 * camelCase → "camel case"
 * snake_case → "snake case"
 * file.ext → "file dot ext"
 */
function codeToWords(code: string): string {
	let result = code;

	// dots → "dot"
	result = result.replace(/\./g, " dot ");

	// underscores → spaces
	result = result.replace(/_/g, " ");

	// hyphens → spaces
	result = result.replace(/-/g, " ");

	// camelCase → "camel case"
	result = result.replace(/([a-z])([A-Z])/g, "$1 $2");

	// Remove remaining non-alphanumeric noise (=, <, >, etc.)
	result = result.replace(/[^a-zA-Z0-9\s]/g, " ");

	// Collapse spaces
	result = result.replace(/\s+/g, " ");

	return result.trim().toLowerCase();
}

/**
 * Split prepared text into sentence-sized chunks for streaming TTS.
 * Each chunk is short enough for fast generation but long enough
 * to sound natural.
 */
export function splitIntoChunks(text: string): string[] {
	// First split on paragraph breaks
	const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

	const chunks: string[] = [];

	for (const para of paragraphs) {
		// Split paragraph into sentences on . ! ? followed by a space
		const sentences = para.split(/(?<=[.!?])\s+/).filter(s => s.trim());

		let buffer = "";
		for (const sentence of sentences) {
			const trimmed = sentence.trim();
			if (!trimmed) continue;

			if (!buffer) {
				buffer = trimmed;
			} else if (buffer.length + trimmed.length < 120) {
				buffer += " " + trimmed;
			} else {
				chunks.push(cleanChunk(buffer));
				buffer = trimmed;
			}
		}
		if (buffer.trim()) {
			chunks.push(cleanChunk(buffer));
		}
	}

	return chunks.filter(c => c.length > 0);
}

function cleanChunk(text: string): string {
	return text
		.replace(/\.{2,}/g, ".")
		.replace(/\.\s*\./g, ".")
		.replace(/^\s*\.\s*/, "")
		.replace(/\n/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/**
 * Legacy alias for backward compatibility.
 */
export function stripMarkdown(text: string): string {
	return prepareForSpeech(text);
}
