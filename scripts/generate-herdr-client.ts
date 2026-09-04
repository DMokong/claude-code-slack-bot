#!/usr/bin/env tsx
// Codegen: turns herdr's published JSON Schema into TypeScript types for the
// socket API. herdr publishes ~255KB of JSON Schema covering ~90 methods plus
// request/response/event/subscription_event shapes (protocol 20) via
// `herdr api schema --json`. Rather than hand-typing (or worse, reading the
// Rust source) this generates directly from that schema, scoped to what the
// slack bot's transport needs today: session-lifecycle basics (ping,
// pane.list, pane.get), pane.read, and events.subscribe.
//
// Regenerate:
//   herdr api schema --json > src/herdr/api-schema.json
//   npx tsx scripts/generate-herdr-client.ts
//
// To widen scope later, add to REQUEST_METHODS / EVENT_KINDS below — the
// resolver walks whatever $defs those pull in automatically.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REQUEST_METHODS = ["ping", "pane.list", "pane.get", "pane.read", "events.subscribe"] as const;

// The schema has no declared mapping from request method -> response "type"
// tag; it's a naming convention in the server, not a schema relationship.
// Keep this table in lockstep with REQUEST_METHODS (validated at gen time).
const RESULT_TYPE_BY_METHOD: Record<(typeof REQUEST_METHODS)[number], string> = {
	ping: "pong",
	"pane.list": "pane_list",
	"pane.get": "pane_info",
	"pane.read": "pane_read",
	"events.subscribe": "subscription_started",
};

// pane_output_changed itself is NOT a subscribable Subscription variant (see
// trk-s5d.1 finding) — pane_updated is the reachable substitute: it fires on
// the same revision-bumping triggers and carries the full pane snapshot.
const EVENT_KINDS = ["pane_updated", "pane_exited", "pane_agent_status_changed"] as const;

type JsonSchema = Record<string, any>;

interface SchemaCategory {
	properties?: Record<string, JsonSchema>;
	oneOf?: JsonSchema[];
	$defs?: Record<string, JsonSchema>;
}

interface ApiSchema {
	protocol: number;
	schema_version: number;
	schemas: Record<string, SchemaCategory>;
}

/** Resolves $refs and inline shapes within one top-level schema category (refs never cross categories). */
class CategoryResolver {
	private readonly defs: Record<string, JsonSchema>;
	private readonly emitted = new Map<string, string>();
	private readonly emitting = new Set<string>();

	constructor(
		private readonly categoryName: string,
		category: SchemaCategory,
	) {
		this.defs = category.$defs ?? {};
	}

	/** Resolves a $ref into a named type, emitting it (and its dependencies) on first use. */
	resolveRef(ref: string): string {
		const name = ref.split("/").pop()!;
		return this.defineType(name, () => {
			const def = this.defs[name];
			if (!def) throw new Error(`unknown $ref ${ref} in category ${this.categoryName}`);
			return def;
		});
	}

	/** Registers a type under an explicit name (used for hand-filtered enums/unions not tied 1:1 to a $def). */
	defineType(name: string, load: () => JsonSchema): string {
		if (this.emitted.has(name) || this.emitting.has(name)) return name;
		this.emitting.add(name);
		const body = this.resolveNode(load());
		this.emitted.set(name, body);
		this.emitting.delete(name);
		return name;
	}

	resolveNode(node: JsonSchema): string {
		if (node.$ref) return this.resolveRef(node.$ref);
		if (node.oneOf) return node.oneOf.map((n: JsonSchema) => this.resolveNode(n)).join(" | ");
		if (node.anyOf) return node.anyOf.map((n: JsonSchema) => this.resolveNode(n)).join(" | ");
		if (node.const !== undefined) return JSON.stringify(node.const);
		if (node.enum) return node.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");

		const types: string[] = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
		if (types.includes("array") || node.items) {
			return `Array<${node.items ? this.resolveNode(node.items) : "unknown"}>`;
		}
		if (types.includes("object") || node.properties || node.additionalProperties) {
			return this.resolveObject(node);
		}

		const parts: string[] = [];
		for (const t of types) {
			if (t === "string") parts.push("string");
			else if (t === "integer" || t === "number") parts.push("number");
			else if (t === "boolean") parts.push("boolean");
			else if (t === "null") parts.push("null");
			else if (t === "object") parts.push("Record<string, unknown>");
		}
		return parts.length > 0 ? parts.join(" | ") : "unknown";
	}

	private resolveObject(node: JsonSchema): string {
		const props: Record<string, JsonSchema> | undefined = node.properties;
		if (!props) {
			return node.additionalProperties
				? `Record<string, ${this.resolveNode(node.additionalProperties)}>`
				: "Record<string, never>";
		}
		const required: string[] = node.required ?? [];
		const lines = Object.entries(props).map(([key, propSchema]) => {
			const optional = required.includes(key) ? "" : "?";
			return `\t${key}${optional}: ${this.resolveNode(propSchema)};`;
		});
		return `{\n${lines.join("\n")}\n}`;
	}

	render(): string {
		return [...this.emitted.entries()].map(([name, body]) => `export type ${name} = ${body};`).join("\n\n");
	}
}

function indent(body: string): string {
	return body
		.split("\n")
		.map((line) => (line.length > 0 ? `\t${line}` : line))
		.join("\n");
}

