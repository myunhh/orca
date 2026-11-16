#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { once, EventEmitter } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { spawnProcess, runProcess } from '@orca/process-host'
import { forceTerminateProcessTree } from '@orca/process-host/process-tree-termination'

const root = resolve(import.meta.dirname, '../..')
const source =
  process.env.ORCA_RELAY_SMOKE_DIR ?? join(root, 'out/relay', `${process.platform}-${process.arch}`)
const scratch = await mkdtemp(join(tmpdir(), 'orca-relay-smoke-'))
const runtime = join(scratch, 'runtime')
const home = join(scratch, 'home')
const workspace = join(scratch, 'workspace')
const socket =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\orca-relay-smoke-${randomUUID()}`
    : join(scratch, 'relay.sock')
const credential = join(scratch, 'endpoint-credential')
const ripgrep = join(
  root,
  'node_modules/@vscode/ripgrep-universal/bin',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'rg.exe' : 'rg'
)
const children = []
const clients = []
let phaseName = 'initializing'

function phase(name) {
  phaseName = name
  process.stderr.write(`[relay-smoke] ${name}\n`)
}

function diagnostics() {
  return clients.map((client) => ({
    label: client.label,
    pid: client.child.pid,
    exitCode: client.child.exitCode,
    signalCode: client.child.signalCode,
    pendingMethods: [...client.pending.values()].map((request) => request.method),
    stderr: client.stderr
  }))
}

function bounded(promise, description, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    })
  ]).finally(() => clearTimeout(timer))
}

async function stopChild(child) {
  const failures = []
  const exited = child.exitCode !== null || child.signalCode !== null
  const exit = exited ? Promise.resolve() : once(child, 'exit')
  child.stdin?.destroy()
  try {
    if (!exited) {
      try {
        const stopped = await bounded(
          forceTerminateProcessTree(child),
          `Stop process tree ${child.pid}`,
          5_000
        )
        if (!stopped) {
          failures.push(new Error(`Could not prove process tree ${child.pid} stopped`))
        }
      } catch (error) {
        failures.push(error)
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await bounded(exit, `Wait for child ${child.pid} exit`, 5_000)
    }
  } finally {
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.unref()
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Cleanup failed for child ${child.pid}`)
  }
}

const watchdog = setTimeout(() => {
  process.stderr.write(
    `[relay-smoke] Overall deadline exceeded in ${phaseName}; scratch=${scratch}\n${JSON.stringify(diagnostics(), null, 2)}\n`
  )
  for (const child of children) {
    void forceTerminateProcessTree(child).catch(() => {})
    child.kill('SIGKILL')
  }
  process.exit(1)
}, 120_000)
watchdog.unref()
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  NODE_PATH: join(root, 'node_modules')
}

