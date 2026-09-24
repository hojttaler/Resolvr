import type { IFlow } from '../model/schemas.js'
import type { WorkspaceStore } from '../storage/workspace-store.js'
import { parseOperationRef } from '../storage/workspace-store.js'

/** Проблема цепочки, найденная до сохранения. */
export interface IFlowProblem {
    /** Имя шага; для полей самой цепочки — `undefined`. */
    step?: string
    message: string
}

/**
 * Проверяет, что всё, на что ссылается цепочка, существует.
 *
 * Цепочка с опечаткой в ссылке сохраняется без ошибок и падает только при
 * запуске — часто уже в чужом прогоне smoke-тестов. Проверка до записи
 * возвращает все проблемы сразу, а не первую.
 */
export async function findFlowProblems(
    workspaces: WorkspaceStore,
    workspaceId: string,
    flow: IFlow,
): Promise<IFlowProblem[]> {
    const workspace = await workspaces.getWorkspace(workspaceId)
    const environments = new Set(workspace.environments.map((item) => item.id))
    const endpoints = new Set(workspace.endpoints.map((item) => item.id))
    const problems: IFlowProblem[] = []

    if (flow.environmentId && !environments.has(flow.environmentId)) {
        problems.push({ message: `окружения "${flow.environmentId}" нет в workspace` })
    }
    if (flow.endpointId && !endpoints.has(flow.endpointId)) {
        problems.push({ message: `эндпоинта "${flow.endpointId}" нет в workspace` })
    }

    const stepIds = new Set<string>()
    for (const step of flow.steps) {
        if (stepIds.has(step.id)) {
            problems.push({ step: step.name, message: `id шага "${step.id}" повторяется` })
        }
        stepIds.add(step.id)

        if (!step.operationRef && !step.query?.trim()) {
            problems.push({ step: step.name, message: 'нужна operationRef или query' })
        }
        if (step.environmentId && !environments.has(step.environmentId)) {
            problems.push({
                step: step.name,
                message: `окружения "${step.environmentId}" нет в workspace`,
            })
        }
        if (step.endpointId && !endpoints.has(step.endpointId)) {
            problems.push({
                step: step.name,
                message: `эндпоинта "${step.endpointId}" нет в workspace`,
            })
        }

        if (step.operationRef) {
            const exists = await workspaces
                .getOperation(workspaceId, parseOperationRef(step.operationRef))
                .then(() => true)
                .catch(() => false)
            if (!exists) {
                problems.push({
                    step: step.name,
                    message: `операции "${step.operationRef}" нет — формат ссылки "collection/operation"`,
                })
            }
        }
    }

    return problems
}
