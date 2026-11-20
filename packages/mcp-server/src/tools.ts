import {
    buildSchemaSummary,
    diffSchemas,
    ErrorCodeEnum,
    findFlowProblems,
    FlowSchema,
    formatOperationRef,
    isResolvrError,
    maskSecretsInJson,
    parseOperationRef,
    listRootFields,
    printTypeLimited,
    readPath,
    RequestScriptsSchema,
    ResolvrError,
    searchSchema,
    SECRET_MASK,
    SlugSchema,
    toErrorMessage,
    toSlug,
    type IRequestScripts,
    type IRequestScriptTarget,
} from '@resolvr/core'
import type { INodeContext } from '@resolvr/core/node'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z, type ZodRawShape } from 'zod'

import {
    NARRATION_SHAPE,
    splitNarration,
    type ActivityRecorder,
} from './activity-recorder.js'

/**
 * Инструменты, доступные агенту.
 *
 * Работают поверх того же ядра, что и приложение, и с теми же файлами: коллекция,
 * созданная здесь, немедленно появляется в открытом GUI. Каждый вызов требует
 * описания намерения и попадает в журнал действий, поэтому пользователь видит
 * не только результат, но и ход работы агента.
 */
export function registerTools(
    server: McpServer,
    context: INodeContext,
    recorder: ActivityRecorder,
): void {
    const register = createRegistrar(server, recorder)

    registerNarrationTools(server, recorder)
    registerWorkspaceTools(register, context)
    registerCollectionTools(register, context)
    registerRunTools(register, context)
    registerSchemaTools(register, context)
    registerFlowTools(register, context)
    registerEnvironmentTools(register, context)
    registerScriptTools(register, context)
}

interface IToolDefinition<TShape extends ZodRawShape, TResult> {
    name: string
    title: string
    description: string
    inputSchema: TShape
    run: (args: z.infer<z.ZodObject<TShape>>) => Promise<TResult>
    /** Однострочная сводка результата для списка в журнале. */
    summarize: (result: TResult) => string
    /** Исход операции внутри успешного ответа протокола MCP. */
    isSuccessful?: (result: TResult) => boolean
}

type IRegisterTool = <TShape extends ZodRawShape, TResult>(
    definition: IToolDefinition<TShape, TResult>,
) => void

/**
 * Обёртка регистрации инструмента.
 *
 * Добавляет к схеме поля повествования, разбирает аргументы и записывает вызов
 * в журнал — включая неудачные попытки, без которых цепочка рассуждения
 * выглядела бы искусственно гладкой.
 */
function createRegistrar(server: McpServer, recorder: ActivityRecorder): IRegisterTool {
    return (definition) => {
        // Схема собирается как обобщённая: конкретный тип аргументов выводится
        // ниже разбором zod-схемы инструмента, а SDK достаточно общей формы.
        const inputSchema: ZodRawShape = { ...NARRATION_SHAPE, ...definition.inputSchema }

        server.registerTool(
            definition.name,
            {
                title: definition.title,
                description: definition.description,
                inputSchema,
            },
            async (rawArgs) => {
                const { narration, rest } = splitNarration(rawArgs as Record<string, unknown>)

                try {
                    const parsed = z.object(definition.inputSchema).parse(rest)
                    const result = await recorder.record(
                        definition.name,
                        narration,
                        rest,
                        () => definition.run(parsed),
                        (value) => ({
                            ok: definition.isSuccessful?.(value) ?? true,
                            summary: definition.summarize(value),
                        }),
                    )

                    return ok(result)
                } catch (error) {
                    return fail(error)
                }
            },
        )
    }
}

/**
 * Предел размера ответа инструмента.
 *
 * Ответ уходит в контекст агента целиком: мегабайт SDL — это сотни тысяч
 * токенов и десятки секунд ожидания. Всё, что больше предела, усекается с
 * подсказкой, как забрать нужное точечно.
 */
const RESPONSE_LIMIT = 40_000

/** Единый формат ответа: агенту удобнее разбирать JSON, чем прозу. */
function ok(payload: unknown, hint?: string): CallToolResult {
    const text = JSON.stringify(payload, null, 2)
    if (text.length <= RESPONSE_LIMIT) {
        return { content: [{ type: 'text', text }] }
    }

    const truncated = JSON.stringify(
        {
            truncated: true,
            shownChars: RESPONSE_LIMIT,
            totalChars: text.length,
            hint:
                hint ??
                'Ответ слишком велик и обрезан. Запросите нужную часть точечно — например, через фильтр, лимит или имя типа.',
            preview: `${text.slice(0, RESPONSE_LIMIT)}…`,
        },
        null,
        2,
    )

    return { content: [{ type: 'text', text: truncated }] }
}

function fail(error: unknown): CallToolResult {
    const payload = isResolvrError(error)
        ? { error: error.code, message: error.message, details: error.details }
        : { error: 'UNEXPECTED', message: toErrorMessage(error) }

    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true }
}