function launch(args) {
  const child = spawnProcess({
    program: process.execPath,
    args: [join(runtime, 'relay.js'), ...args],
    cwd: workspace,
    env,
    // Tree termination requires each owned POSIX child to lead its process group.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  children.push(child)
  return child
}

class RelayClient extends EventEmitter {
  constructor(child) {
    super()
    this.child = child
    this.buffer = Buffer.alloc(0)
    this.label = child.spawnargs.includes('--connect') ? 'bridge' : 'daemon'
    clients.push(this)
    this.sequence = 0
    this.highestReceived = 0
    this.requestId = 0
    this.pending = new Map()
    this.ready = false
    this.stderr = ''
    this.failure = null
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-16_384)
    })
    child.stdout.on('data', (chunk) => this.feed(chunk))
    const fail = (error) => {
      this.failure = error
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
      this.emit('failed', error)
    }
    child.on('error', fail)
    child.stdin.on('error', fail)
    child.on('close', (code) => fail(new Error(`Relay exited (${code}): ${this.stderr}`)))
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (!this.ready) {
      const end = this.buffer.indexOf(10)
      if (end === -1) {
        return
      }
      const line = this.buffer.subarray(0, end + 1).toString()
      assert.equal(line, 'ORCA-RELAY v0.1.0 READY\n')
      this.buffer = this.buffer.subarray(end + 1)
      this.ready = true
      this.emit('ready')
    }
    while (this.buffer.length >= 13) {
      const length = this.buffer.readUInt32BE(9)
      if (this.buffer.length < 13 + length) {
        return
      }
      const type = this.buffer[0]
      this.highestReceived = Math.max(this.highestReceived, this.buffer.readUInt32BE(1))
      const payload = this.buffer.subarray(13, 13 + length)
      this.buffer = this.buffer.subarray(13 + length)
      if (type !== 1) {
        continue
      }
      const message = JSON.parse(payload.toString())
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      } else if (message.method) {
        this.emit(message.method, message.params)
      }
    }
  }

  send(message) {
    const payload = Buffer.from(JSON.stringify(message))
    const header = Buffer.alloc(13)
    header[0] = 1
    header.writeUInt32BE(++this.sequence, 1)
    header.writeUInt32BE(this.highestReceived, 5)
    header.writeUInt32BE(payload.length, 9)
    this.child.stdin.write(Buffer.concat([header, payload]))
  }

  request(method, params = {}) {
    phase(`${this.label}: ${method}`)
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out: ${this.stderr}`))
      }, 15_000)
      this.pending.set(id, { resolve, reject, timer, method })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async waitReady() {
    if (this.ready) {
      return
    }
    if (this.failure) {
      throw this.failure
    }
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer)
        this.off('ready', ready)
        this.off('failed', failed)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      const ready = () => finish()
      const failed = (error) => finish(error)
      const timer = setTimeout(
        () => finish(new Error(`Relay startup timed out: ${this.stderr}`)),
        15_000
      )
      this.once('ready', ready)
      this.once('failed', failed)
    })
  }
}

let owner
let ptyId
let scenarioFailure
let cleanupFailure
try {
  phase(`stage runtime: ${scratch}`)
  await mkdir(home)
  await mkdir(workspace)
  await cp(source, runtime, { recursive: true })
  await symlink(
    join(root, 'node_modules'),
    join(runtime, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const daemon = new RelayClient(
    launch([
      '--sock-path',
      socket,
      '--credential-file',
      credential,
      '--endpoint-dir',
      join(home, 'hooks'),
      '--ripgrep-path',
      ripgrep,
      '--grace-time',
      '1'
    ])
  )
  phase('daemon readiness')
  await daemon.waitReady()
  owner = new RelayClient(
    launch(['--connect', '--sock-path', socket, '--credential-file', credential])
  )
  phase('credential bridge readiness')
  await owner.waitReady()
  const grant = await owner.request('pty.openClient', {
    protocolVersion: 1,
    clientInstanceId: 'relay-smoke-owner',
    requestedRole: 'session-owner'
  })
  assert.equal(grant.role, 'session-owner')
  const status = await owner.request('relay.status')
  assert.equal(status.socket.owned, true)

  const textPath = join(workspace, 'text.txt')
  assert.equal(
    (
      await owner.request('fs.writeFileWithDiskPrecondition', {
        filePath: textPath,
        content: 'original'
      })
    ).ok,
    true
  )
  const staged = join(workspace, 'upload.tmp')
  const finalPath = join(workspace, 'bytes.bin')
  await writeFile(staged, Buffer.from([0, 1, 255]))
  await owner.request('fs.commitUpload', { tempPath: staged, finalPath })
  assert.deepEqual(await readFile(finalPath), Buffer.from([0, 1, 255]))
  await writeFile(staged, 'replacement')
  await assert.rejects(owner.request('fs.commitUpload', { tempPath: staged, finalPath }))
  assert.deepEqual(await readFile(finalPath), Buffer.from([0, 1, 255]))
  const refused = await owner.request('fs.replaceWithUpload', {
    tempPath: staged,
    finalPath,
    precondition: { expectedSha256: '0'.repeat(64) }
  })
  assert.deepEqual(refused, { ok: false, diskConflict: 'changed' })
  await assert.rejects(readFile(staged), { code: 'ENOENT' })
  await writeFile(staged, 'replacement')
  const expectedSha256 = createHash('sha256')
    .update(Buffer.from([0, 1, 255]))
    .digest('hex')
  assert.equal(
    (
      await owner.request('fs.replaceWithUpload', {
        tempPath: staged,
        finalPath,
        precondition: { expectedSha256 }
      })
    ).ok,
    true
  )
  assert.equal(await readFile(finalPath, 'utf8'), 'replacement')

  const git = await runProcess({
    program: 'git',
    args: ['init', '--quiet', workspace],
    cwd: workspace,
    env
  })
  assert.equal(git.code, 0, git.stderr)
  assert.equal((await owner.request('git.isGitRepo', { dirPath: workspace })).isRepo, true)
  const gitStatus = await owner.request('git.status', { worktreePath: workspace })
  assert.ok(gitStatus)

  await writeFile(join(workspace, '.gitignore'), 'ignored.txt\n')
  await writeFile(join(workspace, 'ignored.txt'), 'ignored')
  const linkedSource = join(scratch, 'linked-source')
  await mkdir(linkedSource)
  await writeFile(join(linkedSource, 'linked.txt'), 'linked')
  await symlink(
    linkedSource,
    join(workspace, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const listing = await owner.request('fs.listFiles', {
    rootPath: workspace,
    includeIgnored: false,
    followSymlinks: true,
    maxResults: 100
  })
  assert.equal(listing.includes('ignored.txt'), false)
  assert.equal(listing.includes('linked/linked.txt'), true)
  const noFollow = await owner.request('fs.readDir', { dirPath: workspace, followSymlinks: false })
  const follow = await owner.request('fs.readDir', { dirPath: workspace, followSymlinks: true })
  assert.equal(noFollow.find((entry) => entry.name === 'linked').isDirectory, false)
  assert.equal(follow.find((entry) => entry.name === 'linked').isDirectory, true)

  const streamedPath = join(workspace, 'stream.bin')
  await writeFile(streamedPath, Buffer.alloc(1024 * 1024, 65))
  const stream = await owner.request('fs.readFileStream', {
    filePath: streamedPath,
    flowControl: 'ack'
  })
  owner.notify('fs.cancelStream', { streamId: stream.streamId })
  assert.equal((await owner.request('relay.status')).pid, status.pid)

  const spawned = await owner.request('pty.spawn', {
    cwd: workspace,
    cols: 80,
    rows: 24,
    env: { HOME: home, USERPROFILE: home }
  })
  ptyId = spawned.id
  assert.equal(typeof ptyId, 'string')
  let terminalOutput = ''
  phase('native PTY echo')
  const echoed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`PTY echo timed out: ${terminalOutput}`)),
      10_000
    )
    owner.on('pty.data', (event) => {
      if (event.id !== ptyId) {
        return
      }
      terminalOutput += event.data
      if (/[\r\n]ORCA_RELAY_SMOKE_PTY\r?\n/.test(stripVTControlCharacters(terminalOutput))) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  owner.notify('pty.data', { id: ptyId, data: 'echo ORCA_RELAY_SMOKE_PTY\r' })
  await echoed
  owner.notify('pty.resize', { id: ptyId, cols: 97, rows: 31 })
  const size = await owner.request('pty.getSize', { id: ptyId })
  assert.deepEqual(size, { cols: 97, rows: 31 })
  await owner.request('pty.shutdown', { id: ptyId, immediate: true })
  ptyId = undefined
  assert.equal((await owner.request('relay.status')).ptys.active, 0)
} catch (error) {
  scenarioFailure = {
    phase: phaseName,
    message: error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  process.stderr.write(
    `[relay-smoke] Failed in ${phaseName}; scratch=${scratch}\n${scenarioFailure.message}\n${JSON.stringify(diagnostics(), null, 2)}\n`
  )
  throw error
} finally {
  phase('cleanup')
  const failures = []
  if (ptyId && owner) {
    try {
      await owner.request('pty.shutdown', { id: ptyId, immediate: true })
    } catch (error) {
      failures.push(error)
    }
  }
  phase('stop owned process groups')
  const results = await Promise.allSettled(children.toReversed().map(stopChild))
  for (const result of results) {
    if (result.status === 'rejected') {
      failures.push(result.reason)
    }
  }
  if (failures.length > 0 || scenarioFailure) {
    try {
      await bounded(
        writeFile(
          join(scratch, 'diagnostics.json'),
          JSON.stringify(
            {
              scenarioFailure,
              processes: diagnostics(),
              cleanupErrors: failures.map((error) => String(error))
            },
            null,
            2
          )
        ),
        'Write failure diagnostics',
        5_000
      )
    } catch (error) {
      failures.push(error)
    }
    process.stderr.write(`[relay-smoke] Retained failure evidence: ${scratch}\n`)
  } else {
    try {
      await bounded(rm(scratch, { recursive: true, force: true }), 'Remove smoke scratch', 5_000)
    } catch (error) {
      failures.push(error)
    }
  }
  clearTimeout(watchdog)
  if (failures.length > 0) {
    process.stderr.write(
      `[relay-smoke] Cleanup failures: ${failures.map((error) => String(error)).join('\n')}\n`
    )
    if (!scenarioFailure) {
      cleanupFailure = new AggregateError(failures, 'Relay smoke cleanup failed')
    }
  }
}
if (cleanupFailure) {
  throw cleanupFailure
}
phase('complete')
console.log(
  'Relay smoke passed: credential bridge, owner admission, filesystem/no-clobber/CAS, Git, stream cancellation, native PTY echo/resize/physical shutdown.'
)
