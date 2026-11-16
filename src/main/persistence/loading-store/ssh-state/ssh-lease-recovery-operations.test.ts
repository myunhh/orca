import { expect, it } from 'vitest'
import { getSecretStore, setSecretStore } from '../../../../shared/secret-store'
import { PtyExitProof } from '../../../pty/process-retirement/pty-exit-proof'
import { createWorkerMaintenanceFixture } from '../profile-writing/profile-state-maintenance-fixture'

it('durably reclaims exact expired leases and detaches them before the final shutdown flush', async () => {
  const { store, readState } = await createWorkerMaintenanceFixture()
  store.upsertSshRemotePtyLease({
    targetId: 'relay-host',
    ptyId: 'pty2:epoch:1',
    state: 'attached'
  })
  await store.markSshRemotePtyLeasesAsync('relay-host', 'expired')
  await store.markSshRemotePtyLeasesAsync('relay-host', 'attached')
  expect(readState().sshRemotePtyLeases).toEqual([
    expect.objectContaining({ targetId: 'relay-host', ptyId: 'pty2:epoch:1', state: 'expired' })
  ])

  await store.markSshRemotePtyLeasesAttachedAsync('relay-host', ['pty2:epoch:1'])
  expect(readState().sshRemotePtyLeases).toEqual([
    expect.objectContaining({ targetId: 'relay-host', ptyId: 'pty2:epoch:1', state: 'attached' })
  ])
  store.markSshRemotePtyLeasesForShutdown('relay-host', 'detached')
  await store.flushFinalOrThrowAsync()
  expect(readState().sshRemotePtyLeases).toEqual([
    expect.objectContaining({ targetId: 'relay-host', ptyId: 'pty2:epoch:1', state: 'detached' })
  ])
})

it('persists pending stops and prunes only the requested target without dropping another host', async () => {
  const { store, readState } = await createWorkerMaintenanceFixture()
  const evidence = PtyExitProof.from('stop-confirmed', undefined)
  store.recordSshRemotePtyKillIntent(
    'relay-host',
    'pty2:epoch:1',
    { requestedAt: 1, attempts: 0 },
    evidence
  )
  store.recordSshRemotePtyKillIntent(
    'other-host',
    'pty-1',
    { requestedAt: 1_800_000_000_000, incarnationId: 'other-incarnation', attempts: 0 },
    evidence
  )
  await store.flushPendingOrThrowAsync()
  expect(readState().sshRemotePtyLeases).toEqual([
    expect.objectContaining({
      targetId: 'relay-host',
      pendingKill: { requestedAt: 1, attempts: 0 }
    }),
    expect.objectContaining({
      targetId: 'other-host',
      pendingKill: {
        requestedAt: 1_800_000_000_000,
        incarnationId: 'other-incarnation',
        attempts: 0
      }
    })
  ])

  store.pruneExpiredSshRemotePtyKillIntents('relay-host', 1_800_000_000_000)
  await store.flushPendingOrThrowAsync()
  expect(readState().sshRemotePtyLeases).toEqual([
    expect.objectContaining({ targetId: 'other-host', state: 'terminated' })
  ])
  expect(store.getSshRemotePtyKillIntents('other-host', 1_800_000_000_000)).toEqual([
    {
      ptyId: 'pty-1',
      intent: { requestedAt: 1_800_000_000_000, incarnationId: 'other-incarnation', attempts: 0 }
    }
  ])
})

it('seals consumer recovery secrets and refuses a stale owner removal', async () => {
  const original = getSecretStore()
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => Buffer.from(`sealed:${plaintext}`),
    decryptString: (ciphertext) => ciphertext.toString().slice('sealed:'.length),
    describeProtectionGap: () => null
  })
  try {
    const { store, readState } = await createWorkerMaintenanceFixture()
    await store.upsertSshPtyConsumerRecovery({
      targetId: 'relay-host',
      clientInstanceId: 'current-client',
      serverBuildId: 'relay-build',
      clientGeneration: 1,
      ownerGeneration: 2,
      ownerLease: 'secret-owner-token'
    })
    expect(JSON.stringify(readState())).not.toContain('secret-owner-token')
    await store.removeSshPtyConsumerRecovery('relay-host', 'older-client')
    expect(store.getSshPtyConsumerRecovery('relay-host')).toMatchObject({
      clientInstanceId: 'current-client',
      ownerLease: 'secret-owner-token'
    })
    await store.removeSshPtyConsumerRecovery('relay-host', 'current-client')
    expect(readState().sshPtyConsumerRecoveries).toEqual([])
  } finally {
    setSecretStore(original)
  }
})
