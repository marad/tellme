import { describe, it, expect } from "vitest";
import { trimSilence } from "../audio-player.js";

describe("trimSilence", () => {
	it("returns same array when no trimming requested", () => {
		const samples = new Float32Array([0, 0, 0.5, 0.5, 0, 0]);
		const result = trimSilence(samples, false, false);
		expect(result).toBe(samples); // same reference
	});

	it("trims leading silence", () => {
		const samples = new Float32Array([
			...Array(500).fill(0),       // silence
			...Array(100).fill(0.5),     // audio
			...Array(100).fill(0),       // trailing silence
		]);
		const result = trimSilence(samples, true, false);
		expect(result.length).toBeLessThan(samples.length);
		// Should still contain the audio portion
		expect(result.some(s => Math.abs(s) >= 0.5)).toBe(true);
		// Should still have trailing silence (not trimmed)
		expect(result[result.length - 1]).toBe(0);
	});

	it("trims trailing silence", () => {
		const samples = new Float32Array([
			...Array(100).fill(0),       // leading silence
			...Array(100).fill(0.5),     // audio
			...Array(500).fill(0),       // trailing silence
		]);
		const result = trimSilence(samples, false, true);
		expect(result.length).toBeLessThan(samples.length);
		// Should still have leading silence
		expect(result[0]).toBe(0);
		// Should still contain audio
		expect(result.some(s => Math.abs(s) >= 0.5)).toBe(true);
	});

	it("trims both leading and trailing silence", () => {
		const samples = new Float32Array([
			...Array(500).fill(0),       // leading silence
			...Array(100).fill(0.5),     // audio
			...Array(500).fill(0),       // trailing silence
		]);
		const result = trimSilence(samples, true, true);
		expect(result.length).toBeLessThan(samples.length);
		// The trimmed result should be much shorter than original
		expect(result.length).toBeLessThan(800);
		// Should still contain audio
		expect(result.some(s => Math.abs(s) >= 0.5)).toBe(true);
	});

	it("keeps keepSamples padding around audio boundary", () => {
		const samples = new Float32Array([
			...Array(1000).fill(0),      // silence
			...Array(100).fill(0.5),     // audio
			...Array(1000).fill(0),      // silence
		]);
		// default keepSamples = 200
		const result = trimSilence(samples, true, true);
		// Should be: ~200 (keep before) + 100 (audio) + ~200 (keep after)
		expect(result.length).toBeGreaterThanOrEqual(300);
		expect(result.length).toBeLessThanOrEqual(600);
	});

	it("handles all-silence input", () => {
		const samples = new Float32Array(1000).fill(0);
		const result = trimSilence(samples, true, true);
		// Should not crash; may return very short or empty subarray
		expect(result.length).toBeLessThanOrEqual(samples.length);
	});

	it("handles no-silence input (all audio)", () => {
		const samples = new Float32Array(100).fill(0.5);
		const result = trimSilence(samples, true, true);
		// Nothing to trim → should return same or very similar
		expect(result.length).toBe(samples.length);
	});

	it("respects custom threshold", () => {
		const samples = new Float32Array([
			...Array(100).fill(0.02),    // below default threshold (0.01) but above custom
			...Array(100).fill(0.5),     // audio
			...Array(100).fill(0.02),    // below default threshold
		]);
		// With high threshold (0.1), the 0.02 values are "silence"
		const result = trimSilence(samples, true, true, 0.1, 0);
		expect(result.length).toBe(100); // just the audio
	});

	it("respects custom keepSamples", () => {
		const samples = new Float32Array([
			...Array(500).fill(0),
			...Array(100).fill(0.5),
			...Array(500).fill(0),
		]);
		const result = trimSilence(samples, true, true, 0.01, 50);
		// ~50 + 100 + ~50 = ~200
		expect(result.length).toBeGreaterThanOrEqual(150);
		expect(result.length).toBeLessThanOrEqual(300);
	});
});
