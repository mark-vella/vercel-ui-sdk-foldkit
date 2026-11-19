import { spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"

const defaultBinary = path.join(homedir(), ".paper/bin/paper")
const timeout = 30_000

const connectPaper = async () => {
  const binary = process.env.PAPER_BIN ?? defaultBinary
  const relay = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] })
  const pending = new Map()
  let nextId = 1
  let buffer = ""
  let stderr = ""

  const failAll = (error) => {
    for (const { reject } of pending.values()) {
      reject(error)
    }
    pending.clear()
  }

  relay.on("error", (error) => {
    failAll(new Error(`Could not start ${binary}: ${error.message}`))
  })
  relay.on("exit", (code, signal) => {
    failAll(
      new Error(
        `paper mcp exited (${signal ?? code}) ${stderr.trim()}`.trimEnd()
      )
    )
  })
  relay.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  relay.stdout.on("data", (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        settle(JSON.parse(line))
      }
    }
  })

  const settle = (message) => {
    const request = pending.get(message.id)
    if (!request) {
      return
    }
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) {
      request.reject(
        new Error(`${request.method}: ${message.error.message}`, {
          cause: message.error,
        })
      )
    } else {
      request.resolve(message.result)
    }
  }

  const send = (message) => {
    relay.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out after ${timeout} ms`))
      }, timeout)
      pending.set(id, { method, resolve, reject, timer })
      send({ jsonrpc: "2.0", id, method, params })
    })

  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ui-sdk-paper", version: "0.0.0" },
    })
  } catch (error) {
    relay.kill()
    throw error
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" })

  const call = async (name, args = {}) => {
    const result = await request("tools/call", { name, arguments: args })
    const texts = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
    if (result.isError) {
      throw new Error(`${name} failed: ${texts.join("\n")}`)
    }
    // Paper answers with a file header part, then the result part.
    const text = texts.at(-1)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  const close = () =>
    new Promise((resolve) => {
      if (relay.exitCode !== null || relay.signalCode !== null) {
        resolve()
        return
      }
      relay.once("exit", () => resolve())
      relay.stdin.end()
      setTimeout(() => relay.kill(), 2_000).unref()
    })

  return { call, close }
}

export { connectPaper }
