import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HerdrClient, HerdrError, HerdrEventStream } from "./client";

// A real unix-domain-socket server standing in for herdr, so the tests exercise the actual
// framing/demux code path rather than a mocked net.Socket. Models herdr's real (empirically
// confirmed, see client.ts) connection lifecycle: one request per connection, except
// events.subscribe, which is left open for the test to push events on afterward.
class MockHerdrServer {
	readonly socketPath: string;
	private server: Server | null = null;
	private readonly openSockets = new Set<Socket>();
	private readonly subscriberSockets: Socket[] = [];
	onRequest: (id: string, method: string, params: unknown, socket: Socket) => void = () => {};

	constructor() {
		this.socketPath = join(tmpdir(), `herdr-client-test-${randomBytes(6).toString("hex")}.sock`);
	}

	start(): Promise<void> {
		return new Promise((resolve) => {
			this.server = createServer((socket) => {
				this.openSockets.add(socket);
				socket.on("close", () => this.openSockets.delete(socket));
				socket.setEncoding("utf8");
				let buffer = "";
				socket.on("data", (chunk: string) => {
					buffer += chunk;
					const idx = buffer.indexOf("\n");
					if (idx === -1) return; // one request per connection — only the first line is ever a request
					const line = buffer.slice(0, idx);
					const msg = JSON.parse(line);
					if (msg.method === "events.subscribe") this.subscriberSockets.push(socket);
					this.onRequest(msg.id, msg.method, msg.params, socket);
				});
			});
			this.server.listen(this.socketPath, resolve);
		});
	}

	/** Sends a push message (no id) to every socket that has subscribed. */
	push(msg: Record<string, unknown>): void {
		for (const socket of this.subscriberSockets) socket.write(`${JSON.stringify(msg)}\n`);
	}

	reply(socket: Socket, id: string, result: unknown): void {
		socket.write(`${JSON.stringify({ id, result })}\n`);
	}

	replyError(socket: Socket, id: string, code: string, message: string): void {
		socket.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
	}

	stop(): Promise<void> {
		for (const socket of this.openSockets) socket.destroy();
		return new Promise((resolve) => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
	}
}

let mockServer: MockHerdrServer;

beforeEach(async () => {
	mockServer = new MockHerdrServer();
	await mockServer.start();
});

afterEach(async () => {
	await mockServer.stop();
	if (existsSync(mockServer.socketPath)) rmSync(mockServer.socketPath, { force: true });
});

describe("HerdrClient — one-shot call()", () => {
	it("round-trips a call, resolving with the server's result", async () => {
		mockServer.onRequest = (id, method, params, socket) => {
			expect(method).toBe("ping");
			expect(params).toEqual({});
			mockServer.reply(socket, id, { type: "pong", version: "0.8.2", protocol: 20 });
		};

		const client = new HerdrClient({ socketPath: mockServer.socketPath });
		const result = await client.call("ping", {});
		expect(result).toEqual({ type: "pong", version: "0.8.2", protocol: 20 });
	});

	it("opens a fresh connection per call — two calls from one client don't collide", async () => {
		const seenMethods: string[] = [];
		mockServer.onRequest = (id, method, params, socket) => {
			seenMethods.push(method);
			const target = params as { pane_id: string };
			mockServer.reply(socket, id, { type: "pane_info", pane: paneInfo(target.pane_id) });
		};

		const client = new HerdrClient({ socketPath: mockServer.socketPath });
		const [a, b] = await Promise.all([client.call("pane.get", { pane_id: "w1:p1" }), client.call("pane.get", { pane_id: "w1:p2" })]);
		expect(seenMethods.sort()).toEqual(["pane.get", "pane.get"]);
		expect([a.pane.pane_id, b.pane.pane_id].sort()).toEqual(["w1:p1", "w1:p2"]);
	});

	it("rejects the call with a HerdrError on an error response", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => {
			mockServer.replyError(socket, id, "invalid_request", "unknown variant `bogus`");
		};

		const client = new HerdrClient({ socketPath: mockServer.socketPath });
		await expect(client.call("pane.read", { pane_id: "w1:p1", source: "visible" })).rejects.toMatchObject(
			new HerdrError("invalid_request", "unknown variant `bogus`"),
		);
	});

	it("rejects when the connection closes before a response arrives", async () => {
		mockServer.onRequest = (_id, _method, _params, socket) => {
			socket.destroy(); // simulate herdr dropping the connection mid-request
		};

		const client = new HerdrClient({ socketPath: mockServer.socketPath });
		await expect(client.call("ping", {})).rejects.toThrow(/closed/);
	});

	it("rejects when the socket path doesn't exist", async () => {
		const client = new HerdrClient({ socketPath: join(tmpdir(), "no-such-herdr.sock") });
		await expect(client.call("ping", {})).rejects.toThrow();
	});
});

