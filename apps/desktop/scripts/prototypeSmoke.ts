/** Local synthetic-audio smoke. Requires an isolated fixture API/session; never creates an auth bypass. */
import { app, BrowserWindow } from 'electron'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { savePrototypeAuthSession } from '../src/main/prototype/authState'
import {
  startRecording,
  appendRecordingChunk,
  stopRecording,
  setRecordingSpeakerCount
} from '../src/main/audio/session'
import { isPipelineQueueBusy, enqueueSummaryJob } from '../src/main/pipeline/queue'
import { setLlmProvider } from '../src/main/db/settings'
import { drainPrototypeOutbox } from '../src/main/prototype/outbox'
import { getDb, closeDb } from '../src/main/db/connection'
import { listPrototypeDocuments, getPrototypeDocument } from '../src/main/prototype/documents'
import { registerIpcHandlers } from '../src/main/ipc/handlers'
import {
  recoverMissingArtifactOutbox,
  recoverTopicAttemptSpoolArtifacts
} from '../src/main/prototype/artifacts'
import { listPrototypeProcessing, retryPrototypeProcessing } from '../src/main/prototype/jobs'
import { info } from '../src/main/log'
import { completeSetup } from '../src/main/prototype/setup'

const root = path.resolve(app.getAppPath(), '../..')
const fixturePath = path.join(root, '.local/fixture-auth.json')
const outputDir = path.join(root, '.local/smoke')
app.setName('Knot Prototype Synthetic Smoke')
app.setPath('userData', path.join(outputDir, 'user-data'))
process.env.KNOT_API_BASE_URL = 'http://127.0.0.1:4311/v1'

function decodePcm16(wav: Buffer) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  let sampleRate = 0
  let data: Buffer | undefined
  for (let offset = 12; offset + 8 <= wav.length;) {
    const kind = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (kind === 'fmt ') {
      assert.equal(wav.readUInt16LE(offset + 8), 1)
      assert.equal(wav.readUInt16LE(offset + 10), 1)
      assert.equal(wav.readUInt16LE(offset + 22), 16)
      sampleRate = wav.readUInt32LE(offset + 12)
    }
    if (kind === 'data') data = wav.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  assert.equal(sampleRate, 16000)
  assert.ok(data)
  const samples = new Float32Array(data.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
  return samples
}

app
  .whenReady()
  .then(async () => {
    await mkdir(outputDir, { recursive: true })
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
    await savePrototypeAuthSession(
      fixture.session ?? {
        token: fixture.token,
        user: fixture.user,
        expiresAt: fixture.expiresAt ?? new Date(Date.now() + 3600_000).toISOString()
      }
    )
    setLlmProvider({ provider: 'local' })
    setRecordingSpeakerCount(1)
    recoverMissingArtifactOutbox()
    await recoverTopicAttemptSpoolArtifacts()
    let meetingId: string
    const prior = process.argv.includes('--retry-failed')
      ? (getDb()
          .prepare(
            "SELECT recording_id FROM prototype_jobs WHERE kind='ai' AND status='failed' ORDER BY updated_at DESC LIMIT 1"
          )
          .get() as { recording_id: string } | undefined)
      : undefined
    if (prior) {
      meetingId = prior.recording_id
      retryPrototypeProcessing({ meetingId })
      enqueueSummaryJob({ meetingId })
    } else {
      const samples = decodePcm16(await readFile(path.join(root, '.local/prototype-fixture.wav')))
      const recording = await startRecording({ sampleRate: 16000 })
      meetingId = recording.meetingId
      for (let offset = 0; offset < samples.length; offset += 8192) {
        const chunk = samples.slice(offset, offset + 8192)
        await appendRecordingChunk({ meetingId, pcm: chunk.buffer })
      }
      await stopRecording({ meetingId })
      info(`synthetic recording queued: ${meetingId}`)
    }
    const deadline = Date.now() + 12 * 60_000
    while (isPipelineQueueBusy()) {
      assert.ok(Date.now() < deadline, 'pipeline timeout')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const failures = getDb()
      .prepare(
        "SELECT kind,last_error FROM prototype_jobs WHERE recording_id=? AND status='failed'"
      )
      .all(meetingId)
    assert.deepEqual(failures, [], 'pipeline failed')
    let pending = 1
    for (let i = 0; i < 100 && pending; i++) {
      await drainPrototypeOutbox()
      const row = getDb()
        .prepare("SELECT count(*) AS n FROM prototype_outbox WHERE status!='succeeded'")
        .get() as { n: number }
      pending = row.n
      if (pending) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const unsynced = getDb()
      .prepare("SELECT kind,status,last_error FROM prototype_outbox WHERE status!='succeeded'")
      .all()
    assert.deepEqual(unsynced, [], 'sync failed')
    const documents = await listPrototypeDocuments()
    assert.ok(documents.length >= 1, 'expected topic documents')
    const details = await Promise.all(
      documents.map(({ id }) => getPrototypeDocument({ documentId: id }))
    )
    assert.ok(
      details.some((doc) => doc?.contributions.some((entry) => entry.recordingId === meetingId))
    )
    const artifacts = getDb()
      .prepare(
        'SELECT kind, count(*) AS count FROM prototype_artifacts WHERE recording_id=? GROUP BY kind'
      )
      .all(meetingId)
    const processing = listPrototypeProcessing().find((row) => row.meetingId === meetingId)
    assert.equal(processing?.saved, true)
    const result = {
      meetingId,
      artifacts,
      processing,
      documents: details,
      verifiedAt: new Date().toISOString(),
      fixture: 'macOS Yuna synthetic speech; fixture session; real local STT/LLM/API/PostgreSQL'
    }
    await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2))
    info(`synthetic smoke passed: ${documents.length} documents`)
    if (process.argv.includes('--show-ui')) {
      await completeSetup()
      registerIpcHandlers()
      const window = new BrowserWindow({
        width: 1280,
        height: 860,
        webPreferences: {
          preload: path.join(app.getAppPath(), 'out/preload/index.js'),
          sandbox: false
        }
      })
      await window.loadFile(path.join(app.getAppPath(), 'out/renderer/index.html'))
      window.on('closed', () => {
        closeDb()
        app.exit(0)
      })
    } else {
      closeDb()
      app.exit(0)
    }
  })
  .catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    closeDb()
    app.exit(1)
  })