function toPascalCase(method: string): string {
	return method
		.split(/[._]/)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join("");
}

function generate(schema: ApiSchema): string {
	const banner = [
		"// GENERATED FILE — do not hand-edit.",
		`// Source: src/herdr/api-schema.json (herdr protocol ${schema.protocol}, schema_version ${schema.schema_version}).`,
		"// Regenerate with: npx tsx scripts/generate-herdr-client.ts",
	].join("\n");

	// --- requests: params + a synthetic <Method>Response wrapper per whitelisted method ---
	const requestCategory = schema.schemas.request;
	const requestResolver = new CategoryResolver("request", requestCategory);
	const successCategory = schema.schemas.success_response;
	const successResolver = new CategoryResolver("success_response", successCategory);
	const responseResultOneOf: JsonSchema[] = successCategory.$defs!.ResponseResult.oneOf;

	const mapEntries: string[] = [];
	for (const method of REQUEST_METHODS) {
		const entry = requestCategory.oneOf!.find((e) => e.properties!.method.const === method);
		if (!entry) throw new Error(`method not found in schema: ${method}`);
		// Whitelisted methods' params are always named $defs (never inline), so this is always a bare name.
		const paramsType = requestResolver.resolveNode(entry.properties!.params);

		const resultTag = RESULT_TYPE_BY_METHOD[method];
		const resultEntry = responseResultOneOf.find((e) => e.properties?.type?.const === resultTag);
		if (!resultEntry) throw new Error(`result type '${resultTag}' for method '${method}' not found in ResponseResult`);
		const responseName = `${toPascalCase(method)}Response`;
		successResolver.defineType(responseName, () => resultEntry);

		mapEntries.push(
			`\t${JSON.stringify(method)}: { params: HerdrRequest.${paramsType}; result: HerdrResponse.${responseName} };`,
		);
	}

	// --- subscription_event: the 3 kinds actually reachable via the CLI-typed subscription enum ---
	const subscriptionEventCategory = schema.schemas.subscription_event;
	const subscriptionResolver = new CategoryResolver("subscription_event", subscriptionEventCategory);
	const subscriptionEnvelopeProps = subscriptionEventCategory.properties!;
	const subscriptionEventKindType = subscriptionResolver.resolveNode(subscriptionEnvelopeProps.event);
	const subscriptionEventDataType = subscriptionResolver.resolveNode(subscriptionEnvelopeProps.data);

	// --- event: broad channel, filtered to EVENT_KINDS (pane_output_changed itself is unreachable — see notes above) ---
	const eventCategory = schema.schemas.event;
	const eventResolver = new CategoryResolver("event", eventCategory);
	const fullEventData: JsonSchema[] = eventCategory.$defs!.EventData.oneOf;
	eventResolver.defineType("EventKind", () => ({ type: "string", enum: EVENT_KINDS }));
	eventResolver.defineType("EventData", () => ({
		oneOf: fullEventData.filter((m) => EVENT_KINDS.includes(m.properties.type.const)),
	}));

	// Each top-level schema category ($schema/schemas/<category>/$defs) is its own JSON Schema
	// namespace — names like AgentStatus or PaneInfo are declared independently per category and
	// happen to share text today, but nothing guarantees they'll stay identical. Namespacing by
	// category (rather than flattening into one type per name) keeps that honest and collision-free.
	return `${banner}

export const HERDR_PROTOCOL_VERSION = ${schema.protocol};

// ---- request/response, scoped to REQUEST_METHODS in generate-herdr-client.ts ----

export namespace HerdrRequest {
${indent(requestResolver.render())}
}

export namespace HerdrResponse {
${indent(successResolver.render())}
}

export interface HerdrRequestMap {
${mapEntries.join("\n")}
}

export type HerdrMethod = keyof HerdrRequestMap;

// ---- subscription_event: the narrow CLI-exposed channel (3 kinds) ----

export namespace HerdrSubscriptionEvent {
${indent(subscriptionResolver.render())}
}

export interface SubscriptionEventEnvelope {
\tevent: HerdrSubscriptionEvent.${subscriptionEventKindType};
\tdata: HerdrSubscriptionEvent.${subscriptionEventDataType};
}

// ---- event: broad channel, filtered to what the transport wires (pane_updated substitutes for the
// unreachable pane_output_changed; see trk-s5d.1). Subscribing to these Subscription variants is
// unfiltered server-side — no pane_id scoping — so the transport must filter by pane_id itself. ----

export namespace HerdrEvent {
${indent(eventResolver.render())}
}

export interface EventEnvelope {
\tevent: HerdrEvent.EventKind;
\tdata: HerdrEvent.EventData;
}
`;
}

function main() {
	const args = process.argv.slice(2);
	const schemaPath = args[0] ?? join(__dirname, "..", "src", "herdr", "api-schema.json");
	const outPath = args[1] ?? join(__dirname, "..", "src", "herdr", "generated.ts");

	const schema: ApiSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
	const output = generate(schema);
	writeFileSync(outPath, output);
	console.log(`wrote ${outPath} from ${schemaPath} (protocol ${schema.protocol})`);
}

if (require.main === module) {
	main();
}

export { generate, type ApiSchema };