/** Инструменты, которыми агент описывает ход работы. */
function registerNarrationTools(server: McpServer, recorder: ActivityRecorder): void {
    server.registerTool(
        'plan',
        {
            title: 'Объявить задачу и план',
            description:
                'Вызывается перед началом каждой новой задачи. Название задачи показывается в списке действий, цель и шаги — в её журнале. Последующие вызовы относятся к объявленной задаче; поле step связывает их с шагом плана.',
            inputSchema: {
                title: z.string().trim().min(3).max(120).optional().describe('Короткое название задачи для списка, например «Проверка авторизации».'),
                goal: z.string().min(3).describe('Что проверяется и зачем — одной фразой.'),
                steps: z
                    .array(z.string())
                    .min(1)
                    .describe('Шаги по порядку. На них ссылаются вызовы через поле step.'),
            },
        },
        async (args) => {
            await recorder.recordPlan(args.goal, args.steps, args.title)

            return ok({
                planned: args.steps.length,
                sessionId: recorder.sessionId,
                note: 'Указывайте номер шага в поле step при каждом последующем вызове',
            })
        },
    )

    server.registerTool(
        'note',
        {
            title: 'Записать вывод',
            description:
                'Промежуточный вывод, наблюдение или итог этапа своими словами. Вызывается после значимых результатов — особенно когда результат разошёлся с ожиданием и меняет дальнейший план.',
            inputSchema: {
                text: z.string().min(3).describe('Наблюдение или вывод.'),
                step: z.number().int().nonnegative().optional().describe('Шаг плана.'),
            },
        },
        async (args) => {
            await recorder.recordNote(args.text, args.step)

            return ok({ recorded: true })
        },
    )
}

function registerWorkspaceTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'workspace_list',
        title: 'Список workspace',
        description:
            'Возвращает все workspace библиотеки с их эндпоинтами и окружениями. С этого стоит начинать: идентификатор workspace нужен почти всем остальным инструментам. Поле protection: readOnly — мутации запрещены, confirm — мутация выполняется только с confirm: true после согласия пользователя.',
        inputSchema: {},
        run: async () => {
            const workspaces = await context.workspaces.listWorkspaces()

            return workspaces.map((workspace) => ({
                id: workspace.id,
                name: workspace.name,
                // Защита показывается сразу: мутация в защищённом workspace
                // отвергается, и знать об этом до вызова дешевле, чем после.
                protection: workspace.protection,
                endpoints: workspace.endpoints.map((endpoint) => ({
                    id: endpoint.id,
                    name: endpoint.name,
                    url: endpoint.url,
                })),
                environments: workspace.environments.map((environment) => ({
                    id: environment.id,
                    name: environment.name,
                    auth: environment.auth.type,
                })),
                defaultEndpointId: workspace.defaultEndpointId,
                defaultEnvironmentId: workspace.defaultEnvironmentId,
            }))
        },
        summarize: (result) => `${result.length} workspace`,
    })

    register({
        name: 'workspace_create',
        title: 'Создать workspace',
        description:
            'Создаёт workspace с одним эндпоинтом и окружением по умолчанию. Идентификатор выводится из названия, если не задан явно.',
        inputSchema: {
            name: z.string().describe('Название проекта для интерфейса, например «API личного кабинета»'),
            endpointUrl: z.string().describe('URL GraphQL-эндпоинта'),
            id: z.string().optional().describe('Явный идентификатор (slug)'),
        },
        run: async (args) => {
            const workspace = await context.workspaces.createWorkspace({
                name: args.name,
                endpointUrl: args.endpointUrl,
                id: args.id,
            })

            return { created: workspace.id, name: workspace.name }
        },
        summarize: (result) => `Создан workspace «${result.name}»`,
    })
}

function registerCollectionTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'collection_list',
        title: 'Коллекции и операции',
        description:
            'Возвращает дерево коллекций workspace вместе с именами операций и их типом (query/mutation/subscription).',
        inputSchema: { workspaceId: z.string() },
        run: async (args) => {
            const collections = await context.workspaces.listCollections(args.workspaceId)
            const result = []

            for (const collection of collections) {
                const operations = await context.workspaces.listOperations(
                    args.workspaceId,
                    collection.id,
                )
                result.push({
                    id: collection.id,
                    name: collection.name,
                    operations: operations.map((operation) => ({
                        ref: formatOperationRef({
                            collectionId: collection.id,
                            name: operation.name,
                        }),
                        kind: operation.kind,
                        description: operation.description,
                    })),
                })
            }

            return result
        },
        summarize: (result) =>
            `${result.length} коллекций, ${result.reduce((sum, item) => sum + item.operations.length, 0)} операций`,
    })

    register({
        name: 'collection_create',
        title: 'Создать коллекцию',
        description: 'Создаёт коллекцию внутри workspace.',
        inputSchema: {
            workspaceId: z.string(),
            name: z.string().describe('Название предметной области для интерфейса, например «Авторизация» или «Заказы»'),
            id: z.string().optional().describe('Технический slug коллекции, например auth. Можно опустить'),
        },
        run: async (args) => {
            const collection = await context.workspaces.createCollection(
                args.workspaceId,
                args.name,
                args.id,
            )

            return { created: collection.id, name: collection.name }
        },
        summarize: (result) => `Создана коллекция «${result.name}»`,
    })

    register({
        name: 'operation_get',
        title: 'Прочитать операцию',
        description:
            'Возвращает текст запроса, переменные и заголовки сохранённой операции вместе с version — её следует передать в operation_save как expectedVersion, чтобы не затереть чужую правку.',
        inputSchema: {
            workspaceId: z.string(),
            ref: z.string().describe('Ссылка вида "collection/operation"'),
        },
        run: async (args) => {
            const ref = parseOperationRef(args.ref)
            const operation = await context.workspaces.getOperation(args.workspaceId, ref)

            // Версия отдаётся вместе с содержимым: с ней правка, начатая от
            // этого чтения, не затрёт чужую, сделанную тем временем.
            return { ...operation, version: await context.workspaces.operationVersion(args.workspaceId, ref) }
        },
        summarize: (result) => `${result.kind} ${result.name}`,
    })

    register({
        name: 'operation_save',
        title: 'Сохранить операцию',
        description:
            'Создаёт или перезаписывает операцию в коллекции. Запрос сохраняется отдельным .graphql-файлом, поэтому его удобно читать и версионировать.',
        inputSchema: {
            workspaceId: z.string(),
            collectionId: z.string(),
            name: z.string().describe('Название запроса в интерфейсе и имя файла, например «Получить профиль по ID». Можно использовать пробелы и кириллицу. Без разделителей пути и расширения. При обновлении передай прежнее имя из ref'),
            query: z.string().describe('GraphQL-документ. Имя операции внутри документа соответствует синтаксису GraphQL, например query GetProfile'),
            description: z.string().optional(),
            variables: z.record(z.string(), z.unknown()).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            endpointId: z.string().optional(),
            environmentId: z.string().optional(),
            expectedVersion: z
                .string()
                .optional()
                .describe(
                    'Версия из чтения (version): запись отменяется, если файл успели изменить. Передавайте её всегда, когда правите прочитанное — параллельные агенты пишут в одну коллекцию',
                ),
        },
        run: async (args) => {
            // Перезапись не должна терять то, что агент не передавал:
            // цепочку подготовки и правила сохранения в окружение.
            const existing = await context.workspaces
                .getOperation(args.workspaceId, {
                    collectionId: args.collectionId,
                    name: args.name,
                })
                .catch(() => undefined)

            const operation = await context.workspaces.saveOperation(args.workspaceId, {
                collectionId: args.collectionId,
                name: args.name,
                query: args.query,
                description: args.description ?? existing?.description,
                variables: args.variables,
                headers: args.headers,
                endpointId: args.endpointId,
                environmentId: args.environmentId,
                prerequisiteFlow: existing?.prerequisiteFlow,
                saveToEnvironment: existing?.saveToEnvironment,
                scripts: existing?.scripts,
                expectedVersion: args.expectedVersion,
            })

            return {
                saved: formatOperationRef({
                    collectionId: args.collectionId,
                    name: args.name,
                }),
                name: operation.name,
                kind: operation.kind,
            }
        },
        summarize: (result) => `Сохранён запрос «${result.name}»`,
    })

    register({
        name: 'operation_delete',
        title: 'Удалить операцию',
        description: 'Удаляет операцию из коллекции вместе с её метаданными.',
        inputSchema: { workspaceId: z.string(), ref: z.string() },
        run: async (args) => {
            await context.workspaces.deleteOperation(args.workspaceId, parseOperationRef(args.ref))

            return { deleted: args.ref }
        },
        summarize: (result) => `удалена ${result.deleted}`,
    })
}

function registerRunTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'run',
        title: 'Выполнить операцию',
        description:
            'Выполняет сохранённую операцию (по ref) либо произвольный запрос (query). Подставляет переменные окружения и авторизацию, пишет запуск в историю. Значения секретов в ответе замаскированы. ' +
            'Для больших ответов указывайте `select` — путь к нужной части (`data.users.count`), иначе ответ может быть обрезан.',
        inputSchema: {
            workspaceId: z.string(),
            ref: z.string().optional().describe('Ссылка "collection/operation"'),
            query: z.string().optional().describe('Произвольный запрос вместо ref'),
            variables: z.record(z.string(), z.unknown()).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            endpointId: z.string().optional(),
            environmentId: z.string().optional(),
            select: z
                .string()
                .optional()
                .describe('Путь в ответе: вернуть только эту часть, например `data.me.id`.'),
            confirm: z
                .boolean()
                .optional()
                .describe(
                    'Подтверждение мутации в защищённом workspace (protection: confirm). Передавать только после явного согласия пользователя; при protection: readOnly не действует',
                ),
        },
        run: async (args) => {
            const result = await context.runner.run({
                workspaceId: args.workspaceId,
                operationRef: args.ref,
                query: args.query,
                variables: args.variables,
                headers: args.headers,
                endpointId: args.endpointId,
                environmentId: args.environmentId,
                confirmed: args.confirm,
            })

            const payload = {
                ok: result.ok,
                status: result.status,
                durationMs: Math.round(result.durationMs),
                data: result.data,
                errors: result.errors,
                scriptError: result.scriptError,
            }

            // Выборка пути освобождает контекст: из ответа на тысячи узлов
            // агенту обычно нужно одно поле.
            if (args.select) {
                return {
                    ok: payload.ok,
                    status: payload.status,
                    durationMs: payload.durationMs,
                    select: args.select,
                    value: readPath(payload, args.select),
                    errors: payload.errors,
                    scriptError: payload.scriptError,
                }
            }

            return payload
        },
        isSuccessful: (result) => result.ok,
        summarize: (result) => {
            if (result.ok) return `HTTP ${result.status}`
            if (result.scriptError) return `HTTP ${result.status} · ошибка скрипта`
            const errors = result.errors?.length ?? 0

            return errors > 0 ? `HTTP ${result.status} · ошибок GraphQL: ${errors}` : `HTTP ${result.status}`
        },
    })

    register({
        name: 'history_list',
        title: 'История запусков',
        description:
            'Последние запуски операций с их статусом и длительностью. Полезно, чтобы понять, что уже проверялось и что упало.',
        inputSchema: {
            workspaceId: z.string(),
            limit: z.number().int().min(1).max(200).optional(),
            search: z.string().optional(),
            onlyFailed: z.boolean().optional(),
        },
        run: async (args) => {
            const entries = await context.history.list(args.workspaceId, {
                limit: args.limit ?? 10,
                search: args.search,
                onlyFailed: args.onlyFailed,
            })

            return entries.map((entry) => ({
                ts: entry.ts,
                operationName: entry.operationName,
                kind: entry.kind,
                status: entry.status,
                ok: entry.ok,
                durationMs: Math.round(entry.durationMs),
                errorCount: entry.errorCount,
                preview: entry.responsePreview.slice(0, 120),
            }))
        },
        summarize: (result) => `${result.length} записей`,
    })
}

function registerSchemaTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'introspect',
        title: 'Обновить схему',
        description:
            'Выполняет интроспекцию эндпоинта и обновляет кэш схемы. Предыдущий снимок сохраняется — на нём работает schema_diff.',
        inputSchema: {
            workspaceId: z.string(),
            endpointId: z.string().optional(),
            environmentId: z.string().optional(),
        },
        run: async (args) => {
            const workspace = await context.workspaces.getWorkspace(args.workspaceId)
            const endpointId = args.endpointId ?? workspace.defaultEndpointId
            const endpoint =
                workspace.endpoints.find((item) => item.id === endpointId) ?? workspace.endpoints[0]

            if (!endpoint) throw new Error(`В workspace "${args.workspaceId}" нет эндпоинтов`)

            const cache = await context.schemas.introspect(args.workspaceId, endpoint, { environmentId: args.environmentId })

            return {
                endpointId: endpoint.id,
                fetchedAt: cache.fetchedAt,
                hash: cache.hash,
                sdlLength: cache.sdl.length,
            }
        },
        summarize: (result) => `схема ${result.endpointId}, ${result.sdlLength} символов SDL`,
    })

    register({
        name: 'schema_get',
        title: 'Схема: сводка, тип или поиск',
        description:
            'По умолчанию возвращает оглавление: число типов и корневых операций плюс несколько имён для ориентира. ' +
            'Основной способ навигации — `search` по подстроке; `list` отдаёт раздел операций постранично, ' +
            '`typeName` печатает определение типа. ' +
            'Полный SDL (`full: true`) занимает сотни тысяч токенов — запрашивайте его только если действительно нужен весь текст.',
        inputSchema: {
            workspaceId: z.string(),
            endpointId: z.string().optional(),
            typeName: z.string().optional().describe('Определение конкретного типа.'),
            search: z
                .string()
                .optional()
                .describe('Поиск типов и полей по подстроке — например «accessToken».'),
            list: z
                .enum(['queries', 'mutations', 'subscriptions'])
                .optional()
                .describe('Постраничный список корневых операций раздела.'),
            offset: z.number().int().nonnegative().optional(),
            limit: z.number().int().min(1).max(200).optional(),
            full: z
                .boolean()
                .optional()
                .describe('Весь SDL целиком. Обычно не нужен и сильно расходует контекст.'),
        },
        run: async (args) => {
            const workspace = await context.workspaces.getWorkspace(args.workspaceId)
            const endpointId =
                args.endpointId ?? workspace.defaultEndpointId ?? workspace.endpoints[0]?.id
            if (!endpointId) throw new Error('Не задан эндпоинт')

            const schema = await context.schemas.getSchema(args.workspaceId, endpointId)
            if (!schema) throw new Error('Схема не загружена — выполните introspect')

            if (args.search) {
                const hits = searchSchema(schema, args.search)

                return { endpointId, search: args.search, found: hits.length, hits }
            }

            if (args.list) {
                return listRootFields(schema, args.list, args.offset ?? 0, args.limit ?? 50)
            }

            if (args.typeName) {
                const printed = printTypeLimited(schema, args.typeName)
                if (!printed) throw new Error(`Тип "${args.typeName}" не найден в схеме`)

                return {
                    endpointId,
                    typeName: args.typeName,
                    totalFields: printed.totalFields,
                    truncated: printed.truncated,
                    sdl: printed.sdl,
                }
            }

            if (args.full) {
                const sdl = await context.schemas.getSdl(args.workspaceId, endpointId)

                return { endpointId, sdl }
            }

            const summary = buildSchemaSummary(schema)

            return {
                endpointId,
                ...summary,
                hint: 'Подробности типа — `typeName`, поиск поля — `search`.',
            }
        },
        summarize: (result) => {
            if ('hits' in result) return `найдено ${result.found} совпадений`
            if ('section' in result) return `${result.section}: ${result.fields.length} из ${result.total}`
            if ('typeName' in result) return `тип ${String(result.typeName)}`
            if ('sdl' in result) return 'полный SDL'

            return `${result.typeCount} типов, ${result.queryCount} запросов, ${result.mutationCount} мутаций`
        },
    })

    register({
        name: 'schema_diff',
        title: 'Сравнить схемы',
        description:
            'Сравнивает текущий снимок схемы с предыдущим и показывает изменения, отмечая ломающие. Отвечает на вопрос «что сломалось после деплоя».',
        inputSchema: { workspaceId: z.string(), endpointId: z.string().optional() },
        run: async (args) => {
            const workspace = await context.workspaces.getWorkspace(args.workspaceId)
            const endpointId =
                args.endpointId ?? workspace.defaultEndpointId ?? workspace.endpoints[0]?.id
            if (!endpointId) throw new Error('Не задан эндпоинт')

            const previous = await context.schemas.getPreviousSdl(args.workspaceId, endpointId)
            const current = await context.schemas.getSdl(args.workspaceId, endpointId)

            if (!previous || !current) {
                return {
                    changes: [],
                    breakingCount: 0,
                    note: 'Нет предыдущего снимка — выполните introspect дважды с разными версиями схемы',
                }
            }

            return diffSchemas(previous, current)
        },
        summarize: (result) =>
            `${result.changes.length} изменений, ломающих: ${result.breakingCount}`,
    })
}

