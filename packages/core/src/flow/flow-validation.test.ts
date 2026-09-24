import { describe, expect, it } from 'vitest'

import { FlowSchema } from '../model/schemas.js'
import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { findFlowProblems } from './flow-validation.js'

async function createStore(): Promise<WorkspaceStore> {
    const store = new WorkspaceStore(new MemoryFileSystem(), new LibraryPaths('/library'))
    await store.init()
    await store.createWorkspace({ name: 'API', endpointUrl: 'https://api.example.com/graphql' })
    await store.createCollection('api', 'Users')
    await store.saveOperation('api', { collectionId: 'users', name: 'Me', query: '{ me { id } }' })

    return store
}

function flow(steps: unknown[], extra: Record<string, unknown> = {}) {
    return FlowSchema.parse({ id: 'smoke', name: 'Smoke', steps, ...extra })
}

describe('findFlowProblems', () => {
    it('принимает цепочку с существующей операцией и встроенным запросом', async () => {
        const store = await createStore()

        const problems = await findFlowProblems(
            store,
            'api',
            flow([
                { id: 's1', name: 'me', operationRef: 'users/Me' },
                { id: 's2', name: 'inline', query: '{ ping }' },
            ]),
        )

        expect(problems).toEqual([])
    })

    it('собирает все проблемы сразу', async () => {
        const store = await createStore()

        const problems = await findFlowProblems(
            store,
            'api',
            flow(
                [
                    { id: 's1', name: 'missing', operationRef: 'users/Nope' },
                    { id: 's1', name: 'empty' },
                    { id: 's3', name: 'env', query: '{ a }', environmentId: 'prod' },
                ],
                { endpointId: 'nowhere' },
            ),
        )

        expect(problems.map((problem) => problem.step ?? '-')).toEqual([
            '-',
            'missing',
            'empty',
            'empty',
            'env',
        ])
    })
})
