import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import {
    HISTORY_BODY_LIMIT,
    type IEndpoint,
    type IEnvironment,
    type IHistoryEntry,
    type IOperationKind,
    type IWorkspace,
} from '../model/schemas.js'
import type { ISecretStore } from '../ports/secret-store.js'
import { TokenKeeper } from '../secrets/token-keeper.js'
import type { TokenInfoStore } from '../secrets/token-info-store.js'
import type {
    IHttpResponse,
    ISubscriptionHandlers,
    ITransport,
    IUnsubscribe,
} from '../ports/transport.js'
import {
    hasUnresolvedPlaceholders,
    interpolateHeaders,
    interpolateJson,
    maskHeaders,
    maskSecrets,
    maskSecretsInJson,
    type SecretResolver,
} from '../secrets/secret-resolver.js'
import { buildResponsePreview, type HistoryStore } from '../storage/history-store.js'
import {
    detectOperationKind,
    parseOperationRef,
    type WorkspaceStore,
} from '../storage/workspace-store.js'

const TOKEN_EXPIRY_SUFFIX = '__expires_at'
const EXPIRY_MARGIN_MS = 30_000

/**
 * Исполнитель цепочек, каким его видит движок запросов.
 *
 * Интерфейс, а не прямая ссылка на `FlowRunner`: раннер сам вызывает движок для
 * каждого шага, и прямая зависимость замкнула бы модули друг на друга.
 */
export interface IFlowExecutor {
    run(
        workspaceId: string,
        flowId: string,
        options?: { environmentId?: string; endpointId?: string },
    ): Promise<{ ok: boolean; context: Record<string, unknown> }>
}

/** Убирает заголовки, значение которых зависит от перечисленных переменных. */
export function dropHeadersUsingVariables(
    headers: Record<string, string>,
    names: string[],
): Record<string, string> {
    if (names.length === 0) return headers

    const result: Record<string, string> = {}

    for (const [header, value] of Object.entries(headers)) {
        const used = names.some((name) => value.includes(`{{${name}}}`))
        if (!used) result[header] = value
    }

    return result
}

export interface IRunEngineDeps {
    workspaces: WorkspaceStore
    history: HistoryStore
    resolver: SecretResolver
    tokens: TokenInfoStore
    transport: ITransport
    secrets: ISecretStore
}

export interface IRunInput {
    workspaceId: string
    /** Либо ссылка на сохранённую операцию, либо произвольный запрос. */
    operationRef?: string
    query?: string
    variables?: Record<string, unknown>
    headers?: Record<string, string>
    operationName?: string
    endpointId?: string
    environmentId?: string
    /** Ограничение времени запроса; по умолчанию его выбирает транспорт. */
    timeoutMs?: number
    /** Не записывать запуск в историю — например, для служебного логина. */
    skipHistory?: boolean
    /**
     * Не применять auth-профиль окружения. Нужно самой операции логина: иначе
     * подготовка запроса снова потребовала бы токен и ушла в рекурсию.
     */
    skipAuth?: boolean
    /**
     * Переменные, которые добывает сама цепочка, выполняющая этот запрос.
     *
     * Заголовки, зависящие от них, не подставляются: прошлый токен к моменту
     * обновления уже истёк, и сервер отвергал бы им сам запрос логина. Профиль
     * авторизации окружения по той же причине не применяется.
     */
    producedVariables?: string[]
    /**
     * Не запускать цепочки подготовки и восстановления. Ставится для шагов
     * самих цепочек — иначе восстановление вызывало бы себя же.
     */
    skipFlows?: boolean
    /** Значения, добытые цепочкой подготовки: подставляются как `{{name}}`. */
    flowContext?: Record<string, string>
}

