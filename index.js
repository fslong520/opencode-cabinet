// opencode-cabinet — five cabinet-style role agents for opencode.
//
// Dual-runtime plugin:
//   - OpenCode 2 (>= 2.x): default export carries `setup(ctx)`; agents are
//     injected through ctx.agent.transform (editor.update upserts, field-by-
//     field gaps are filled so a user-declared agent always wins), and the
//     default agent is set with editor.default().
//   - opencode 1.x: default export carries `server(input, options)`; the
//     `config` hook injects agent definitions into the merged config, user
//     entries win key by key (same semantics as the v2 gap-fill).
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
    displayName: "Grand Secretary",
    description:
      "Cabinet captain. Frames the task, breaks it into subtasks, dispatches members, adjudicates conflicts and consolidates the deliverable — finished only after the Censor Inspector accepts it.",
    mode: "primary",
    color: "#E4B446",
    promptFile: "grand-secretary.md",
  },
  {
    name: "hanlin-researcher",
    displayName: "Hanlin Researcher",
    description:
      "Cabinet researcher and draftsman. Gathers and screens sources, separates verified facts from inference, and drafts the report.",
    mode: "subagent",
    color: "#9270CA",
    promptFile: "hanlin-researcher.md",
  },
  {
    name: "works-executor",
    displayName: "Works Executor",
    description:
      "Cabinet doer. Runs code, experiments and data collection, and produces output files — every hands-on step belongs here.",
    mode: "subagent",
    color: "#5AD8A6",
    promptFile: "works-executor.md",
  },
  {
    name: "court-reviewer",
    displayName: "Court Reviewer",
    description:
      "Cabinet verifier. Audits evidence chains, reasoning and counterexamples; rejects substandard conclusions with concrete remediation requirements.",
    mode: "subagent",
    color: "#5B8FF9",
    promptFile: "court-reviewer.md",
  },
  {
    name: "censor-inspector",
    displayName: "Censor Inspector",
    description:
      "Cabinet acceptance inspector. Checks subtask completion, conclusion/evidence separation and open issues — the task closes only when it passes.",
    mode: "subagent",
    color: "#F6903D",
    promptFile: "censor-inspector.md",
  },
]

// OpenCode 2 renamed two permission actions; everything else kept its name.
const V2_ACTION = { bash: "shell", task: "subagent" }

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

function modelOverride(options, name) {
  const models = options && typeof options.models === "object" && options.models !== null ? options.models : {}
  const value = models[name]
  return typeof value === "string" && value ? value : undefined
}

// OpenCode 2 permission rules are an ordered [{action, resource, effect}]
// array where later rules win — the same "last match wins" semantics v1 had.
// v1's flat keys and {resource: action} maps map straight onto it.
function v2Ruleset(permissions) {
  const rules = []
  for (const [key, value] of Object.entries(permissions)) {
    const action = V2_ACTION[key] ?? key
    if (typeof value === "string") {
      rules.push({ action, resource: "*", effect: value })
    } else if (value && typeof value === "object") {
      for (const [resource, effect] of Object.entries(value)) {
        rules.push({ action, resource, effect })
      }
    }
  }
  return rules
}

// "provider/model-id" -> the Model.Ref shape OpenCode 2 stores on an agent.
function parseModelRef(ref) {
  const slash = ref.indexOf("/")
  if (slash <= 0) return undefined
  return { providerID: ref.slice(0, slash), id: ref.slice(slash + 1) }
}

export default {
  id: "opencode-cabinet",

  // ---- OpenCode 2 ----------------------------------------------------------
  setup: async (ctx) => {
    const prompts = await loadPrompts()
    await ctx.agent.transform((editor) => {
      for (const agent of AGENTS) {
        // If the entry already exists it came from user config (the config
        // bridge or an earlier transform): fill only the gaps so declared
        // fields keep winning, exactly like the v1 key-by-key merge.
        const exists = editor.get(agent.name) !== undefined
        editor.update(agent.name, (item) => {
          if (!exists) {
            item.name = agent.displayName
            item.mode = agent.mode
            item.system = prompts[agent.name]
            item.description = agent.description
            item.color = agent.color
            item.permissions.push(...v2Ruleset(ROLE_PERMISSIONS[agent.name]))
          } else {
            if (item.system === undefined) item.system = prompts[agent.name]
            if (item.description === undefined) item.description = agent.description
            if (item.color === undefined) item.color = agent.color
          }
          const override = modelOverride(ctx.options, agent.name)
          if (item.model === undefined && override) item.model = parseModelRef(override)
        })
      }
      // Open every session with the Grand Secretary framing and dispatching
      // the work. An explicitly configured default_agent is applied by the
      // config bridge; if that bridge runs after this transform, the
      // configured value still wins.
      editor.default("grand-secretary")
    })
  },

  // ---- opencode 1.x --------------------------------------------------------
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
