import { ResolvrError } from '../model/errors.js'
import type {
    IEnvironment,
    IFlow,
    IFlowAssert,
    IFlowStep,
    IFlowStepExpect,
} from '../model/schemas.js'
import { isSecretRef } from '../ports/secret-store.js'
import { readPath, type IRunResult, type RunEngine } from '../run/run-engine.js'
import { interpolateJson } from '../secrets/secret-resolver.js'
import type { WorkspaceStore } from '../storage/workspace-store.js'

export interface IAssertResult {
    assert: IFlowAssert
    passed: boolean
    /** Фактическое значение по пути — для объяснения, почему проверка не прошла. */
    actual: unknown
    message: string
}

export interface IFlowStepResult {
    stepId: string
    name: string
    ok: boolean
    skipped: boolean
    status?: number
    durationMs: number
    asserts: IAssertResult[]
    /** Значения, извлечённые этим шагом и переданные дальше. */
    extracted: Record<string, unknown>
    error?: string
    result?: IRunResult
}

export interface IFlowRunResult {
    flowId: string
    ok: boolean
    durationMs: number
    steps: IFlowStepResult[]
    /** Накопленный контекст: всё, что извлекли шаги. */
    context: Record<string, unknown>
}

export interface IFlowRunOptions {
    environmentId?: string
    endpointId?: string
    /** Стартовые переменные контекста — например, заданные вручную в UI. */
    initialContext?: Record<string, unknown>
}

/**
 * Последовательное выполнение сценариев из нескольких операций.
 *
 * Типовой случай — `login → мутация с полученным токеном → проверка`: значения
 * из ответа шага попадают в контекст и подставляются в переменные следующих
 * шагов как `{{имя}}`. Тот же раннер вызывается из GUI и через MCP, поэтому
 * smoke-тест ведёт себя одинаково при ручном и автоматическом запуске.
 */
export class FlowRunner {
    private readonly _workspaces: WorkspaceStore
    private readonly _runner: RunEngine

    constructor(workspaces: WorkspaceStore, runner: RunEngine) {
        this._workspaces = workspaces
        this._runner = runner
    }

    public async run(
        workspaceId: string,
        flowId: string,
        options: IFlowRunOptions = {},
    ): Promise<IFlowRunResult> {
        const flow = await this._workspaces.getFlow(workspaceId, flowId)

        return this.runFlow(workspaceId, flow, options)
    }

    public async runFlow(
        workspaceId: string,
        flow: IFlow,
        options: IFlowRunOptions = {},
    ): Promise<IFlowRunResult> {
        const startedAt = Date.now()
        const context: Record<string, unknown> = { ...(options.initialContext ?? {}) }
        const steps: IFlowStepResult[] = []

        // Цепочка, назначенная в «Авторизации» окружения, добывает токен —
        // значит, её собственные шаги не должны подставлять прежнее значение.
        const workspace = await this._workspaces.getWorkspace(workspaceId)
        const authEnvironments = workspace.environments.filter(
            (environment) => environment.recovery?.flowId === flow.id,
        )
        const produced = authEnvironments.length > 0 ? tokenVariables(authEnvironments, flow) : []

        let aborted = false

        for (const step of flow.steps) {
            if (aborted) {
                steps.push(this._skippedResult(step))
                continue
            }

            const stepResult = await this._runStep(workspaceId, flow, step, context, options, produced)
            steps.push(stepResult)

            if (!stepResult.ok && !step.continueOnFailure) aborted = true
        }

        return {
            flowId: flow.id,
            ok: steps.every((step) => step.ok || step.skipped) && !aborted,
            durationMs: Date.now() - startedAt,
            steps,
            context,
        }
    }

    private async _runStep(
        workspaceId: string,
        flow: IFlow,
        step: IFlowStep,
        context: Record<string, unknown>,
        options: IFlowRunOptions,
        producedVariables: string[],
    ): Promise<IFlowStepResult> {
        const startedAt = Date.now()

        if (!step.operationRef && !step.query) {
            return {
                stepId: step.id,
                name: step.name,
                ok: false,
                skipped: false,
                durationMs: 0,
                asserts: [],
                extracted: {},
                error: 'Шаг не содержит ни operationRef, ни query',
            }
        }

        try {
            const result = await this._runner.run({
                workspaceId,
                operationRef: step.operationRef,
                query: step.query,
                variables: interpolateJson(step.variables, toStringContext(context)),
                endpointId: step.endpointId ?? flow.endpointId ?? options.endpointId,
                environmentId: step.environmentId ?? flow.environmentId ?? options.environmentId,
                // Шаг цепочки не запускает собственные цепочки: восстановление
                // внутри восстановления зациклило бы выполнение.
                skipFlows: true,
                producedVariables,
                // Значения, добытые предыдущими шагами, доступны в заголовках
                // как `{{name}}` — тем же способом, что и в переменных.
                flowContext: toStringContext(context),
            })

            const payload = {
                status: result.status,
                ok: result.ok,
                data: result.data,
                errors: result.errors ?? null,
            }

            const extracted: Record<string, unknown> = {}
            for (const [name, path] of Object.entries(step.extract)) {
                const value = readPath(payload, path)
                extracted[name] = value
                context[name] = value
            }

            const asserts = step.assert.map((assertion) => evaluateAssert(assertion, payload))
            const assertsPassed = asserts.every((item) => item.passed)
            const outcome = judgeStep(step.expect, result, assertsPassed)

            return {
                stepId: step.id,
                name: step.name,
                ok: outcome.ok,
                skipped: false,
                status: result.status,
                durationMs: Date.now() - startedAt,
                asserts,
                extracted,
                result,
                error: outcome.error,
            }
        } catch (error) {
            return {
                stepId: step.id,
                name: step.name,
                ok: false,
                skipped: false,
                durationMs: Date.now() - startedAt,
                asserts: [],
                extracted: {},
                error:
                    error instanceof ResolvrError
                        ? `${error.code}: ${error.message}`
                        : error instanceof Error
                          ? error.message
                          : 'Неизвестная ошибка шага',
            }
        }
    }