export interface IRunResult {
    ok: boolean
    /** Сработавшие цепочки: подготовка и восстановление с их результатом. */
    flowRuns?: IFlowRunSummary[]
    status: number
    statusText: string
    /** Заголовки ответа; чувствительные значения замаскированы. */
    headers: Record<string, string>
    /** Сырое тело ответа с замаскированными секретами. */
    body: string
    data?: unknown
    errors?: unknown[]
    kind: IOperationKind
    durationMs: number
    firstByteMs?: number
    responseBytes: number
    /** Заголовки запроса в замаскированном виде — для панели Trace. */
    requestHeaders: Record<string, string>
    /**
     * Заголовки, не отправленные из-за нераскрытых переменных.
     *
     * Чаще всего это `Authorization` до первого логина: отправлять его с
     * буквальным `{{token}}` бессмысленно, а знать об этом нужно.
     */
    unresolvedHeaders?: string[]
    endpointId: string
    environmentId?: string
}

/** След выполнения вспомогательной цепочки внутри запроса. */
export interface IFlowRunSummary {
    kind: 'prerequisite' | 'recovery' | 'refresh'
    flowId: string
    ok: boolean
    /** Значения, попавшие в запрос из цепочки. */
    context: Record<string, unknown>
}

export interface ISubscribeInput {
    workspaceId: string
    operationRef?: string
    query?: string
    variables?: Record<string, unknown>
    headers?: Record<string, string>
    operationName?: string
    endpointId?: string
    environmentId?: string
}

/** Подготовленный к отправке запрос со всеми раскрытыми переменными. */
export interface IRequestDescription {
    url: string
    headers: Record<string, string>
    body: string
    /** Значения, которые при показе человеку следует замаскировать. */
    secretValues: string[]
}

interface IPreparedRequest {
    workspace: IWorkspace
    endpoint: IEndpoint
    environment: IEnvironment | undefined
    query: string
    variables: Record<string, unknown>
    headers: Record<string, string>
    operationName: string | undefined
    secretValues: string[]
    kind: IOperationKind
    /** Имена заголовков, отброшенных из-за нераскрытых переменных. */
    unresolvedHeaders: string[]
}

/**
 * Выполнение GraphQL-операций.
 *
 * Один и тот же движок используется приложением, MCP-сервером и раннером флоу,
 * поэтому подстановка переменных, авторизация и запись истории ведут себя
 * одинаково независимо от того, кто запустил операцию.
 */
export class RunEngine {
    private readonly _workspaces: WorkspaceStore
    private readonly _history: HistoryStore
    private readonly _resolver: SecretResolver
    private readonly _transport: ITransport
    private readonly _secrets: ISecretStore
    private readonly _tokens: TokenInfoStore
    private _flows: IFlowExecutor | undefined

    constructor(deps: IRunEngineDeps) {
        this._workspaces = deps.workspaces
        this._history = deps.history
        this._resolver = deps.resolver
        this._tokens = deps.tokens
        this._transport = deps.transport
        this._secrets = deps.secrets
    }

    /** Подключает исполнитель цепочек; без него подготовка и восстановление не работают. */
    public setFlowExecutor(flows: IFlowExecutor): void {
        this._flows = flows
    }

    /**
     * Выполняет операцию.
     *
     * Вокруг самого запроса работают две цепочки: подготовка (её значения
     * попадают в переменные и заголовки) и восстановление — оно запускается,
     * когда ответ похож на протухшую авторизацию, после чего запрос
     * повторяется. Это снимает ручной цикл «получил 401 → сходил за токеном →
     * подставил заголовок → повторил».
     */
    /**
     * Описывает HTTP-запрос так, как он ушёл бы на сервер: URL, заголовки с
     * раскрытыми секретами и тело. Нужно для экспорта в `curl`; цепочки
     * подготовки и восстановления при этом не выполняются.
     */
    public async describeRequest(input: IRunInput): Promise<IRequestDescription> {
        const prepared = await this._prepare(input)

        return {
            url: prepared.endpoint.url,
            headers: prepared.headers,
            body: JSON.stringify({
                query: prepared.query,
                variables: prepared.variables,
                operationName: prepared.operationName,
            }),
            secretValues: prepared.secretValues,
        }
    }

