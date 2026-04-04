# Multi-Agent Architecture Patterns

## Introduction

Multi-agent systems decompose complex tasks into smaller units of work handled by specialized agents. The architecture pattern chosen determines how agents discover each other, communicate, and coordinate. Each pattern has distinct trade-offs in complexity, observability, fault tolerance, and scalability. This document covers six patterns commonly used in production multi-agent systems.

## Orchestrator Pattern

A central orchestrator agent receives the top-level task, decomposes it into subtasks, and delegates each to a worker agent. The orchestrator owns the task graph and makes all scheduling decisions. Worker agents are stateless executors — they receive a task, produce an artifact, and report completion back to the orchestrator.

**Strengths**: Simple mental model, centralized control, easy to debug because all decisions flow through a single point. The orchestrator has global visibility into progress and can make informed decisions about retries, rebalancing, and cancellation.

**Weaknesses**: Single point of failure. The orchestrator's context window becomes a bottleneck as the number of agents grows. Latency increases because every inter-agent interaction requires a round-trip through the orchestrator.

**When to use**: Tasks with clear hierarchical decomposition, teams of fewer than 10 agents, scenarios where auditability is critical.

## Choreography Pattern

No central coordinator exists. Each agent publishes events when it completes work, and other agents subscribe to events relevant to their role. Coordination emerges from the event flow rather than being imposed by a central authority.

**Strengths**: No single point of failure, naturally scalable, and agents can be added or removed without modifying a central controller. Each agent only needs to know about the events it cares about, not the full system topology.

**Weaknesses**: Difficult to reason about global progress. Debugging distributed event chains is harder than inspecting a centralized orchestrator's logs. Circular dependencies and deadlocks are possible if event subscriptions aren't carefully designed.

**When to use**: Loosely coupled agent systems, event-driven architectures, scenarios where agents are developed and deployed independently by different teams.

## Docs-as-Bus Pattern

Agents communicate exclusively through shared files in a known directory structure. Each agent writes its output to a designated file path, and downstream agents read from specified paths. The filesystem (or repository) acts as the message bus. No direct agent-to-agent communication occurs.

**Strengths**: Maximum decoupling — agents don't need network connectivity to each other. Outputs are inherently persisted and auditable. Easy to retry or resume because all intermediate state is on disk. Works naturally with version control, enabling diff-based review of agent outputs.

**Weaknesses**: Polling or filesystem watchers needed for real-time coordination. Not suitable for interactive or conversational agent workflows. File format contracts must be strictly defined and versioned.

**When to use**: CI/CD pipelines, code generation workflows, any system where agents produce file artifacts. Particularly effective when combined with git-based workflows where agent outputs become commits.

## Wave-Based Execution

Tasks are organized into waves — groups of tasks that can execute in parallel. Wave N+1 begins only after all tasks in wave N reach a terminal state. The wave structure is derived from the dependency graph: tasks with no unsatisfied dependencies are grouped into the earliest possible wave.

**Strengths**: Deterministic execution order with maximum parallelism within each wave. Easy to visualize and monitor — progress is simply "wave 3 of 7 complete." Natural checkpointing between waves enables pause/resume and partial retry (re-run wave 4 without re-running waves 1–3).

**Weaknesses**: Coarse-grained parallelism — a single slow task in a wave blocks the entire next wave. Not ideal for streaming or real-time workloads where tasks complete at very different rates.

**When to use**: Batch processing of dependent tasks, multi-agent code generation where file dependencies create a natural DAG, build systems.

## Agent Discovery

Before agents can collaborate, they need to find each other. Agent discovery patterns range from static configuration to dynamic protocols:

- **Static registry**: A configuration file lists all agents with their endpoints and capabilities. Simple but requires manual updates.
- **Service discovery**: Agents register with a discovery service (e.g., Consul, etcd, or a custom registry) on startup and deregister on shutdown. Other agents query the registry to find collaborators.
- **A2A Agent Cards**: Each agent serves a JSON document at `/.well-known/agent.json` describing its name, description, skills, and supported content types. Clients discover agents by fetching their agent cards. This is the approach used by Google's A2A protocol and enables zero-configuration discovery in networks where agent URLs are known.

Discovery is the foundation for composable multi-agent systems. Without it, every agent must be hard-coded to know about every other agent, creating tight coupling that makes the system brittle.

## Task Delegation

Once an agent is discovered, tasks must be delegated with clear contracts:

- **Input specification**: What data, format, and context the agent needs to begin work.
- **Output specification**: What artifacts the agent produces and where they'll be written.
- **Ownership boundaries**: Which files or resources the agent is allowed to modify. Overlapping ownership causes merge conflicts and race conditions.
- **Timeout and retry policy**: How long to wait before marking a task as failed, and whether it should be retried.

Effective delegation follows the principle of minimal authority — each agent receives exactly the permissions and context it needs, nothing more. This reduces the blast radius of failures and makes the system easier to reason about.

## Choosing a Pattern

No single pattern is universally best. Many production systems combine multiple patterns: an orchestrator decomposes the top-level task, delegates to agents that communicate via docs-as-bus, and executes in waves for deterministic progress tracking. The key is to match the coordination complexity to the problem complexity — simple tasks deserve simple patterns.
