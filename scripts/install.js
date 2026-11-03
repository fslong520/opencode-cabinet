#!/usr/bin/env node
// Install-time config wiring for opencode-cabinet.
//
// Adds this plugin to an opencode config file so users don't have to edit JSON
// by hand. Runs automatically via `npm install` (postinstall), or manually:
//
//   node scripts/install.js                          # global ~/.config/opencode/opencode.json
//   node scripts/install.js --project [dir]           # <dir>/.opencode/opencode.json
//   node scripts/install.js --config /path/to.json    # explicit file
//   node scripts/install.js --dry-run                 # show what would change
//
// Safe by design: idempotent, backs up before writing, and refuses to touch a
// file it cannot parse (e.g. JSONC with comments) instead of clobbering it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PKG = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"))

function parseArgs(argv) {
  const args = { project: null, config: null, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--config") args.config = argv[++i]
    else if (arg === "--project") {
      const next = argv[i + 1]
      args.project = next && !next.startsWith("--") ? (argv[++i], next) : "."
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/install.js [--project [dir]] [--config <file>] [--dry-run]")
      process.exit(0)
    } else {
      console.error(`install: unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

function resolveConfigPath(args) {
  if (args.config) return path.resolve(args.config)
  if (args.project !== null) return path.join(path.resolve(args.project), ".opencode", "opencode.json")
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
  return path.join(base, "opencode", "opencode.json")
}

// A package installed under node_modules is referenced by name; a local checkout
// is referenced by absolute path (opencode resolves path plugins directly).
function pluginEntry() {
  return PKG_ROOT.includes("node_modules") ? PKG.name : PKG_ROOT
}

function entryName(entry) {
  return typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : undefined
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const configPath = resolveConfigPath(args)
  const entry = pluginEntry()

  let config = {}
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8")
    try {
      config = JSON.parse(raw)
    } catch (error) {
      console.error(`install: cannot parse ${configPath} (${error.message}).`)
      console.error("install: it may contain comments (JSONC); add the plugin entry manually instead:")
      console.error(`install:   "plugin": ${JSON.stringify([entry])}`)
      process.exit(1)
    }
    if (!Array.isArray(config.plugin)) {
      if (config.plugin !== undefined) {
        console.error(`install: ${configPath} has a "plugin" field that is not an array; refusing to modify.`)
        process.exit(1)
      }
      config.plugin = []
    }
    if (config.plugin.some((item) => entryName(item) === entry || entryName(item) === PKG.name)) {
      console.log(`install: ${configPath} already lists ${PKG.name}; nothing to do.`)
      return
    }
  } else {
    config = { $schema: "https://opencode.ai/config.json", plugin: [] }
  }

  config.plugin.push(entry)

  if (args.dryRun) {
    console.log(`install: would add ${JSON.stringify(entry)} to ${configPath}`)
    return
  }

  mkdirSync(path.dirname(configPath), { recursive: true })
  if (existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backup = `${configPath}.bak-${stamp}`
    copyFileSync(configPath, backup)
    console.log(`install: backup -> ${backup}`)
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`install: added ${JSON.stringify(entry)} to ${configPath}`)
  console.log("install: restart opencode to take effect.")
}

main()