describe("HerdrEventStream — subscribe once, listen for pushes (pane.updated channel fork, trk-s5d.1)", () => {
	it("open() sends exactly one events.subscribe and resolves with the ack", async () => {
		mockServer.onRequest = (id, method, params, socket) => {
			expect(method).toBe("events.subscribe");
			expect(params).toEqual({ subscriptions: [{ type: "pane.updated" }] });
			mockServer.reply(socket, id, { type: "subscription_started" });
		};

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await expect(stream.open([{ type: "pane.updated" }])).resolves.toEqual({ type: "subscription_started" });
		stream.close();
	});

	it("rejects a second open() call on the same instance", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => mockServer.reply(socket, id, { type: "subscription_started" });

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await stream.open([{ type: "pane.updated" }]);
		await expect(stream.open([{ type: "pane.updated" }])).rejects.toThrow(/once per instance/);
		stream.close();
	});

	it("onPaneUpdated fires only for the matching pane_id, ignoring other panes' updates", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => mockServer.reply(socket, id, { type: "subscription_started" });

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await stream.open([{ type: "pane.updated" }]);

		const received: number[] = [];
		const unsubscribe = stream.onPaneUpdated("w1:p1", (pane) => received.push(pane.revision));

		// The pane.updated subscription is unfiltered server-side (confirmed live against herdr
		// 0.8.2) — the mock fires updates for two different panes to prove client-side filtering.
		mockServer.push({ event: "pane_updated", data: { type: "pane_updated", pane: paneInfo("w1:p1", 3) } });
		mockServer.push({ event: "pane_updated", data: { type: "pane_updated", pane: paneInfo("w2:p9", 7) } });
		mockServer.push({ event: "pane_updated", data: { type: "pane_updated", pane: paneInfo("w1:p1", 4) } });
		await flushMicrotasks();
		expect(received).toEqual([3, 4]);

		unsubscribe();
		mockServer.push({ event: "pane_updated", data: { type: "pane_updated", pane: paneInfo("w1:p1", 5) } });
		await flushMicrotasks();
		expect(received).toEqual([3, 4]); // unchanged after unsubscribe
		stream.close();
	});

	it("onPaneExited fires only for the matching pane_id", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => mockServer.reply(socket, id, { type: "subscription_started" });

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await stream.open([{ type: "pane.exited" }]);

		let exited = 0;
		stream.onPaneExited("w1:p1", () => {
			exited++;
		});
		mockServer.push({ event: "pane_exited", data: { type: "pane_exited", pane_id: "w2:p9", workspace_id: "w2" } });
		mockServer.push({ event: "pane_exited", data: { type: "pane_exited", pane_id: "w1:p1", workspace_id: "w1" } });
		await flushMicrotasks();

		expect(exited).toBe(1);
		stream.close();
	});

	it("rejects open() with a HerdrError when the subscribe itself errors", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => mockServer.replyError(socket, id, "invalid_request", "bad subscription");

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await expect(stream.open([{ type: "pane.updated" }])).rejects.toMatchObject(new HerdrError("invalid_request", "bad subscription"));
	});

	it("emits 'close' when the server drops the subscriber connection", async () => {
		mockServer.onRequest = (id, _method, _params, socket) => mockServer.reply(socket, id, { type: "subscription_started" });

		const stream = new HerdrEventStream({ socketPath: mockServer.socketPath });
		await stream.open([{ type: "pane.updated" }]);

		const closed = new Promise<void>((resolve) => stream.on("close", resolve));
		await mockServer.stop();
		await closed;
	});
});

function paneInfo(paneId: string, revision = 1) {
	return {
		pane_id: paneId,
		workspace_id: paneId.split(":")[0],
		tab_id: `${paneId.split(":")[0]}:t1`,
		terminal_id: "term_x",
		focused: false,
		agent_status: "idle" as const,
		revision,
	};
}

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