    public async run(input: IRunInput): Promise<IRunResult> {
        const flowRuns: IFlowRunSummary[] = []
        let flowContext = { ...(input.flowContext ?? {}) }

        const refresh = await this._refreshExpiringToken(input)
        if (refresh) {
            flowRuns.push(refresh)
            flowContext = { ...flowContext, ...toStringContext(refresh.context) }
        }

        const prerequisite = await this._runPrerequisite(input)
        if (prerequisite) {
            flowRuns.push(prerequisite)
            flowContext = { ...flowContext, ...toStringContext(prerequisite.context) }
        }

        let result = await this._execute({ ...input, flowContext })
        let attempt = 0

        for (;;) {
            const recovery = await this._planRecovery(input, result, attempt)
            if (!recovery) break

            attempt += 1
            flowRuns.push(recovery)
            if (!recovery.ok) break

            flowContext = { ...flowContext, ...toStringContext(recovery.context) }
            result = await this._execute({ ...input, flowContext })
        }

        return flowRuns.length > 0 ? { ...result, flowRuns } : result
    }

    /** Один проход запроса без цепочек: подготовка, отправка, запись истории. */
    private async _execute(input: IRunInput): Promise<IRunResult> {
        const prepared = await this._prepare(input)

        const response = await this._transport.request({
            url: prepared.endpoint.url,
            method: 'POST',
            headers: prepared.headers,
            body: JSON.stringify({
                query: prepared.query,
                variables: prepared.variables,
                operationName: prepared.operationName,
            }),
            acceptInvalidCerts: prepared.endpoint.acceptInvalidCerts,
            timeoutMs: input.timeoutMs,
        })

        const result = this._buildResult(prepared, response)
        if (!input.skipHistory) await this._writeHistory(input.workspaceId, prepared, result, input)

        return result
    }

    /**
     * Обновляет токен, который вот-вот истечёт.
     *
     * Срок берётся из `exp` последнего полученного JWT. Обновление до запроса
     * дешевле реакции на отказ: сервер не отвечает ошибкой, история не
     * засоряется падениями, а запрос уходит один раз.
     */
    private async _refreshExpiringToken(
        input: IRunInput,
    ): Promise<IFlowRunSummary | undefined> {
        if (input.skipFlows || !this._flows) return undefined

        const workspace = await this._workspaces.getWorkspace(input.workspaceId)
        const environment = this._resolveEnvironment(workspace, input.environmentId)
        const rule = environment?.recovery

        if (!environment || !rule?.enabled || !rule.onExpiry) return undefined

        const info = await this._tokens.get(workspace.id, environment.id)
        if (!info?.expiresAt) return undefined

        const margin = rule.refreshMarginSec * 1000
        const expiresAt = new Date(info.expiresAt).getTime()
        if (Number.isNaN(expiresAt) || expiresAt - Date.now() > margin) return undefined

        const flow = await this._flows.run(input.workspaceId, rule.flowId, {
            environmentId: input.environmentId,
            endpointId: input.endpointId,
        })

        if (flow.ok) {
            await this._rememberToken(input.workspaceId, environment.id, flow.context, rule.tokenVariable)
        }

        return { kind: 'refresh', flowId: rule.flowId, ok: flow.ok, context: flow.context }
    }

    /**
     * Запоминает срок жизни полученного токена.
     *
     * Значение самого токена в файл не пишется — только время истечения и
     * владелец, чтобы приложение могло показать состояние и обновить заранее.
     */
    private async _rememberToken(
        workspaceId: string,
        environmentId: string,
        context: Record<string, unknown>,
        tokenVariable?: string,
    ): Promise<void> {
        await new TokenKeeper(this._workspaces, this._resolver, this._tokens).remember(
            workspaceId,
            environmentId,
            context,
            tokenVariable,
        )
    }

