# a2a-crews: Multi-Agent Orchestration via A2A Protocol

## Overview

a2a-crews is an open-source TypeScript framework that turns a single command into a team of AI agents coordinating via Google's Agent-to-Agent (A2A) protocol. Rather than sending one monolithic prompt to a single LLM, a2a-crews decomposes complex software engineering tasks into a directed acyclic graph (DAG) of smaller, focused tasks and delegates each to a specialized agent. Agents discover each other through A2A Agent Cards, communicate over JSON-RPC 2.0, and stream real-time progress events over Server-Sent Events (SSE). The result is a deterministic, observable, and scalable multi-agent system that can tackle everything from feature implementation to full-stack refactors.

## Architecture

The framework is organized around four core subsystems:

### A2A Bridge

The A2A Bridge is an embedded HTTP coordination server that acts as the central nervous system. It hosts the `/a2a` JSON-RPC endpoint and the `/.well-known/agent.json` discovery endpoint. Every agent in the crew registers with the bridge on startup, advertising its capabilities via an Agent Card. The bridge maintains a task registry that tracks lifecycle states — `submitted`, `working`, `input-required`, `completed`, `failed`, and `canceled` — for every task in the system. It also provides a Server-Sent Events endpoint at `/a2a/events` for real-time observation of all task transitions.

### Wave Executor

The Wave Executor takes the DAG of tasks produced by the planner and groups them into execution waves. Tasks within the same wave have no inter-dependencies and can run in parallel; each subsequent wave waits for all tasks in the previous wave to reach a terminal state. This provides a balance between maximum parallelism and deterministic ordering. If a task fails, the executor marks all downstream dependents as `blocked` and continues executing independent branches, maximizing the useful work completed even in failure scenarios.

### AI Planner

The AI Planner is the entry point for human intent. Given a natural-language scenario (e.g., "Add authentication to the API using JWT"), it analyzes the codebase structure, identifies relevant files and modules, and produces a structured plan consisting of agents, tasks, and their dependency graph. The planner uses an LLM to reason about the codebase but produces deterministic JSON output that can be reviewed and edited before execution. Plans are versioned and stored alongside the project so teams can audit, replay, or modify them.

### Agent Spawner

The Agent Spawner launches each agent as an independent process in its own terminal tab (or container, in CI environments). Each agent receives a scoped system prompt, a list of files it owns, and a connection URL back to the bridge. Agents operate in isolation — they cannot directly communicate with each other. All coordination flows through the bridge via the A2A protocol, ensuring clean separation of concerns and making the system easy to debug.

## Key Components

| Component        | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| A2A Bridge       | Embedded coordination server for agent discovery     |
| Wave Executor    | DAG-based parallel task scheduling with wave groups  |
| AI Planner       | Decomposes scenarios into agents + task graphs       |
| Agent Spawner    | Launches agents as isolated processes                |
| 13 Presets       | Ready-made team templates for common workflows       |

## How It Works

1. **Plan**: Run `a2a-crews plan "Add OAuth2 login flow"`. The AI Planner scans the codebase, identifies relevant modules (routes, middleware, database schemas), and outputs a plan with agents (auth-implementer, test-writer, docs-updater) and a dependency DAG.

2. **Apply**: Run `a2a-crews apply`. The framework reads the plan, composes agent configurations with scoped prompts and file ownership, and generates bridge configuration. This step is deterministic and reviewable.

3. **Launch**: Run `a2a-crews launch`. The bridge starts, agents spawn in parallel terminal tabs, each registering with the bridge. The Wave Executor begins dispatching tasks according to the DAG.

4. **Watch**: Open the dashboard or run `a2a-crews watch`. Real-time SSE events show which agents are working, what artifacts they're producing, and how waves are progressing. Completed artifacts are written to the file system as they finish.

## A2A Protocol Integration

The framework implements the full A2A protocol specification:

- **Agent Cards**: JSON documents served at `/.well-known/agent.json` describing each agent's name, description, skills, and supported content types. Cards enable dynamic discovery — agents don't need to know about each other at compile time.

- **JSON-RPC 2.0**: All task operations (`tasks/send`, `tasks/get`, `tasks/cancel`) use JSON-RPC 2.0 over HTTP POST. This provides a standardized, language-agnostic interface that any A2A-compatible agent can integrate with.

- **Server-Sent Events**: Real-time task updates are streamed via SSE using `tasks/sendSubscribe`. Clients receive `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` as they happen, enabling live dashboards and responsive UIs.

- **Task Lifecycle**: Tasks flow through well-defined states with clear transition rules. A task starts as `submitted`, moves to `working` when an agent picks it up, may transition to `input-required` if human input is needed, and terminates as `completed`, `failed`, or `canceled`.

## Templates

a2a-crews ships with 13 prebuilt templates covering common development workflows:

1. **feature** — End-to-end feature implementation with tests and docs
2. **fullstack** — Coordinated frontend + backend + database changes
3. **bugfix** — Root cause analysis, fix implementation, regression tests
4. **refactor** — Code restructuring with safety-preserving test coverage
5. **api-design** — API specification, implementation, and client generation
6. **migration** — Database schema migration with rollback support
7. **security-audit** — Vulnerability scanning and remediation
8. **performance** — Profiling, optimization, and benchmark validation
9. **testing** — Comprehensive test suite generation (unit, integration, e2e)
10. **documentation** — API docs, guides, and architecture decision records
11. **ci-cd** — Pipeline configuration and deployment automation
12. **dependency-update** — Safe dependency upgrades with compatibility checks
13. **monorepo-sync** — Cross-package changes in monorepo environments

Each template defines a set of agent roles, a default task DAG, and file ownership rules. Templates can be customized per-project through configuration overlays.