    private _skippedResult(step: IFlowStep): IFlowStepResult {
        return {
            stepId: step.id,
            name: step.name,
            ok: false,
            skipped: true,
            durationMs: 0,
            asserts: [],
            extracted: {},
            error: 'Пропущен из-за падения предыдущего шага',
        }
    }
}

/**
 * Итог шага по ожидаемому результату.
 *
 * Для негативного теста ошибка сервера — это успех шага, а неожиданно
 * успешный ответ — провал: иначе проверка «без прав — отказ» проходила бы
 * и тогда, когда права перестали проверяться. Проверки шага обязательны при
 * любом ожидании.
 */
export function judgeStep(
    expect: IFlowStepExpect,
    result: Pick<IRunResult, 'ok' | 'status' | 'errors'>,
    assertsPassed: boolean,
): { ok: boolean; error?: string } {
    const failure = `HTTP ${result.status}, ошибок GraphQL: ${result.errors?.length ?? 0}`

    if (expect === 'success' && !result.ok) return { ok: false, error: failure }
    if (expect === 'error' && result.ok) {
        return { ok: false, error: `Ожидалась ошибка, а запрос выполнился успешно (HTTP ${result.status})` }
    }
    if (!assertsPassed) return { ok: false, error: 'Проверки шага не прошли' }

    return { ok: true }
}

/** Проверяет одно утверждение против результата шага. */
export function evaluateAssert(assertion: IFlowAssert, payload: unknown): IAssertResult {
    const actual = readPath(payload, assertion.path)
    const expected = assertion.value

    let passed: boolean
    switch (assertion.op) {
        case 'eq':
            passed = deepEqual(actual, expected)
            break
        case 'ne':
            passed = !deepEqual(actual, expected)
            break
        case 'exists':
            passed = actual !== undefined && actual !== null
            break
        case 'notExists':
            passed = actual === undefined || actual === null
            break
        case 'contains':
            passed = containsValue(actual, expected)
            break
        case 'gt':
            passed = typeof actual === 'number' && typeof expected === 'number' && actual > expected
            break
        case 'lt':
            passed = typeof actual === 'number' && typeof expected === 'number' && actual < expected
            break
        default:
            passed = false
    }

    return {
        assert: assertion,
        passed,
        actual,
        message: passed
            ? `${assertion.path} ${assertion.op} — ок`
            : `${assertion.path}: ожидалось ${assertion.op} ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`,
    }
}

function containsValue(actual: unknown, expected: unknown): boolean {
    if (typeof actual === 'string') return actual.includes(String(expected))
    if (Array.isArray(actual)) return actual.some((item) => deepEqual(item, expected))

    return false
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true
    if (left === null || right === null) return false
    if (typeof left !== typeof right) return false
    if (typeof left !== 'object') return false

    return JSON.stringify(left) === JSON.stringify(right)
}

/** Контекст флоу в виде строк — для подстановки `{{name}}` в переменные шага. */
function toStringContext(context: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(context)) {
        result[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }

    return result
}

/**
 * Переменные, которые цепочка авторизации добывает сама.
 *
 * Явно указанное в настройках имя считается точным: пользователь взял выбор
 * на себя, и трогать остальные заголовки нельзя. Без него имена выводятся —
 * из `extract` самой цепочки и из секретов окружения, на которые ссылаются
 * его заголовки. Второй источник нужен потому, что `extract` может называть
 * значение иначе, чем переменная в заголовке, — а именно этот заголовок и
 * уносил в запрос логина уже истёкший токен.
 */
function tokenVariables(environments: IEnvironment[], flow: IFlow): string[] {
    const explicit = environments
        .map((environment) => environment.recovery?.tokenVariable?.trim())
        .filter((name): name is string => Boolean(name))

    if (explicit.length > 0) return [...new Set(explicit)]

    const fromHeaders = environments.flatMap((environment) =>
        Object.entries(environment.variables)
            .filter(
                ([name, value]) =>
                    isSecretRef(value) &&
                    Object.values(environment.headers).some((header) =>
                        header.includes(`{{${name}}}`),
                    ),
            )
            .map(([name]) => name),
    )

    return [...new Set([...flow.steps.flatMap((step) => Object.keys(step.extract)), ...fromHeaders])]
}