    /** Запускает цепочку подготовки, если операция её объявляет. */
    private async _runPrerequisite(input: IRunInput): Promise<IFlowRunSummary | undefined> {
        if (input.skipFlows || !this._flows || !input.operationRef) return undefined

        const operation = await this._workspaces.getOperation(
            input.workspaceId,
            parseOperationRef(input.operationRef),
        )
        if (!operation.prerequisiteFlow) return undefined

        const flow = await this._flows.run(input.workspaceId, operation.prerequisiteFlow, {
            environmentId: input.environmentId,
            endpointId: input.endpointId,
        })

        return {
            kind: 'prerequisite',
            flowId: operation.prerequisiteFlow,
            ok: flow.ok,
            context: flow.context,
        }
    }

    /**
     * Решает, нужно ли восстановление, и выполняет его.
     *
     * Возвращает `undefined`, когда повторять нечего: правило выключено, ответ
     * успешен, не подходит под условие или попытки исчерпаны.
     */
    private async _planRecovery(
        input: IRunInput,
        result: IRunResult,
        attempt: number,
    ): Promise<IFlowRunSummary | undefined> {
        if (input.skipFlows || !this._flows || result.ok) return undefined

        const workspace = await this._workspaces.getWorkspace(input.workspaceId)
        const environment = this._resolveEnvironment(workspace, input.environmentId)
        const rule = environment?.recovery

        if (!environment || !rule?.enabled || !rule.onError) return undefined
        if (attempt >= rule.maxAttempts) return undefined
        if (!matchesRecovery(rule, result)) return undefined

        const flow = await this._flows.run(input.workspaceId, rule.flowId, {
            environmentId: input.environmentId,
            endpointId: input.endpointId,
        })

        if (flow.ok) {
            await this._rememberToken(input.workspaceId, environment.id, flow.context, rule.tokenVariable)
        }

        return { kind: 'recovery', flowId: rule.flowId, ok: flow.ok, context: flow.context }
    }

    /**
     * Открывает подписку. URL берётся из `subscriptionUrl`, а при его отсутствии
     * выводится из основного заменой схемы на ws/wss — типовая конфигурация,
     * которую иначе пришлось бы прописывать руками в каждом workspace.
     */
    public async subscribe(
        input: ISubscribeInput,
        handlers: ISubscriptionHandlers,
    ): Promise<IUnsubscribe> {
        const prepared = await this._prepare(input)
        const url = prepared.endpoint.subscriptionUrl ?? toWebSocketUrl(prepared.endpoint.url)

        return this._transport.subscribe(
            {
                url,
                headers: prepared.headers,
                query: prepared.query,
                variables: prepared.variables,
                operationName: prepared.operationName,
                acceptInvalidCerts: prepared.endpoint.acceptInvalidCerts,
            },
            {
                ...handlers,
                onNext: (payload) =>
                    handlers.onNext(maskSecretsInJson(payload, prepared.secretValues)),
            },
        )
    }

