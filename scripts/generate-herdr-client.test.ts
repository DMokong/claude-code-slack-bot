import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ApiSchema, generate } from "./generate-herdr-client";

// A small, hand-picked slice of a real `herdr api schema --json` dump (protocol 20) — just
// enough to cover the methods/events this generator whitelists. See src/herdr/__fixtures__.
const FIXTURE_PATH = join(__dirname, "..", "src", "herdr", "__fixtures__", "schema-slice.json");
const fixtureSchema: ApiSchema = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

describe("generate-herdr-client — codegen from the schema-slice fixture", () => {
	it("namespaces each schema category so identically-named defs don't collide", () => {
		const output = generate(fixtureSchema);

		// AgentStatus, ReadFormat, ReadSource etc. are declared independently per category in the
		// real schema — a flat emission would produce duplicate `export type` declarations.
		expect(output).toContain("export namespace HerdrRequest {");
		expect(output).toContain("export namespace HerdrResponse {");
		expect(output).toContain("export namespace HerdrSubscriptionEvent {");
		expect(output).toContain("export namespace HerdrEvent {");

		expect((output.match(/export type AgentStatus =/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it("emits the whitelisted method map with namespace-qualified params/result types", () => {
		const output = generate(fixtureSchema);

		expect(output).toContain('"ping": { params: HerdrRequest.PingParams; result: HerdrResponse.PingResponse };');
		expect(output).toContain(
			'"pane.read": { params: HerdrRequest.PaneReadParams; result: HerdrResponse.PaneReadResponse };',
		);
		expect(output).toContain(
			'"events.subscribe": { params: HerdrRequest.EventsSubscribeParams; result: HerdrResponse.EventsSubscribeResponse };',
		);
	});

	it("filters the broad event channel to the wired kinds and keeps pane_output_changed out (trk-s5d.1)", () => {
		const output = generate(fixtureSchema);

		expect(output).toMatch(/export type EventKind = "pane_updated" \| "pane_exited" \| "pane_agent_status_changed";/);
		// pane_output_changed is discussed in an explanatory comment (it has no Subscription variant
		// at all — see trk-s5d.1) but must never appear as an actual string-literal union member.
		expect(output).not.toContain('"pane_output_changed"');
	});

	it("keeps the subscription_event channel's 3 CLI-typed kinds distinct from the broad channel", () => {
		const output = generate(fixtureSchema);

		expect(output).toContain(
			'export type SubscriptionEventKind = "pane.output_matched" | "pane.agent_status_changed" | "pane.scroll_changed";',
		);
	});

	it("throws if a whitelisted method is missing from the schema", () => {
		const broken: ApiSchema = JSON.parse(JSON.stringify(fixtureSchema));
		broken.schemas.request.oneOf = broken.schemas.request.oneOf!.filter(
			(entry: any) => entry.properties.method.const !== "pane.list",
		);

		expect(() => generate(broken)).toThrow(/pane\.list/);
	});

	it("throws if a whitelisted method's result tag is missing from ResponseResult", () => {
		const broken: ApiSchema = JSON.parse(JSON.stringify(fixtureSchema));
		broken.schemas.success_response.$defs!.ResponseResult.oneOf = broken.schemas.success_response.$defs!.ResponseResult.oneOf.filter(
			(entry: any) => entry.properties?.type?.const !== "pong",
		);

		expect(() => generate(broken)).toThrow(/pong/);
	});

	it("produces output that actually compiles under the project's strict tsconfig", () => {
		const output = generate(fixtureSchema);
		const dir = mkdtempSync(join(tmpdir(), "herdr-codegen-test-"));
		const file = join(dir, "generated.ts");
		writeFileSync(file, output);

		try {
			execFileSync("npx", ["tsc", "--noEmit", "--strict", "--target", "ES2020", "--module", "commonjs", "--lib", "ES2020", file], {
				stdio: "pipe",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
