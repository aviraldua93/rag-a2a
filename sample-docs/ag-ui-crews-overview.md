# ag-ui-crews: Real-Time Agent Dashboard

## Overview

ag-ui-crews is a real-time mission control dashboard built on the AG-UI (Agent-User Interaction) protocol for watching AI agent crews execute complex tasks. It provides a visual command center where developers can observe multi-agent workflows unfolding in real time — seeing which agents are active, what artifacts they're producing, and how task waves are progressing through the execution DAG. Built with Bun on the server side and React 19 with Framer Motion on the frontend, it translates raw A2A protocol events into rich, animated visualizations.

## Architecture

### Server Layer

The Bun-powered backend acts as an event translation bridge. It connects to an A2A Bridge's SSE endpoint, consumes raw `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` messages, and re-encodes them as AG-UI protocol events. The AG-UI encoding adds semantic structure — events carry typed payloads like `RUN_STARTED`, `STEP_STARTED`, `STEP_FINISHED`, `TEXT_MESSAGE_CONTENT`, and `RUN_FINISHED` that map cleanly to visual UI states. The server maintains an in-memory event log and serves it over its own SSE endpoint, allowing multiple dashboard clients to connect simultaneously.

### Frontend Layer

The React 19 frontend consumes the AG-UI event stream and renders four primary views:

- **Wave Timeline**: A horizontal swimlane visualization showing execution waves as columns. Each lane represents an agent, and task cards move through states (queued → working → completed) with smooth Framer Motion transitions. Dependencies are drawn as connecting lines between cards across waves.

- **Agent Status Cards**: Real-time cards for each agent showing current status, active task, token usage, and elapsed time. Cards pulse with a subtle glow animation when the agent is actively generating, and collapse to a compact form when idle.

- **Artifact Viewer**: A tabbed panel that displays artifacts (code files, documents, test results) as agents produce them. Artifacts appear with a typewriter animation as content streams in, and include syntax highlighting for code.

- **Event Log**: A filterable, scrollable log of all AG-UI events with timestamp, event type, and payload. Supports filtering by agent, event type, and severity. Events are color-coded by type for quick scanning.

## AG-UI Protocol

The AG-UI protocol defines a standard event vocabulary for agent-to-UI communication:

### Event Types

| Event                    | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `RUN_STARTED`            | A new execution run has begun                       |
| `RUN_FINISHED`           | The execution run completed (success or failure)    |
| `STEP_STARTED`           | An individual task step began execution             |
| `STEP_FINISHED`          | A task step completed                               |
| `TEXT_MESSAGE_START`      | An agent began producing a text message             |
| `TEXT_MESSAGE_CONTENT`    | Incremental text content from an agent              |
| `TEXT_MESSAGE_END`        | An agent finished producing a text message          |
| `TOOL_CALL_START`        | An agent invoked a tool                             |
| `TOOL_CALL_END`          | A tool invocation completed                         |
| `STATE_SNAPSHOT`         | Full state snapshot for late-joining clients        |
| `STATE_DELTA`            | Incremental state update                            |
| `CUSTOM`                 | Extension point for application-specific events     |

### SSE Encoding

Events are transmitted as Server-Sent Events with structured JSON payloads. Each event includes a monotonically increasing sequence number, a timestamp, and a typed payload. The `STATE_SNAPSHOT` event allows clients that connect mid-execution to reconstruct the full current state without replaying the entire event history.

### Metrics Dashboard

The metrics view aggregates data across the event stream to display:

- **Throughput**: Tasks completed per minute, tokens generated per second
- **Latency**: Time-to-first-token, total task duration, wave completion time
- **Cost**: Estimated token costs per agent and per wave
- **Success Rate**: Task pass/fail ratios with trend indicators

## Features Summary

- Zero-config connection to any A2A Bridge endpoint
- Automatic reconnection with exponential backoff on SSE disconnects
- Dark theme optimized for extended monitoring sessions
- Keyboard shortcuts for quick navigation between views
- Export event logs as JSON for post-mortem analysis
- Responsive layout that scales from single-monitor to multi-display setups
- URL-based state sharing — copy the URL to share your current view with teammates
