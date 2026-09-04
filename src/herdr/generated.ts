// GENERATED FILE — do not hand-edit.
// Source: src/herdr/api-schema.json (herdr protocol 20, schema_version 1).
// Regenerate with: npx tsx scripts/generate-herdr-client.ts

export const HERDR_PROTOCOL_VERSION = 20;

// ---- request/response, scoped to REQUEST_METHODS in generate-herdr-client.ts ----

export namespace HerdrRequest {
	export type PingParams = Record<string, never>;

	export type PaneListParams = {
		workspace_id?: string | null;
	};

	export type PaneTarget = {
		pane_id: string;
	};

	export type ReadFormat = "text" | "ansi";

	export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";

	export type PaneReadParams = {
		format?: ReadFormat;
		lines?: number | null;
		pane_id: string;
		source: ReadSource;
		strip_ansi?: boolean;
	};

	export type OutputMatch = {
		type: "substring";
		value: string;
	} | {
		type: "regex";
		value: string;
	};

	export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

	export type Subscription = {
		type: "workspace.created";
	} | {
		type: "workspace.updated";
	} | {
		type: "workspace.metadata_updated";
	} | {
		type: "workspace.renamed";
	} | {
		type: "workspace.moved";
	} | {
		type: "workspace.reordered";
	} | {
		type: "workspace.closed";
	} | {
		type: "workspace.focused";
	} | {
		type: "worktree.created";
	} | {
		type: "worktree.opened";
	} | {
		type: "worktree.removed";
	} | {
		type: "tab.created";
	} | {
		type: "tab.closed";
	} | {
		type: "tab.focused";
	} | {
		type: "tab.renamed";
	} | {
		type: "tab.moved";
	} | {
		type: "pane.created";
	} | {
		type: "pane.closed";
	} | {
		type: "pane.updated";
	} | {
		type: "pane.focused";
	} | {
		type: "pane.moved";
	} | {
		type: "pane.exited";
	} | {
		type: "pane.agent_detected";
	} | {
		lines?: number | null;
		match: OutputMatch;
		pane_id: string;
		source: ReadSource;
		strip_ansi?: boolean;
		type: "pane.output_matched";
	} | {
		agent_status?: AgentStatus | null;
		pane_id: string;
		type: "pane.agent_status_changed";
	} | {
		pane_id: string;
		type: "pane.scroll_changed";
	} | {
		type: "layout.updated";
	};

	export type EventsSubscribeParams = {
		subscriptions: Array<Subscription>;
	};

	export type AgentStartParams = {
		args?: Array<string>;
		kind: string;
		name: string;
		pane_id: string;
		timeout_ms?: number | null;
	};

	export type PaneSendKeysParams = {
		keys: Array<string>;
		pane_id: string;
	};
}

export namespace HerdrResponse {
	export type ServerCapabilities = {
		detached_server_daemon?: boolean;
		live_handoff: boolean;
	};

	export type PingResponse = {
		capabilities?: ServerCapabilities | null;
		protocol: number;
		type: "pong";
		version: string;
	};

	export type AgentSessionRefKind = "id" | "path";

	export type AgentSessionInfo = {
		agent: string;
		kind: AgentSessionRefKind;
		source: string;
		value: string;
	};

	export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

	export type PaneScrollInfo = {
		max_offset_from_bottom: number;
		offset_from_bottom: number;
		viewport_rows: number;
	};

	export type PaneInfo = {
		agent?: string | null;
		agent_session?: AgentSessionInfo | null;
		agent_status: AgentStatus;
		cwd?: string | null;
		display_agent?: string | null;
		focused: boolean;
		foreground_cwd?: string | null;
		label?: string | null;
		pane_id: string;
		revision: number;
		scroll?: PaneScrollInfo | null;
		state_labels?: Record<string, string>;
		tab_id: string;
		terminal_id: string;
		terminal_title?: string | null;
		terminal_title_stripped?: string | null;
		title?: string | null;
		tokens?: Record<string, string>;
		workspace_id: string;
	};

	export type PaneListResponse = {
		panes: Array<PaneInfo>;
		type: "pane_list";
	};

	export type PaneGetResponse = {
		pane: PaneInfo;
		type: "pane_info";
	};

	export type ReadFormat = "text" | "ansi";

	export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";

	export type PaneReadResult = {
		format: ReadFormat;
		pane_id: string;
		revision: number;
		source: ReadSource;
		tab_id: string;
		text: string;
		truncated: boolean;
		workspace_id: string;
	};

	export type PaneReadResponse = {
		read: PaneReadResult;
		type: "pane_read";
	};

	export type EventsSubscribeResponse = {
		type: "subscription_started";
	};

