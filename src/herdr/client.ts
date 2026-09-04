// Transport for herdr's unix-socket API (protocol 20). herdr's CLI does not stream — to receive
// push notifications (e.g. output changes) a client has to speak the socket protocol directly.
// This is that client, built on the types generated from herdr's published JSON Schema (see
// generated.ts and scripts/generate-herdr-client.ts).
//
// Wire format (reverse-engineered empirically against a live herdr 0.8.2 instance; the schema
// documents payload shapes but not framing or connection lifecycle):
//   - newline-delimited JSON over a unix domain socket
//   - request:  {"id": "<string>", "method": "<name>", "params": {...}}
//   - response: {"id": "<same string>", "result": {...}} | {"id": ..., "error": {code, message}}
//   - push:     {"event": "<kind>", "data": {...}} — no "id" field; demux on that.
//
// AUTH: the socket has srw------- perms (owner read/write only) — no bearer token, unlike
// webterm's ~/.webterm/token file.
//
// CONNECTION LIFECYCLE (the load-bearing finding of trk-s5d.1, not documented anywhere): herdr's
// socket protocol is ONE REQUEST PER CONNECTION. Confirmed live: two plain `ping` calls sent
// back-to-back on the same connection get the second closed with EOF before any response — this
// isn't specific to any one method. It matches how the CLI itself talks to the socket (a fresh
// process, hence a fresh connection, per invocation). `events.subscribe` is the one exception:
// a successful subscribe keeps that connection open indefinitely to deliver pushes — but sending
// *any* further request on it afterward (including a second events.subscribe, tested live) is out
// of contract and was observed to close the connection. HerdrClient.call() therefore opens a new
// connection per call; HerdrEventStream sends exactly one events.subscribe and never reuses the
// connection for anything else.
//
// CHANNEL FORK (trk-s5d.1): `events.subscribe` accepts a broader set of Subscription variants than
// the 3 kinds formally typed in the schema's subscription_event category (pane.output_matched,
// pane.agent_status_changed, pane.scroll_changed). Subscribing to "pane.updated" — one of ~27
// additional variants request-side — was verified live to deliver real push notifications shaped
// like the broad `event` schema (kind pane_updated, full PaneInfo payload including `revision`).
// pane_output_changed itself has no Subscription variant at all, so pane.updated is the reachable
// substitute: it fires on the same revision-bumping triggers, wake-then-pane.read still applies.
// Confirmed live: pane.updated does NOT accept a pane_id filter (the Subscription schema variant
// for it has no pane_id property) — subscribing delivers updates for every pane on the herdr
// instance, so callers must filter client-side (see onPaneUpdated below).
//
// CAVEAT (also live-confirmed): revision only appeared to bump for panes hosting a detected agent.
// A bare shell pane's content visibly changed (verified by re-reading it) but its revision stayed
// at 0 and no pane_updated push fired for it, while sibling panes running claude/codex bumped
// revision and pushed normally on every real change. The bot's target panes always host a detected
// Claude Code agent, so this shouldn't bite in practice — but it means onPaneUpdated is not a
// generic "any pane's output changed" signal for arbitrary panes, only for agent-hosting ones.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventEnvelope, HerdrEvent, HerdrMethod, HerdrRequest, HerdrRequestMap } from "./generated";

export const DEFAULT_HERDR_SOCKET_PATH = join(homedir(), ".config", "herdr", "herdr.sock");

export interface HerdrClientOptions {
	/** Defaults to $HERDR_SOCKET_PATH, then ~/.config/herdr/herdr.sock. */
	socketPath?: string;
}

export class HerdrError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "HerdrError";
	}
}

function resolveSocketPath(opts: HerdrClientOptions): string {
	return opts.socketPath ?? process.env.HERDR_SOCKET_PATH ?? DEFAULT_HERDR_SOCKET_PATH;
}

/** One-shot request/response calls. See the connection-lifecycle note above for why this opens a fresh socket per call. */
export class HerdrClient {
	private readonly socketPath: string;

	constructor(opts: HerdrClientOptions = {}) {
		this.socketPath = resolveSocketPath(opts);
	}

	call<M extends HerdrMethod>(method: M, params: HerdrRequestMap[M]["params"]): Promise<HerdrRequestMap[M]["result"]> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(this.socketPath);
			socket.setEncoding("utf8");
			const id = randomUUID();
			let buffer = "";
			let settled = false;

			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				fn();
				socket.destroy();
			};

			socket.once("error", (err) => finish(() => reject(err)));
			socket.once("close", () => finish(() => reject(new Error("herdr socket closed before a response arrived"))));
			socket.once("connect", () => {
				socket.write(`${JSON.stringify({ id, method, params })}\n`);
			});
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) return;
				const line = buffer.slice(0, newlineIndex);
				let msg: { id: string; result?: unknown; error?: { code: string; message: string } };
				try {
					msg = JSON.parse(line);
				} catch (err) {
					finish(() => reject(new Error(`herdr sent a line that isn't valid JSON: ${(err as Error).message}`)));
					return;
				}
				finish(() => {
					if (msg.error) reject(new HerdrError(msg.error.code, msg.error.message));
					else resolve(msg.result as HerdrRequestMap[M]["result"]);
				});
			});
		});
	}
}

