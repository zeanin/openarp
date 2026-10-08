# OpenARP

> **Agentic Resource Planning (ARP): The Autonomous Decision & Planning Engine for Next-Generation Enterprises**  
> *From passive "digital filing cabinets" to proactive, 24/7 decision-making brains.*

[![License: Apache 2.0 with Commons Clause](https://img.shields.io/badge/License-Apache%202.0%20w%2F%20Commons%20Clause-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![pnpm Version](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-orange.svg)](https://pnpm.io)

---

## 💡 What is OpenARP?

For decades, enterprise operations have relied on **ERP (Enterprise Resource Planning)** systems. However, traditional ERPs are essentially sophisticated **"digital filing cabinets"**—architected strictly to record *what has already happened* for compliance and auditability.

**OpenARP introduces a category-defining shift: Agentic Resource Planning (ARP).**  
Rather than bolting a Copilot onto a rigid legacy database, OpenARP is designed from the ground up as an **autonomous decision and execution engine** that anticipates future scenarios and turns data into proactive business actions.

| Dimension | Traditional ERP | OpenARP (Agentic Resource Planning) |
| :--- | :--- | :--- |
| **Core Nature** | Static "Digital Filing Cabinet" (records history) | Proactive "Enterprise Brain" (anticipates futures) |
| **Data Scope** | Closed, siloed internal data | **Dual-Graph Architecture**: Internal operations + Real-time external world dynamics |
| **Primary Output** | Delayed dashboards and passive reports | **Executable Actions & Strategies** with scenario simulations |
| **Human Role** | Data analyst / Manual report compiler | **Decision Approver** (Human-in-the-Loop 1-click execution) |
| **Responsiveness** | Post-incident review (lagging) | 24/7 autonomous monitoring & real-time mitigation |

---

## ⚡ Core Architecture & Innovations

```mermaid
flowchart TD
    subgraph External["External World Dynamics"]
        E1[Commodity Prices]
        E2[Supply Chain Disruptions]
        E3[Macroeconomic Signals]
        E4[Competitor Intelligence]
    end

    subgraph Internal["Internal Enterprise Operations"]
        I1[Supply Chain & Inventory]
        I2[Financial Ledgers]
        I3[Sales & Orders]
        I4[Resource Capacity]
    end

    subgraph OpenARP["OpenARP Core Engine"]
        DG[Dual-Graph Intelligence Layer]
        ADE[Agentic Decision & Simulation Engine]
        A2UI[Dynamic Schema & A2UI Generator]
    end

    subgraph Execution["Action & Human-in-the-Loop"]
        HITL{Decision Approver\n(1-Click Approval)}
        ACT[Automated Workflow & System Execution]
    end

    External --> DG
    Internal --> DG
    DG --> ADE
    ADE -- "Simulate Scenarios\nCalculate Financial Impact" --> A2UI
    A2UI --> HITL
    HITL -- Approved --> ACT
    ACT -.-> Internal
```

### 1. 🌐 Dual-Graph Architecture
Traditional software only looks inward. OpenARP fuses **internal enterprise data** (financials, inventory, order status) with **real-time external world signals** (market trends, raw material indices, logistics anomalies, competitor alerts). OpenARP tells you not only what happened inside, but *what the external world is doing to your business—and what you should do about it*.

### 2. 🎯 Action-First Paradigm
Dashboards require humans to spot anomalies and manually figure out what to do. OpenARP's AI Agents monitor the dual graph 24/7:
- **Detects** impending operational bottlenecks or cost fluctuations.
- **Simulates** viable mitigation scenarios in parallel.
- **Calculates** quantitative balance sheet and operational impacts.
- **Proposes** ready-to-execute action plans awaiting single-click leadership approval.

### 3. 🧩 Dynamic Schema & Runtime Collections
Schema flexibility without service downtime. Create, modify, and relate database collections on the fly. Real-time PostgreSQL schemas sync seamlessly without system compilation or rebuilds.

### 4. 🖥️ A2UI: Generative Schema-Driven UI
Interfaces adapt dynamically to the scenario at hand. Utilizing standardized JSON Schema definitions, OpenARP delivers reactive forms, interactive approval cockpits, and real-time visualization widgets at runtime.

### 5. 🔌 Granular Modular Extensibility
Every platform capability (Attribute-Based Access Control, Workflows, Notifications, File Storage, Audit Logging, Localization) is packaged as a plug-and-play plugin obeying strict lifecycle states (`load`, `install`, `upgrade`, `destroy`).

---

## 🛠 Tech Stack

- **Monorepo Architecture:** Turborepo + pnpm workspaces
- **Frontend Engine:** React 18 + Vite + Schema Engine + Vanilla CSS
- **Backend Core:** Node.js + Koa + Dynamic Resourcer (REST/GraphQL routing)
- **Data & Vector Stores:** PostgreSQL (with `pgvector` support) + Sequelize ORM + Redis
- **Security & Permissions:** JWT + Attribute-Based Access Control (ABAC)
- **Agent Integration:** Multi-provider LLM integration (OpenAI, Anthropic, Local LLMs)
- **Containerization:** Docker & Docker Compose

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **Docker & Docker Compose**

### 2. Clone & Install
```bash
git clone <repo-url> openarp
cd openarp
pnpm install
```

### 3. Configure Environment
Copy the example environment configuration:
```bash
cp .env.example .env
```
Fill in your database credentials and LLM API keys (e.g., `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

### 4. Start Infrastructure & Development Server
```bash
# 1. Start PostgreSQL & Redis backing services
pnpm docker:up

# 2. Run the monorepo dev server (Backend on :3000, Web UI on :5173)
pnpm dev
```

Visit **`http://localhost:5173`** to access the OpenARP console.

---

## 📁 Repository Structure

```text
openarp/
├── apps/
│   ├── server/               # OpenARP Core Backend (Koa + Plugin Runtime)
│   └── web/                  # Dynamic Web Client (React + Schema-driven UI)
├── packages/
│   ├── core/
│   │   ├── ai/               # Agent orchestration & LLM abstraction
│   │   ├── database/         # Dynamic Collection Manager & ORM adapter
│   │   ├── resourcer/        # Declarative resource endpoint engine
│   │   ├── schema-engine/    # Dynamic JSON Schema UI renderer
│   │   └── server/           # OpenARP application container & lifecycle
│   └── plugins/              # Pluggable modules (ACL, Workflows, Audit, etc.)
├── docs/                     # Architecture whitepapers & technical guides
└── docker-compose.yml        # Multi-container orchestration
```

---

## 🐳 Production Deployment

Deploy the full stack with Docker Compose:

```bash
# Build and run containers
pnpm docker:up

# Or build the container image manually:
docker build -t openarp .
```

---

## 📄 License

This project is licensed under the **Apache License 2.0 with Commons Clause Condition v1.0**.

Under the Commons Clause condition, you are free to download, run, modify, and distribute the code for personal or internal use, but you **may not sell the software or use it to provide commercial hosting, cloud, or Software-as-a-Service (SaaS) platforms** to third parties.

See the [LICENSE](file:///Users/landaa/Workspaces/formai/FormAI/LICENSE) file for full terms and details.
