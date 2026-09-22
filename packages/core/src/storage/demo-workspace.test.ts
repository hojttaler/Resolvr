import { describe, expect, it } from 'vitest'

import { LibraryPaths } from './paths.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { WorkspaceStore } from './workspace-store.js'
import { createDemoWorkspace, DEMO_WORKSPACE_ID } from './demo-workspace.js'

describe('createDemoWorkspace', () => {
    it('создаёт workspace с коллекцией, переменной и цепочкой', async () => {
        const store = new WorkspaceStore(new MemoryFileSystem(), new LibraryPaths('/library'))
        await store.init()

        const workspace = await createDemoWorkspace(store)

        expect(workspace.id).toBe(DEMO_WORKSPACE_ID)
        expect(workspace.environments[0]?.variables.continent).toBe('EU')
        expect((await store.listOperations(DEMO_WORKSPACE_ID, 'countries')).map((item) => item.name)).toEqual([
            'Continents', 'Countries by continent', 'Country',
        ])
        const flows = await store.listFlows(DEMO_WORKSPACE_ID)
        expect(flows[0]?.steps.map((step) => step.operationRef)).toEqual([
            'countries/Continents', 'countries/Countries by continent',
        ])
    })
})
