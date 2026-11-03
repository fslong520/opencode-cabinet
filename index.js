// opencode-cabinet — five cabinet-style role agents for opencode.
//
// The plugin follows the same registration pattern as oh-my-openagent:
// a default-exported module object whose `server(input, options)` returns
// hooks, and a `config` hook that injects agent definitions into the
// merged opencode config. User-defined entries in opencode.json always
// win, key by key, over the defaults shipped here.
//
// Roles (after the Qoder cabinet setup, translated to English):
//   grand-secretary    primary    frames the task, dispatches, adjudicates, consolidates
//   hanlin-researcher  subagent   research and drafting
//   works-executor     subagent   hands-on execution (the only member that may edit)
//   court-reviewer     subagent   verifies evidence, logic and counterexamples
//   censor-inspector   subagent   final acceptance; the task is done only when it passes
//
// Options (opencode.json): { "plugin": [["opencode-cabinet", { "models": { ... } }]] }
//   models: partial map of agent name -> "provider/model-id".

import { readFile } from "node:fs/promises"

const ROLE_PERMISSIONS = {
  // The captain orchestrates only: it reads, searches the web and dispatches
  // to cabinet members, but never edits files or runs shell commands itself.
  "grand-secretary": {
    read: "allow",
    webfetch: "allow",
    websearch: "allow",
    edit: "deny",
    bash: "deny",
    task: {
      "*": "deny",
      "court-reviewer": "allow",
      "works-executor": "allow",
      "hanlin-researcher": "allow",
      "censor-inspector": "allow",
    },
  },
  // Verification and research are read-only on the workspace; the shell stays
  // available so results can be reproduced. Subagents must not fan out further.
  "court-reviewer": {
    read: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "allow",
    edit: "deny",
    task: "deny",
  },
  "hanlin-researcher": {
    read: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "allow",
    edit: "deny",
    task: "deny",
  },
  "censor-inspector": {
    read: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "allow",
    edit: "deny",
    task: "deny",
  },
  // The only member allowed to touch the workspace, mirroring the rule that
  // every hands-on step goes through the Works Executor.
  "works-executor": {
    read: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "allow",
    edit: "allow",
    task: "deny",
  },
}

const AGENTS = [
  {
    name: "grand-secretary",
    description:
      "Cabinet captain. Frames the task, breaks it into subtasks, dispatches members, adjudicates conflicts and consolidates the deliverable — finished only after the Censor Inspector accepts it.",
    mode: "primary",
    color: "#E4B446",
    promptFile: "grand-secretary.md",
  },
  {
    name: "hanlin-researcher",
    description:
      "Cabinet researcher and draftsman. Gathers and screens sources, separates verified facts from inference, and drafts the report.",
    mode: "subagent",
    color: "#9270CA",
    promptFile: "hanlin-researcher.md",
  },
  {
    name: "works-executor",
    description:
      "Cabinet doer. Runs code, experiments and data collection, and produces output files — every hands-on step belongs here.",
    mode: "subagent",
    color: "#5AD8A6",
    promptFile: "works-executor.md",
  },
  {
    name: "court-reviewer",
    description:
      "Cabinet verifier. Audits evidence chains, reasoning and counterexamples; rejects substandard conclusions with concrete remediation requirements.",
    mode: "subagent",
    color: "#5B8FF9",
    promptFile: "court-reviewer.md",
  },
  {
    name: "censor-inspector",
    description:
      "Cabinet acceptance inspector. Checks subtask completion, conclusion/evidence separation and open issues — the task closes only when it passes.",
    mode: "subagent",
    color: "#F6903D",
    promptFile: "censor-inspector.md",
  },
]

async function loadPrompts() {
  const prompts = {}
  await Promise.all(
    AGENTS.map(async (agent) => {
      const url = new URL(`./agents/${agent.promptFile}`, import.meta.url)
      prompts[agent.name] = (await readFile(url, "utf8")).trim()
    }),
  )
  return prompts
}

export default {
  id: "opencode-cabinet",
  server: async (_input, options) => {
    const prompts = await loadPrompts()
    const modelOverrides = options && typeof options.models === "object" && options.models !== null ? options.models : {}

    return {
      config: async (config) => {
        const injected = {}
        for (const agent of AGENTS) {
          const definition = {
            description: agent.description,
            mode: agent.mode,
            color: agent.color,
            permission: ROLE_PERMISSIONS[agent.name],
            prompt: prompts[agent.name],
          }
          const override = modelOverrides[agent.name]
          if (typeof override === "string" && override) definition.model = override
          // A user-defined entry for the same name wins, key by key.
          const existing = config.agent && config.agent[agent.name]
          injected[agent.name] = existing ? { ...definition, ...existing } : definition
        }
        config.agent = { ...(config.agent ?? {}), ...injected }

        // Open opencode in the Grand Secretary so every session starts with him
        // framing and dispatching the work. An explicitly configured default wins;
        // so does a user override that disables or demotes the captain.
        const lead = injected["grand-secretary"]
        if (!config.default_agent && lead && !lead.disable && lead.mode !== "subagent") {
          config.default_agent = "grand-secretary"
        }
      },
    }
  },
}
