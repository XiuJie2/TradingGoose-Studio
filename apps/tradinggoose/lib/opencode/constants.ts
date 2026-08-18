/**
 * OpenCode (opencode.ai) runs as a self-hosted agent server, so the address is
 * per-deployment rather than a vendor endpoint — the same shape as Ollama.
 */
export const OPENCODE_BASE_URL_DEFAULT = 'http://localhost:4096'

/**
 * OpenCode ships `build` (can edit files) and `plan`; installs commonly add
 * read-only consultation agents. `plan` is the safest default: it reasons and
 * reads, and will not write to the directory the server is pointed at.
 */
export const OPENCODE_DEFAULT_AGENT = 'plan'

/**
 * An agentic run reads files and calls tools between tokens, so it is slow in a
 * way a chat completion is not — minutes, not seconds. The ceiling exists so a
 * wedged session cannot hold a workflow execution open indefinitely.
 */
export const OPENCODE_REQUEST_TIMEOUT_MS = 900_000
