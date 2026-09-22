import { FlowSchema, type IWorkspace } from '../model/schemas.js'
import type { WorkspaceStore } from './workspace-store.js'

/**
 * Демо-workspace на публичном GraphQL API стран (countries.trevorblades.com).
 *
 * Пустой первый запуск оставлял человека один на один с формой «укажите
 * эндпоинт». Пример даёт коллекцию, которую можно выполнить сразу, и
 * цепочку с извлечением и проверкой — на живом API, без авторизации.
 */
export const DEMO_WORKSPACE_ID = 'demo'
export const DEMO_ENDPOINT_URL = 'https://countries.trevorblades.com/graphql'

export async function createDemoWorkspace(workspaces: WorkspaceStore): Promise<IWorkspace> {
    const workspace = await workspaces.createWorkspace({
        name: 'Demo: Countries',
        endpointUrl: DEMO_ENDPOINT_URL,
        id: DEMO_WORKSPACE_ID,
    })

    await workspaces.createCollection(workspace.id, 'Countries', 'countries')

    await workspaces.saveOperation(workspace.id, {
        collectionId: 'countries',
        name: 'Continents',
        description: 'All continents with their codes. Start here: ⌘↩ runs it.',
        query: `query Continents {
  continents {
    code
    name
  }
}
`,
    })

    await workspaces.saveOperation(workspace.id, {
        collectionId: 'countries',
        name: 'Countries by continent',
        description: 'Filter by continent code; the variable comes from the environment.',
        query: `query CountriesByContinent($continent: String!) {
  countries(filter: { continent: { eq: $continent } }) {
    code
    name
    capital
    currency
    emoji
  }
}
`,
        variables: { continent: '{{continent}}' },
    })

    await workspaces.saveOperation(workspace.id, {
        collectionId: 'countries',
        name: 'Country',
        description: 'One country with its languages.',
        query: `query Country($code: ID!) {
  country(code: $code) {
    name
    capital
    phone
    languages {
      code
      name
    }
  }
}
`,
        variables: { code: 'FR' },
    })

    await workspaces.saveFlow(
        workspace.id,
        FlowSchema.parse({
            id: 'smoke',
            name: 'Smoke: continents → countries',
            description: 'Takes the first continent and checks that it has countries.',
            steps: [
                {
                    id: 'continents',
                    name: 'List continents',
                    operationRef: 'countries/Continents',
                    extract: { firstContinent: 'data.continents.0.code' },
                    assert: [{ path: 'data.continents', op: 'exists' }],
                },
                {
                    id: 'countries',
                    name: 'Countries of the first continent',
                    operationRef: 'countries/Countries by continent',
                    variables: { continent: '{{firstContinent}}' },
                    assert: [{ path: 'data.countries.0.name', op: 'exists' }],
                },
            ],
        }),
    )

    const withVariables: IWorkspace = {
        ...workspace,
        environments: workspace.environments.map((environment) => ({
            ...environment,
            variables: { ...environment.variables, continent: 'EU' },
        })),
    }
    await workspaces.saveWorkspace(withVariables)

    return withVariables
}