type PushMessage = EventEnvelope;

export declare interface HerdrEventStream {
	on(event: "push", listener: (msg: PushMessage) => void): this;
	on(event: "close", listener: () => void): this;
	on(event: "error", listener: (err: Error) => void): this;
}

/**
 * A dedicated persistent connection for one events.subscribe call and the pushes it produces.
 * Per the connection-lifecycle note above, this sends exactly one request, ever — to subscribe to
 * a different set of kinds, open a new HerdrEventStream instead of reusing this one.
 */
export class HerdrEventStream extends EventEmitter {
	private readonly socketPath: string;
	private socket: Socket | null = null;
	private buffer = "";
	private opened = false;
	private pendingAck: ((line: string) => void) | null = null;

	constructor(opts: HerdrClientOptions = {}) {
		super();
		this.socketPath = resolveSocketPath(opts);
	}

	get connected(): boolean {
		return this.socket !== null;
	}

	open(subscriptions: HerdrRequest.Subscription[]): Promise<HerdrRequestMap["events.subscribe"]["result"]> {
		if (this.opened) return Promise.reject(new Error("HerdrEventStream.open() may only be called once per instance"));
		this.opened = true;

		return new Promise((resolve, reject) => {
			const socket = createConnection(this.socketPath);
			const onConnectError = (err: Error) => reject(err);
			socket.once("error", onConnectError);
			socket.once("connect", () => {
				socket.off("error", onConnectError);
				socket.setEncoding("utf8");
				this.socket = socket;

				const id = randomUUID();
				this.pendingAck = (line: string) => {
					let msg: { id?: string; result?: unknown; error?: { code: string; message: string } };
					try {
						msg = JSON.parse(line);
					} catch (err) {
						reject(new Error(`herdr sent a line that isn't valid JSON: ${(err as Error).message}`));
						socket.destroy();
						return;
					}
					if (msg.id !== id) {
						reject(new Error(`expected the events.subscribe ack (id ${id}) but got: ${line.slice(0, 200)}`));
						socket.destroy();
						return;
					}
					if (msg.error) reject(new HerdrError(msg.error.code, msg.error.message));
					else resolve(msg.result as HerdrRequestMap["events.subscribe"]["result"]);
				};

				socket.on("data", (chunk: string) => this.onData(chunk));
				socket.on("close", () => {
					this.socket = null;
					this.emit("close");
				});
				socket.on("error", (err) => this.emit("error", err));
				socket.write(`${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } })}\n`);
			});
		});
	}

	close(): void {
		this.socket?.end();
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let newlineIndex: number;
		while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.trim().length === 0) continue;
			if (this.pendingAck) {
				// The ack is always the first line, however many `data` events it takes to arrive;
				// everything after is a push. This must be instance state, not a closure captured
				// per `data` event — the ack can land in a separate TCP frame from later pushes.
				const ack = this.pendingAck;
				this.pendingAck = null;
				ack(line);
				continue;
			}
			this.handlePush(line);
		}
	}

	private handlePush(line: string): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(line);
		} catch (err) {
			this.emit("error", new Error(`herdr sent a line that isn't valid JSON: ${(err as Error).message}`));
			return;
		}
		if (typeof msg.event === "string" && "data" in msg) {
			this.emit("push", msg as unknown as PushMessage);
			return;
		}
		this.emit("error", new Error(`herdr sent an unrecognized push shape: ${line.slice(0, 200)}`));
	}

	/**
	 * Fires on every pane_updated push carrying paneId — the wake signal for "something changed, go
	 * re-read the viewport" (herdr pushes a revision, not content; see module doc). Filters
	 * client-side because the pane.updated subscription itself is server-side unfiltered.
	 */
	onPaneUpdated(paneId: string, cb: (pane: HerdrEvent.PaneInfo) => void): () => void {
		const listener = (msg: PushMessage) => {
			if (msg.event === "pane_updated" && msg.data.type === "pane_updated" && msg.data.pane.pane_id === paneId) {
				cb(msg.data.pane);
			}
		};
		this.on("push", listener);
		return () => this.off("push", listener);
	}

	/** Fires on every pane_exited push carrying paneId. */
	onPaneExited(paneId: string, cb: () => void): () => void {
		const listener = (msg: PushMessage) => {
			if (msg.event === "pane_exited" && msg.data.type === "pane_exited" && msg.data.pane_id === paneId) {
				cb();
			}
		};
		this.on("push", listener);
		return () => this.off("push", listener);
	}
}