/** Шаг цепочки в том виде, в каком его передаёт агент: id можно не указывать. */
const FLOW_STEP_INPUT = z.object({
    id: z.string().optional().describe('Идентификатор шага; без него выдаётся "step-N"'),
    name: z.string().min(1).describe('Действие шага для отчёта, например «Получить токен» или «Проверить статус заказа»'),
    operationRef: z
        .string()
        .optional()
        .describe('Сохранённая операция "collection/operation" — либо она, либо query'),
    query: z.string().optional().describe('Встроенный текст запроса, если операции нет'),
    variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Переменные шага; "{{name}}" подставляет значение из extract прошлых шагов или окружения'),
    extract: z
        .record(z.string(), z.string())
        .optional()
        .describe('Что сохранить для следующих шагов: { "token": "data.login.accessToken" }'),
    assert: z
        .array(
            z.object({
                path: z.string().describe('Путь: "status", "data.user.id", "errors"'),
                op: z.enum(['eq', 'ne', 'exists', 'notExists', 'contains', 'gt', 'lt']),
                value: z.unknown().optional(),
            }),
        )
        .optional(),
    expect: z
        .enum(['success', 'error', 'any'])
        .optional()
        .describe(
            'Какой ответ считать успехом шага: success (по умолчанию) — без ошибок; error — сервер вернул ошибку, для негативных тестов (уточняйте её через assert по errors.0.message или errors.0.extensions.code); any — решают только assert',
        ),
    continueOnFailure: z.boolean().optional().describe('Не останавливать цепочку, если шаг упал'),
    environmentId: z.string().optional(),
    endpointId: z.string().optional(),
})

function registerFlowTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'flow_list',
        title: 'Список флоу',
        description:
            'Сценарии из нескольких шагов, сохранённые в workspace. Показывает метки, предусловия и дату последнего зелёного прогона; `tag` и `prefix` сужают список.',
        inputSchema: {
            workspaceId: z.string(),
            tag: z.string().optional().describe('Только цепочки с этой меткой'),
            prefix: z.string().optional().describe('Только цепочки, чей id начинается так'),
        },
        run: async (args) => {
            const flows = await context.workspaces.listFlows(args.workspaceId)
            const state = await context.flowState.read(args.workspaceId)

            return selectFlows(flows, args).map((flow) => ({
                id: flow.id,
                name: flow.name,
                tags: flow.tags,
                preconditions: flow.preconditions || undefined,
                steps: flow.steps.map((step) => step.name),
                // Свежесть проверки: когда цепочка последний раз проходила
                // целиком. Отвечает на «что здесь ещё зелёное» без отдельного
                // документа со списком smoke-тестов.
                lastGreenAt: state[flow.id]?.lastGreenAt,
                lastRunAt: state[flow.id]?.lastRunAt,
                lastRunOk: state[flow.id]?.ok,
            }))
        },
        summarize: (result) => `${result.length} цепочек`,
    })

    register({
        name: 'flow_get',
        title: 'Прочитать флоу',
        description:
            'Возвращает цепочку целиком: шаги, переменные, extract и assert, а также version — её следует передать в flow_save как expectedVersion, чтобы не затереть чужую правку.',
        inputSchema: { workspaceId: z.string(), flowId: z.string() },
        run: async (args) => ({
            ...(await context.workspaces.getFlow(args.workspaceId, args.flowId)),
            version: await context.workspaces.flowVersion(args.workspaceId, args.flowId),
        }),
        summarize: (result) => `${result.name}: ${result.steps.length} шагов`,
    })

    register({
        name: 'flow_save',
        title: 'Сохранить флоу',
        description:
            'Создаёт или перезаписывает цепочку (smoke-тест) из шагов. Каждый шаг — сохранённая операция (operationRef) или встроенный query; extract передаёт значения следующим шагам как {{name}}, assert проверяет ответ. Ссылки на операции, окружения и эндпоинты проверяются до записи. Перезапись заменяет шаги целиком — для правки сначала прочитайте цепочку через flow_get.',
        inputSchema: {
            workspaceId: z.string(),
            flowId: z
                .string()
                .optional()
                .describe('Технический slug, например sign-in-check. При обновлении используй существующий flowId. Без него идентификатор выводится из name'),
            name: z.string().min(1).describe('Название сценария в интерфейсе, например «Вход и проверка профиля»'),
            description: z.string().optional(),
            environmentId: z.string().optional().describe('Окружение по умолчанию для всех шагов'),
            endpointId: z.string().optional(),
            variables: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                    'Константы цепочки: доступны шагам как {{имя}} и раскрываются один раз за прогон. Значения генераторов ({{$uuid}}) фиксируются на весь прогон. Запуск может передать свои значения — они важнее',
                ),
            tags: z
                .array(z.string())
                .optional()
                .describe(
                    'Метки: фича, признак изменения данных (например, stateChanging), набор для прогона. По ним запускается flow_run_many',
                ),
            preconditions: z
                .string()
                .optional()
                .describe('Что должно быть в данных до прогона — текстом, для человека'),
            steps: z.array(FLOW_STEP_INPUT).min(1),
            expectedVersion: z
                .string()
                .optional()
                .describe(
                    'Версия из чтения (version): запись отменяется, если файл успели изменить. Передавайте её всегда, когда правите прочитанное — параллельные агенты пишут в одну коллекцию',
                ),
        },
        run: async (args) => {
            // Перезапись не должна терять метки и предусловия, которых агент
            // не передавал: он правит шаги, а реестр остаётся реестром.
            const existing = await context.workspaces
                .getFlow(args.workspaceId, args.flowId ?? toSlug(args.name))
                .catch(() => undefined)

            const flow = FlowSchema.parse({
                id: args.flowId ?? toSlug(args.name),
                name: args.name,
                description: args.description ?? '',
                environmentId: args.environmentId,
                endpointId: args.endpointId,
                variables: args.variables ?? existing?.variables ?? {},
                tags: args.tags ?? existing?.tags ?? [],
                preconditions: args.preconditions ?? existing?.preconditions ?? '',
                steps: args.steps.map((step, index) => ({
                    ...step,
                    id: step.id ?? `step-${index + 1}`,
                })),
            })

            const problems = await findFlowProblems(context.workspaces, args.workspaceId, flow)
            if (problems.length > 0) {
                const lines = problems.map((problem) =>
                    problem.step ? `шаг "${problem.step}": ${problem.message}` : problem.message,
                )
                throw new ResolvrError(
                    ErrorCodeEnum.INVALID_REFERENCE,
                    `Цепочка "${flow.id}" не сохранена: ${lines.join('; ')}`,
                    { workspaceId: args.workspaceId, flowId: flow.id, problems: lines },
                )
            }

            await context.workspaces.saveFlow(args.workspaceId, flow, {
                expectedVersion: args.expectedVersion,
            })

            return { saved: flow.id, name: flow.name, created: existing === undefined, steps: flow.steps.length }
        },
        summarize: (result) =>
            `${result.created ? 'Создана' : 'Обновлена'} цепочка «${result.name}»`,
    })

    register({
        name: 'flow_delete',
        title: 'Удалить флоу',
        description: 'Удаляет цепочку. Операции, на которые она ссылалась, остаются.',
        inputSchema: { workspaceId: z.string(), flowId: z.string() },
        run: async (args) => {
            await context.workspaces.getFlow(args.workspaceId, args.flowId)
            await context.workspaces.deleteFlow(args.workspaceId, args.flowId)

            return { deleted: args.flowId }
        },
        summarize: (result) => `удалена ${result.deleted}`,
    })

    register({
        name: 'flow_run',
        title: 'Запустить флоу',
        description:
            'Выполняет сценарий по шагам, пробрасывая извлечённые значения дальше и проверяя утверждения. Возвращает результат каждого шага. `variables` задают данные конкретного запуска — один сценарий так гоняется на разных клиентах.',
        inputSchema: {
            workspaceId: z.string(),
            flowId: z.string(),
            environmentId: z.string().optional(),
            variables: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                    'Значения для этого запуска: доступны шагам как {{имя}} и важнее констант цепочки. Так один сценарий проверяется на своих данных — например, {"clientId": "..."}',
                ),
            confirm: z
                .boolean()
                .optional()
                .describe(
                    'Подтверждение мутации в защищённом workspace (protection: confirm). Передавать только после явного согласия пользователя; при protection: readOnly не действует',
                ),
        },
        run: async (args) => {
            const result = await context.flows.run(args.workspaceId, args.flowId, {
                environmentId: args.environmentId,
                variables: args.variables,
                confirmed: args.confirm,
            })

            return {
                ok: result.ok,
                durationMs: result.durationMs,
                steps: result.steps.map((step) => ({
                    name: step.name,
                    ok: step.ok,
                    skipped: step.skipped,
                    status: step.status,
                    error: step.error,
                    // Ошибки ответа показываются и у зелёного шага: с
                    // `expect: any` ответ 200 с `errors` считается успешным.
                    errors: step.errors,
                    asserts: step.asserts.map((assertion) => assertion.message),
                })),
            }
        },
        isSuccessful: (result) => result.ok,
        summarize: (result) => {
            const failed = result.steps.find((step) => !step.ok && !step.skipped)

            return result.ok ? 'Цепочка пройдена' : failed ? `Ошибка на шаге «${failed.name}»` : 'Цепочка завершилась с ошибкой'
        },
    })

    register({
        name: 'flow_run_many',
        title: 'Запустить набор флоу',
        description:
            'Прогоняет набор цепочек одной командой: по префиксу идентификатора (smoke-billing-*), по метке или по явному списку. Возвращает итоговую таблицу — регресс вместо N отдельных вызовов. Упавшая цепочка не отменяет остальные.',
        inputSchema: {
            workspaceId: z.string(),
            prefix: z.string().optional().describe('Идентификаторы, начинающиеся так: smoke-billing-'),
            tag: z.string().optional().describe('Метка цепочки, например smoke или billing'),
            flowIds: z.array(z.string()).optional().describe('Явный список вместо отбора'),
            environmentId: z.string().optional(),
            variables: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Значения для всех цепочек набора: доступны шагам как {{имя}}'),
            parallel: z
                .boolean()
                .optional()
                .describe('Запускать одновременно (до 4 цепочек); по умолчанию — по одной'),
            confirm: z
                .boolean()
                .optional()
                .describe(
                    'Подтверждение мутаций в защищённом workspace (protection: confirm). Передавать только после явного согласия пользователя',
                ),
        },
        run: async (args) => {
            const flows = await context.workspaces.listFlows(args.workspaceId)
            const selected = args.flowIds
                ? args.flowIds.map((id) => ({ id }))
                : selectFlows(flows, args)

            if (selected.length === 0) {
                throw new ResolvrError(
                    ErrorCodeEnum.FLOW_NOT_FOUND,
                    'Ни одна цепочка не подошла под отбор: проверьте prefix, tag или flowIds',
                    { workspaceId: args.workspaceId, prefix: args.prefix, tag: args.tag },
                )
            }

            const results = await context.flows.runMany(
                args.workspaceId,
                selected.map((flow) => flow.id),
                {
                    environmentId: args.environmentId,
                    variables: args.variables,
                    confirmed: args.confirm,
                    parallel: args.parallel,
                },
            )

            return {
                total: results.length,
                failed: results.filter((run) => !run.ok).length,
                flows: results.map((run) => ({
                    flowId: run.flowId,
                    ok: run.ok,
                    durationMs: run.durationMs,
                    // У упавшей цепочки видно, где именно она встала: без этого
                    // пришлось бы перезапускать её отдельно, чтобы узнать шаг.
                    failedStep: run.steps.find((step) => !step.ok && !step.skipped)?.name,
                    error: run.error,
                })),
            }
        },
        isSuccessful: (result) => result.failed === 0,
        summarize: (result) =>
            result.failed === 0
                ? `${result.total} цепочек пройдено`
                : `${result.failed} из ${result.total} упали: ${result.flows
                      .filter((flow) => !flow.ok)
                      .map((flow) => flow.flowId)
                      .join(', ')}`,
    })
}

