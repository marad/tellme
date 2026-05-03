import { describe, it, expect, afterEach } from "vitest";
import { shouldUseDaemon } from "../daemon-routing.js";

describe("shouldUseDaemon", () => {
	it("returns true for an empty env", () => {
		expect(shouldUseDaemon({})).toBe(true);
	});

	it("returns false when TELLME_NO_DAEMON is exactly '1'", () => {
		expect(shouldUseDaemon({ TELLME_NO_DAEMON: "1" })).toBe(false);
	});

	it("returns true when TELLME_NO_DAEMON is '0'", () => {
		expect(shouldUseDaemon({ TELLME_NO_DAEMON: "0" })).toBe(true);
	});

	it("returns true when TELLME_NO_DAEMON is 'true' (only literal '1' opts out)", () => {
		expect(shouldUseDaemon({ TELLME_NO_DAEMON: "true" })).toBe(true);
	});

	it("returns true when TELLME_NO_DAEMON is the empty string", () => {
		expect(shouldUseDaemon({ TELLME_NO_DAEMON: "" })).toBe(true);
	});

	describe("default arg (process.env)", () => {
		const original = process.env.TELLME_NO_DAEMON;

		afterEach(() => {
			if (original === undefined) {
				delete process.env.TELLME_NO_DAEMON;
			} else {
				process.env.TELLME_NO_DAEMON = original;
			}
		});

		it("reads from process.env when no arg is supplied", () => {
			process.env.TELLME_NO_DAEMON = "1";
			expect(shouldUseDaemon()).toBe(false);
		});
	});
});