	export type AgentInfo = {
		agent?: string | null;
		agent_session?: AgentSessionInfo | null;
		agent_status: AgentStatus;
		cwd?: string | null;
		display_agent?: string | null;
		focused: boolean;
		foreground_cwd?: string | null;
		interactive_ready?: boolean;
		launch_pending?: boolean;
		name?: string | null;
		pane_id: string;
		revision: number;
		screen_detection_skipped?: boolean;
		state_change_seq?: number;
		state_labels?: Record<string, string>;
		tab_id: string;
		terminal_id: string;
		terminal_title?: string | null;
		terminal_title_stripped?: string | null;
		title?: string | null;
		tokens?: Record<string, string>;
		workspace_id: string;
	};

	export type AgentStartResponse = {
		agent: AgentInfo;
		argv: Array<string>;
		type: "agent_started";
	};

	export type PaneSendKeysResponse = {
		type: "ok";
	};
}

export interface HerdrRequestMap {
	"ping": { params: HerdrRequest.PingParams; result: HerdrResponse.PingResponse };
	"pane.list": { params: HerdrRequest.PaneListParams; result: HerdrResponse.PaneListResponse };
	"pane.get": { params: HerdrRequest.PaneTarget; result: HerdrResponse.PaneGetResponse };
	"pane.read": { params: HerdrRequest.PaneReadParams; result: HerdrResponse.PaneReadResponse };
	"events.subscribe": { params: HerdrRequest.EventsSubscribeParams; result: HerdrResponse.EventsSubscribeResponse };
	"agent.start": { params: HerdrRequest.AgentStartParams; result: HerdrResponse.AgentStartResponse };
	"pane.send_keys": { params: HerdrRequest.PaneSendKeysParams; result: HerdrResponse.PaneSendKeysResponse };
}

export type HerdrMethod = keyof HerdrRequestMap;

// ---- subscription_event: the narrow CLI-exposed channel (3 kinds) ----

export namespace HerdrSubscriptionEvent {
	export type SubscriptionEventKind = "pane.output_matched" | "pane.agent_status_changed" | "pane.scroll_changed";

	export type ReadFormat = "text" | "ansi";

	export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";

	export type PaneReadResult = {
		format: ReadFormat;
		pane_id: string;
		revision: number;
		source: ReadSource;
		tab_id: string;
		text: string;
		truncated: boolean;
		workspace_id: string;
	};

	export type PaneOutputMatchedEvent = {
		matched_line: string;
		pane_id: string;
		read: PaneReadResult;
	};

	export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

	export type PaneAgentStatusChangedEvent = {
		agent?: string | null;
		agent_status: AgentStatus;
		display_agent?: string | null;
		pane_id: string;
		state_labels?: Record<string, string>;
		title?: string | null;
		workspace_id: string;
	};

	export type PaneScrollInfo = {
		max_offset_from_bottom: number;
		offset_from_bottom: number;
		viewport_rows: number;
	};

	export type PaneScrollChangedEvent = {
		pane_id: string;
		scroll: PaneScrollInfo;
		workspace_id: string;
	};

	export type SubscriptionEventData = PaneOutputMatchedEvent | PaneAgentStatusChangedEvent | PaneScrollChangedEvent;
}

export interface SubscriptionEventEnvelope {
	event: HerdrSubscriptionEvent.SubscriptionEventKind;
	data: HerdrSubscriptionEvent.SubscriptionEventData;
}

// ---- event: broad channel, filtered to what the transport wires (pane_updated substitutes for the
// unreachable pane_output_changed; see trk-s5d.1). Subscribing to these Subscription variants is
// unfiltered server-side — no pane_id scoping — so the transport must filter by pane_id itself. ----

export namespace HerdrEvent {
	export type EventKind = "pane_updated" | "pane_exited" | "pane_agent_status_changed";

	export type AgentSessionRefKind = "id" | "path";

	export type AgentSessionInfo = {
		agent: string;
		kind: AgentSessionRefKind;
		source: string;
		value: string;
	};

	export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

	export type PaneScrollInfo = {
		max_offset_from_bottom: number;
		offset_from_bottom: number;
		viewport_rows: number;
	};

	export type PaneInfo = {
		agent?: string | null;
		agent_session?: AgentSessionInfo | null;
		agent_status: AgentStatus;
		cwd?: string | null;
		display_agent?: string | null;
		focused: boolean;
		foreground_cwd?: string | null;
		label?: string | null;
		pane_id: string;
		revision: number;
		scroll?: PaneScrollInfo | null;
		state_labels?: Record<string, string>;
		tab_id: string;
		terminal_id: string;
		terminal_title?: string | null;
		terminal_title_stripped?: string | null;
		title?: string | null;
		tokens?: Record<string, string>;
		workspace_id: string;
	};

	export type EventData = {
		pane: PaneInfo;
		type: "pane_updated";
	} | {
		pane_id: string;
		type: "pane_exited";
		workspace_id: string;
	} | {
		agent?: string | null;
		agent_status: AgentStatus;
		display_agent?: string | null;
		pane_id: string;
		state_labels?: Record<string, string>;
		title?: string | null;
		type: "pane_agent_status_changed";
		workspace_id: string;
	};
}

export interface EventEnvelope {
	event: HerdrEvent.EventKind;
	data: HerdrEvent.EventData;
}