    /** Собирает всё необходимое для отправки: запрос, переменные, заголовки, авторизацию. */
    private async _prepare(input: IRunInput | ISubscribeInput): Promise<IPreparedRequest> {
        const workspace = await this._workspaces.getWorkspace(input.workspaceId)

        let query = input.query
        let variables = input.variables ?? {}
        let operationHeaders: Record<string, string> = {}
        let endpointId = input.endpointId
        let environmentId = input.environmentId

        if (input.operationRef) {
            const ref = parseOperationRef(input.operationRef)
            const operation = await this._workspaces.getOperation(input.workspaceId, ref)
            const collection = await this._workspaces.getCollection(
                input.workspaceId,
                ref.collectionId,
            )

            query = query ?? operation.query
            variables = { ...operation.variables, ...(input.variables ?? {}) }
            operationHeaders = { ...collection.headers, ...operation.headers }
            endpointId = endpointId ?? operation.endpointId
            environmentId = environmentId ?? operation.environmentId
        }

        if (!query || query.trim().length === 0) {
            throw new ResolvrError(
                ErrorCodeEnum.INVALID_OPERATION,
                'Пустой запрос: укажите operationRef или текст query',
                { workspaceId: input.workspaceId },
            )
        }

        const endpoint = this._resolveEndpoint(workspace, endpointId)
        const environment = this._resolveEnvironment(workspace, environmentId)

        const resolved = environment
            ? await this._resolver.resolveEnvironment(workspace, environment)
            : { variables: {}, secretValues: [], missing: [] }

        const produced = ('producedVariables' in input ? input.producedVariables : undefined) ?? []
        const skipAuth = produced.length > 0 || ('skipAuth' in input && input.skipAuth === true)
        const authHeaders =
            environment && !skipAuth ? await this._applyAuth(workspace, environment, resolved) : {}

        const environmentHeaders = dropHeadersUsingVariables(environment?.headers ?? {}, produced)

        // Значения цепочки подготовки перекрывают переменные окружения: свежий
        // токен из логина должен побеждать сохранённый ранее.
        const flowContext = 'flowContext' in input ? (input.flowContext ?? {}) : {}
        const substitutions = { ...resolved.variables, ...flowContext }

        // Порядок наложения — от общего к частному: эндпоинт, окружение,
        // коллекция, операция, вызов; авторизация применяется последней.
        const merged = {
            'content-type': 'application/json',
            accept: 'application/json',
            ...interpolateHeaders(endpoint.headers, substitutions),
            ...interpolateHeaders(environmentHeaders, substitutions),
            ...interpolateHeaders(operationHeaders, substitutions),
            ...interpolateHeaders(input.headers ?? {}, substitutions),
            ...authHeaders,
        }

        // Заголовок с нераскрытой переменной не отправляется: сервер принял бы
        // буквальный `Bearer {{token}}` за неверный токен и отверг запрос — в
        // том числе запрос логина, которым эта переменная и добывается.
        const { headers, unresolvedHeaders } = dropUnresolvedHeaders(merged)

        return {
            workspace,
            endpoint,
            environment,
            query,
            variables: interpolateJson(variables, substitutions),
            headers,
            operationName: input.operationName,
            secretValues: resolved.secretValues,
            kind: detectOperationKind(query),
            unresolvedHeaders,
        }
    }

    /**
     * Готовит заголовок авторизации.
     *
     * Для профиля `login` токен добывается автоматически: если сохранённый
     * токен ещё не протух, он переиспользуется, иначе выполняется операция
     * логина и новый токен кладётся в Keychain. Ручное копирование токена
     * из ответа в headers перестаёт быть нужным.
     */
    private async _applyAuth(
        workspace: IWorkspace,
        environment: IEnvironment,
        resolved: { variables: Record<string, string>; secretValues: string[] },
    ): Promise<Record<string, string>> {
        const auth = environment.auth

        if (auth.type === 'none') return {}

        if (auth.type === 'bearer') {
            const token = resolved.variables[auth.tokenVariable]
            if (!token) {
                throw new ResolvrError(
                    ErrorCodeEnum.AUTH_FAILED,
                    `Переменная "${auth.tokenVariable}" пуста — токен для авторизации не найден`,
                    { workspaceId: workspace.id, environmentId: environment.id },
                )
            }

            return { authorization: `${auth.prefix}${token}` }
        }

        const token = await this._obtainLoginToken(workspace, environment, resolved)

        return { [auth.headerName.toLowerCase()]: `${auth.prefix}${token}` }
    }