/** Отбор цепочек по префиксу идентификатора и метке; без условий — все. */
function selectFlows<T extends { id: string; tags: string[] }>(
    flows: T[],
    filter: { prefix?: string; tag?: string },
): T[] {
    return flows.filter(
        (flow) =>
            (filter.prefix === undefined || flow.id.startsWith(filter.prefix)) &&
            (filter.tag === undefined || flow.tags.includes(filter.tag)),
    )
}

function registerEnvironmentTools(register: IRegisterTool, context: INodeContext): void {
    register({
        name: 'env_list',
        title: 'Переменные окружения',
        description:
            'Показывает переменные окружения workspace. Значения секретов заменены маской — доступен только факт их наличия.',
        inputSchema: { workspaceId: z.string() },
        run: async (args) => {
            const workspace = await context.workspaces.getWorkspace(args.workspaceId)

            return workspace.environments.map((environment) => ({
                id: environment.id,
                name: environment.name,
                auth: environment.auth.type,
                variables: Object.fromEntries(
                    Object.entries(environment.variables).map(([key, value]) => [
                        key,
                        value.startsWith('keychain://') ? SECRET_MASK : value,
                    ]),
                ),
            }))
        },
        summarize: (result) => `${result.length} окружений`,
    })

    register({
        name: 'env_set',
        title: 'Задать переменную окружения',
        description:
            'Записывает переменную окружения. С `secret: true` значение уходит в macOS Keychain, а в файле остаётся только ссылка на него.',
        inputSchema: {
            workspaceId: z.string(),
            environmentId: z.string(),
            key: z.string(),
            value: z.string(),
            secret: z.boolean().optional(),
        },
        run: async (args) => {
            const workspace = await context.workspaces.getWorkspace(args.workspaceId)
            const environment = workspace.environments.find(
                (item) => item.id === args.environmentId,
            )

            if (!environment) throw new Error(`Окружение "${args.environmentId}" не найдено`)

            environment.variables[args.key] = args.secret
                ? await context.resolver.storeSecret(
                      workspace.id,
                      environment.id,
                      args.key,
                      args.value,
                  )
                : args.value

            await context.workspaces.saveWorkspace(workspace)

            return maskSecretsInJson({ updated: args.key, secret: args.secret === true }, [
                args.value,
            ])
        },
        summarize: (result) => `задана ${result.updated}${result.secret ? ' (секрет)' : ''}`,
    })
}

const ScriptTargetSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('operation'), ref: z.string().describe('Ссылка "collection/operation"') }),
    z.object({ kind: z.literal('environment'), environmentId: SlugSchema }),
])

const ScriptPatchSchema = z.object({
    preRequest: RequestScriptsSchema.shape.preRequest.nullable().describe('Код Pre-request или null для удаления'),
    postRequest: RequestScriptsSchema.shape.postRequest.nullable().describe('Код Post-request или null для удаления'),
}).refine((patch) => patch.preRequest !== undefined || patch.postRequest !== undefined, {
    message: 'Укажите preRequest или postRequest',
})

function parseScriptTarget(target: z.infer<typeof ScriptTargetSchema>): IRequestScriptTarget {
    return target.kind === 'operation' ? { kind: target.kind, ref: parseOperationRef(target.ref) } : target
}

function configuredScriptPhases(scripts: IRequestScripts): string[] {
    return [
        ...(scripts.preRequest !== undefined ? ['preRequest'] : []),
        ...(scripts.postRequest !== undefined ? ['postRequest'] : []),
    ]
}

function registerScriptTools(register: IRegisterTool, context: INodeContext): void {
    const scope = { workspaceId: SlugSchema, target: ScriptTargetSchema }
    register({
        name: 'scripts_get',
        title: 'Прочитать скрипты',
        description:
            'Читает Pre-request и Post-request сохранённой операции или окружения и возвращает version для scripts_set. Для длинного скрипта передайте phase, затем используйте nextOffset для чтения следующей части.',
        inputSchema: {
            ...scope,
            phase: z.enum(['preRequest', 'postRequest']).optional(),
            offset: z.number().int().nonnegative().optional().describe('Начало фрагмента выбранной фазы в единицах UTF-16'),
        },
        run: async (args) => {
            const { scripts, version } = await context.workspaces.getRequestScripts(
                args.workspaceId,
                parseScriptTarget(args.target),
            )
            const result = { target: args.target, version, configured: configuredScriptPhases(scripts) }
            if (args.phase) {
                const script = scripts[args.phase] ?? null
                const offset = args.offset ?? 0
                // Управляющий символ может занять до шести знаков при записи в JSON.
                const end = offset + 6_000

                return {
                    ...result, phase: args.phase, offset,
                    script: script?.slice(offset, end) ?? null,
                    nextOffset: script && script.length > end ? end : undefined,
                }
            }
            if (JSON.stringify(scripts).length > RESPONSE_LIMIT - 1_000) {
                return { ...result, hint: 'Для чтения длинного скрипта укажите phase и используйте nextOffset.' }
            }

            return { ...result, scripts }
        },
        summarize: (result) => result.configured.length > 0
            ? `Прочитаны скрипты (${result.configured.join(', ')})`
            : 'Скрипты не настроены',
    })

    register({
        name: 'scripts_set',
        title: 'Настроить скрипты',
        description:
            'Обновляет Pre-request и Post-request сохранённой операции или окружения. Строка заменяет указанную фазу, null удаляет её. Пропущенная фаза сохраняется. Код сохраняется без запуска. Для защиты от параллельной правки передайте expectedVersion из scripts_get.',
        inputSchema: {
            ...scope,
            scripts: ScriptPatchSchema,
            expectedVersion: z.string().optional().describe('Версия из scripts_get'),
        },
        run: async (args) => {
            const state = await context.workspaces.patchRequestScripts(
                args.workspaceId,
                parseScriptTarget(args.target),
                args.scripts,
                args.expectedVersion,
            )

            return {
                target: args.target,
                changed: state.changed,
                version: state.version,
                configured: configuredScriptPhases(state.scripts),
            }
        },
        summarize: (result) => {
            const name = result.target.kind === 'operation' ? result.target.ref : result.target.environmentId

            return result.changed ? `Обновлены скрипты «${name}»` : `Скрипты «${name}» уже совпадают`
        },
    })
}