    private async _obtainLoginToken(
        workspace: IWorkspace,
        environment: IEnvironment,
        resolved: { variables: Record<string, string>; secretValues: string[] },
    ): Promise<string> {
        const auth = environment.auth
        if (auth.type !== 'login') {
            throw new ResolvrError(ErrorCodeEnum.AUTH_FAILED, 'Профиль авторизации не login', {
                workspaceId: workspace.id,
            })
        }

        const cached = await this._readCachedToken(workspace.id, environment.id, auth.storeAs)
        if (cached) {
            resolved.secretValues.push(cached)

            return cached
        }

        const loginResult = await this.run({
            workspaceId: workspace.id,
            operationRef: auth.operationRef,
            variables: interpolateJson(auth.variables, resolved.variables),
            environmentId: environment.id,
            skipHistory: true,
            skipAuth: true,
        })

        const token = readPath(
            { data: loginResult.data, errors: loginResult.errors },
            auth.tokenPath,
        )
        if (typeof token !== 'string' || token.length === 0) {
            throw new ResolvrError(
                ErrorCodeEnum.AUTH_FAILED,
                `Операция логина "${auth.operationRef}" не вернула токен по пути "${auth.tokenPath}"`,
                {
                    workspaceId: workspace.id,
                    environmentId: environment.id,
                    status: loginResult.status,
                    errorCount: loginResult.errors?.length ?? 0,
                },
            )
        }

        await this._secrets.set(
            { workspace: workspace.id, environment: environment.id, key: auth.storeAs },
            token,
        )
        await this._secrets.set(
            {
                workspace: workspace.id,
                environment: environment.id,
                key: `${auth.storeAs}${TOKEN_EXPIRY_SUFFIX}`,
            },
            String(Date.now() + auth.ttlSeconds * 1000),
        )

        resolved.secretValues.push(token)

        return token
    }

    /** Возвращает токен из Keychain, если он ещё не истёк с учётом запаса. */
    private async _readCachedToken(
        workspaceId: string,
        environmentId: string,
        key: string,
    ): Promise<string | undefined> {
        const token = await this._secrets.get({
            workspace: workspaceId,
            environment: environmentId,
            key,
        })
        if (!token) return undefined

        const expiresRaw = await this._secrets.get({
            workspace: workspaceId,
            environment: environmentId,
            key: `${key}${TOKEN_EXPIRY_SUFFIX}`,
        })
        const expiresAt = expiresRaw ? Number(expiresRaw) : 0
        if (!Number.isFinite(expiresAt) || Date.now() + EXPIRY_MARGIN_MS >= expiresAt) {
            return undefined
        }

        return token
    }

    private _resolveEndpoint(workspace: IWorkspace, endpointId: string | undefined): IEndpoint {
        const wanted = endpointId ?? workspace.defaultEndpointId
        const endpoint = wanted
            ? workspace.endpoints.find((item) => item.id === wanted)
            : workspace.endpoints[0]

        if (!endpoint) {
            throw new ResolvrError(
                ErrorCodeEnum.ENDPOINT_NOT_FOUND,
                wanted
                    ? `Эндпоинт "${wanted}" не найден в workspace "${workspace.id}"`
                    : `В workspace "${workspace.id}" не задано ни одного эндпоинта`,
                { workspaceId: workspace.id, endpointId: wanted },
            )
        }

        return endpoint
    }

    private _resolveEnvironment(
        workspace: IWorkspace,
        environmentId: string | undefined,
    ): IEnvironment | undefined {
        const wanted = environmentId ?? workspace.defaultEnvironmentId
        if (!wanted) return workspace.environments[0]

        const environment = workspace.environments.find((item) => item.id === wanted)
        if (!environment) {
            throw new ResolvrError(
                ErrorCodeEnum.ENVIRONMENT_NOT_FOUND,
                `Окружение "${wanted}" не найдено в workspace "${workspace.id}"`,
                { workspaceId: workspace.id, environmentId: wanted },
            )
        }

        return environment
    }

    private _buildResult(prepared: IPreparedRequest, response: IHttpResponse): IRunResult {
        const maskedBody = maskSecrets(response.body, prepared.secretValues)

        let data: unknown
        let errors: unknown[] | undefined
        try {
            const parsed = JSON.parse(maskedBody) as { data?: unknown; errors?: unknown[] }
            data = parsed.data
            errors = parsed.errors
        } catch {
            // Не-JSON ответ (HTML-страница ошибки, текст прокси) остаётся доступным как body.
        }

        return {
            ok: response.status >= 200 && response.status < 300 && (errors?.length ?? 0) === 0,
            status: response.status,
            statusText: response.statusText,
            headers: maskHeaders(response.headers, prepared.secretValues),
            body: maskedBody,
            data,
            errors,
            kind: prepared.kind,
            durationMs: response.timings.totalMs,
            firstByteMs: response.timings.firstByteMs,
            responseBytes: response.body.length,
            requestHeaders: maskHeaders(prepared.headers, prepared.secretValues),
            unresolvedHeaders:
                prepared.unresolvedHeaders.length > 0 ? prepared.unresolvedHeaders : undefined,
            endpointId: prepared.endpoint.id,
            environmentId: prepared.environment?.id,
        }
    }

    private async _writeHistory(
        workspaceId: string,
        prepared: IPreparedRequest,
        result: IRunResult,
        input: { operationRef?: string },
    ): Promise<void> {
        const entry: IHistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ts: new Date().toISOString(),
            workspaceId,
            endpointId: prepared.endpoint.id,
            environmentId: prepared.environment?.id,
            operationName: prepared.operationName,
            kind: prepared.kind,
            query: prepared.query,
            variables: maskSecretsInJson(prepared.variables, prepared.secretValues),
            status: result.status,
            ok: result.ok,
            durationMs: result.durationMs,
            errorCount: result.errors?.length ?? 0,
            responseBytes: result.responseBytes,
            responsePreview: buildResponsePreview(result.body),
            operationRef: input.operationRef,
            statusText: result.statusText,
            responseBody:
                result.body.length <= HISTORY_BODY_LIMIT ? result.body : undefined,
            responseTruncated: result.body.length > HISTORY_BODY_LIMIT,
            responseHeaders: result.headers,
            requestHeaders: result.requestHeaders,
        }

        await this._history.append(workspaceId, entry)
    }
}

/** Достаёт значение по пути вида `data.login.accessToken`; поддерживает индексы массива. */
export function readPath(source: unknown, path: string): unknown {
    const segments = path.split('.').filter((segment) => segment.length > 0)
    let current: unknown = source

    for (const segment of segments) {
        if (current === null || current === undefined) return undefined

        if (Array.isArray(current)) {
            const index = Number(segment)
            if (!Number.isInteger(index)) return undefined
            current = current[index]
            continue
        }

        if (typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[segment]
    }

    return current
}

/**
 * Отбрасывает заголовки с нераскрытыми переменными.
 *
 * Возвращает и очищенный набор, и имена отброшенных: без второго пользователь
 * не понимал бы, почему запрос ушёл без авторизации.
 */
export function dropUnresolvedHeaders(headers: Record<string, string>): {
    headers: Record<string, string>
    unresolvedHeaders: string[]
} {
    const result: Record<string, string> = {}
    const unresolvedHeaders: string[] = []

    for (const [name, value] of Object.entries(headers)) {
        if (hasUnresolvedPlaceholders(value)) {
            unresolvedHeaders.push(name)
            continue
        }

        result[name] = value
    }

    return { headers: result, unresolvedHeaders }
}

/** Подходит ли ответ под правило восстановления. */
export function matchesRecovery(
    rule: { statuses: number[]; messagePatterns: string[] },
    result: Pick<IRunResult, 'status' | 'errors' | 'body'>,
): boolean {
    if (rule.statuses.includes(result.status)) return true
    if (rule.messagePatterns.length === 0) return false

    const haystack = JSON.stringify(result.errors ?? result.body).toLowerCase()

    return rule.messagePatterns.some((pattern) => haystack.includes(pattern.toLowerCase()))
}

/** Контекст цепочки в виде строк — для подстановки `{{name}}`. */
function toStringContext(context: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(context)) {
        if (value === null || value === undefined) continue
        result[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }

    return result
}

/** Преобразует http(s)-адрес эндпоинта в ws(s) для подписок. */
export function toWebSocketUrl(url: string): string {
    return url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
}
