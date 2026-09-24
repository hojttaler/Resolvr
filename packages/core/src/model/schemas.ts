import { z } from 'zod'

/**
 * Схемы всех файловых форматов хранилища.
 *
 * Каждый JSON-файл на диске валидируется перед использованием: файл, испорченный
 * ручной правкой или прерванной записью, даёт понятную ошибку вместо падения UI.
 * Типы выводятся из схем, поэтому формат описан ровно в одном месте.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

export const SlugSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(SLUG_PATTERN, 'допустимы строчные латинские буквы, цифры, дефис и подчёркивание')

/** Заголовки хранятся как пары; значения допускают плейсхолдеры `{{var}}`. */
export const HeadersSchema = z.record(z.string(), z.string())

export const EndpointSchema = z.object({
    id: SlugSchema,
    name: z.string().min(1),
    url: z.string().url(),
    /** Отдельный URL для подписок; при отсутствии выводится из `url` заменой схемы на ws(s). */
    subscriptionUrl: z.string().url().optional(),
    headers: HeadersSchema.default({}),
    /** Только для локальных стендов с самоподписанным сертификатом. */
    acceptInvalidCerts: z.boolean().default(false),
})

export const AuthProfileSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({
        type: z.literal('bearer'),
        /** Имя переменной окружения, в которой лежит токен (обычно ссылка на Keychain). */
        tokenVariable: z.string().min(1),
        headerName: z.string().min(1).default('Authorization'),
        prefix: z.string().default('Bearer '),
    }),
    z.object({
        type: z.literal('login'),
        /** Операция логина: `collection/operation` внутри того же workspace. */
        operationRef: z.string().min(1),
        /** Путь к токену в ответе, например `data.login.accessToken`. */
        tokenPath: z.string().min(1),
        /** Имя переменной, куда положить добытый токен. */
        storeAs: z.string().min(1),
        headerName: z.string().min(1).default('Authorization'),
        prefix: z.string().default('Bearer '),
        /** Через сколько секунд считать токен протухшим и залогиниться заново. */
        ttlSeconds: z.number().int().positive().default(3300),
        /** Переменные для операции логина; секреты — ссылками `keychain://`. */
        variables: z.record(z.string(), z.unknown()).default({}),
    }),
])

/**
 * Восстановление после ошибки: цепочка, которая выполняется при совпадении
 * условия, после чего запрос повторяется.
 *
 * Типовой случай — протухший токен: вместо ручного перезапуска логина
 * приложение само выполняет цепочку авторизации и повторяет исходный запрос.
 */
export const RecoveryRuleSchema = z.object({
    /** Идентификатор цепочки, которая получает токен. */
    flowId: z.string().min(1),
    /**
     * Имя переменной, под которым сохраняется добытый токен.
     *
     * По умолчанию берётся из `extract` цепочки — то есть как поле названо
     * там, так и попадёт в окружение. Явное имя нужно, когда заголовок
     * ссылается на другое.
     */
    tokenVariable: z.string().optional(),
    /** Запускать цепочку заранее, до истечения токена. */
    onExpiry: z.boolean().default(true),
    /** Запускать цепочку в ответ на ошибку авторизации. */
    onError: z.boolean().default(true),
    /** За сколько секунд до истечения обновлять токен. */
    refreshMarginSec: z.number().int().min(0).max(3600).default(60),
    /** HTTP-статусы, при которых правило срабатывает. */
    statuses: z.array(z.number().int()).default([401, 403]),
    /** Подстроки в тексте ошибки GraphQL — сравнение регистронезависимое. */
    messagePatterns: z
        .array(z.string())
        .default([
            'unauthorized',
            'unauthenticated',
            'access denied',
            'token is not valid',
            'invalid token',
            'token expired',
            'jwt expired',
        ]),
    /** Сколько раз повторять запрос после восстановления. */
    maxAttempts: z.number().int().min(1).max(3).default(1),
    enabled: z.boolean().default(true),
})

export const EnvironmentSchema = z.object({
    id: SlugSchema,
    name: z.string().min(1),
    /**
     * Боевое окружение. Помечается в шапке, а мутации и цепочки на нём
     * требуют подтверждения: ⌘↩ не в том окружении — самый дорогой промах.
     */
    production: z.boolean().default(false),
    /**
     * Значения переменных. Секреты хранятся как `keychain://ws/env/key` и
     * раскрываются только в момент выполнения запроса.
     */
    variables: z.record(z.string(), z.string()).default({}),
    /** Заголовки, добавляемые ко всем запросам окружения. */
    headers: HeadersSchema.default({}),
    auth: AuthProfileSchema.default({ type: 'none' }),
    /** Цепочка восстановления после ошибки авторизации. */
    recovery: RecoveryRuleSchema.optional(),
    /**
     * Когда истекает токен окружения.
     *
     * Заполняется из `exp` полученного JWT. По нему токен обновляется заранее,
     * а не после отказа сервера — лишний круг «ошибка → логин → повтор» уходит.
     */
    tokenExpiresAt: z.string().optional(),
    /** Кому выдан текущий токен — показывается в интерфейсе. */
    tokenSubject: z.string().optional(),
})

export const LayoutPresetSchema = z.enum(['classic', 'inspector', 'focus'])

export const LayoutStateSchema = z.object({
    preset: LayoutPresetSchema.default('classic'),
    /**
     * Раскладка панелей: имя группы → размеры её панелей по идентификаторам.
     * Хранится отдельно для каждого пресета, чтобы переключение не сбрасывало
     * подогнанные вручную пропорции.
     */
    sizes: z.record(z.string(), z.record(z.string(), z.number())).default({}),
    sidebarCollapsed: z.boolean().default(false),
    sidebarTab: z.enum(['collections', 'schema', 'history', 'flows']).default('collections'),
})

export const WorkspaceSchema = z.object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().default(''),
    endpoints: z.array(EndpointSchema).default([]),
    environments: z.array(EnvironmentSchema).default([]),
    defaultEndpointId: z.string().optional(),
    defaultEnvironmentId: z.string().optional(),
    /**
     * Раскладка панелей — личное состояние, оно живёт в `.state/session.json`.
     * Поле оставлено для чтения файлов старых версий и при сохранении
     * отбрасывается: в общем репозитории команды оно давало бы конфликт на
     * каждом коммите.
     */
    layout: LayoutStateSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
})

export const CollectionSchema = z.object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().default(''),
    /** Порядок операций в сайдбаре; неизвестные файлы дописываются в конец. */
    order: z.array(z.string()).default([]),
    /** Заголовки, применяемые ко всем операциям коллекции. */
    headers: HeadersSchema.default({}),
})

export const OperationKindSchema = z.enum(['query', 'mutation', 'subscription'])

/**
 * Правило сохранения значения из ответа в переменную окружения.
 *
 * Применяется после каждого успешного запуска операции: токен или id из
 * ответа попадает в окружение без ручного копирования.
 */
export const EnvironmentCaptureSchema = z.object({
    /** Имя переменной окружения. */
    variable: z.string().min(1),
    /** Путь в результате: `data.login.token`, `headers.x-request-id`. */
    path: z.string().min(1),
    /** Хранить значение в хранилище секретов, в файле — только ссылка. */
    secret: z.boolean().default(false),
})

/** Метаданные операции; сам текст запроса лежит рядом в файле `.graphql`. */
export const OperationMetaSchema = z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    variables: z.record(z.string(), z.unknown()).default({}),
    headers: HeadersSchema.default({}),
    endpointId: z.string().optional(),
    environmentId: z.string().optional(),
    /**
     * Цепочка, выполняемая перед запросом. Её извлечённые значения становятся
     * переменными запроса, поэтому подготовку (логин, создание сущности) не
     * нужно повторять вручную перед каждым вызовом.
     */
    prerequisiteFlow: z.string().optional(),
    saveToEnvironment: z.array(EnvironmentCaptureSchema).default([]),
    updatedAt: z.string(),
})

export const FlowAssertSchema = z.object({
    /** Путь в результате шага: `status`, `data.user.id`, `errors`. */
    path: z.string().min(1),
    op: z.enum(['eq', 'ne', 'exists', 'notExists', 'contains', 'gt', 'lt']),
    value: z.unknown().optional(),
})

export const FlowStepExpectSchema = z.enum(['success', 'error', 'any'])

export const FlowStepSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Ссылка на сохранённую операцию `collection/operation`. */
    operationRef: z.string().optional(),
    /** Встроенный запрос, если шаг не ссылается на сохранённую операцию. */
    query: z.string().optional(),
    variables: z.record(z.string(), z.unknown()).default({}),
    endpointId: z.string().optional(),
    environmentId: z.string().optional(),
    /** `{ "token": "data.login.accessToken" }` — извлечённое доступно следующим шагам. */
    extract: z.record(z.string(), z.string()).default({}),
    assert: z.array(FlowAssertSchema).default([]),
    /**
     * Какой ответ шаг считает успешным.
     *
     * `success` — ответ без ошибок; `error` — сервер вернул ошибку (негативный
     * тест: «без токена — Unauthorized»); `any` — решают только проверки.
     * Во всех случаях должны пройти и проверки шага.
     */
    expect: FlowStepExpectSchema.default('success'),
    /** Продолжать выполнение флоу, даже если шаг упал. */
    continueOnFailure: z.boolean().default(false),
})

export const FlowSchema = z.object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().default(''),
    environmentId: z.string().optional(),
    endpointId: z.string().optional(),
    steps: z.array(FlowStepSchema).default([]),
})

export const HistoryEntrySchema = z.object({
    id: z.string(),
    ts: z.string(),
    workspaceId: z.string(),
    endpointId: z.string(),
    environmentId: z.string().optional(),
    operationName: z.string().optional(),
    kind: OperationKindSchema,
    query: z.string(),
    /** Переменные с замаскированными секретами. */
    variables: z.record(z.string(), z.unknown()).default({}),
    status: z.number().int(),
    ok: z.boolean(),
    durationMs: z.number(),
    errorCount: z.number().int().default(0),
    responseBytes: z.number().int().default(0),
    /** Начало тела ответа для превью в списке истории. */
    responsePreview: z.string().default(''),
    /** Сохранённая операция, если запуск был из коллекции. */
    operationRef: z.string().optional(),
    statusText: z.string().optional(),
    /**
     * Тело ответа с замаскированными секретами — чтобы открыть запуск из
     * истории вместе с ответом. Хранится до лимита; больше — только превью.
     */
    responseBody: z.string().optional(),
    responseTruncated: z.boolean().default(false),
    responseHeaders: z.record(z.string(), z.string()).default({}),
    requestHeaders: z.record(z.string(), z.string()).default({}),
})

/** Больше этого тело ответа в историю не пишется целиком. */
export const HISTORY_BODY_LIMIT = 512 * 1024

export const TabCursorSchema = z.object({
    anchor: z.number().int().nonnegative().default(0),
    head: z.number().int().nonnegative().default(0),
    scrollTop: z.number().nonnegative().default(0),
})

export const TabKindSchema = z.enum(['operation', 'flow', 'report', 'schema'])

export const TabStateSchema = z.object({
    id: z.string().min(1),
    /**
     * Что открыто во вкладке: запрос, редактор цепочки или отчёт о прогоне.
     * Вкладки одного workspace показываются вместе; при переключении
     * workspace набор вкладок меняется целиком.
     */
    kind: TabKindSchema.default('operation'),
    workspaceId: z.string().optional(),
    title: z.string().default('Untitled'),
    /** Ссылка `collection/operation`; отсутствует у несохранённого черновика. */
    operationRef: z.string().optional(),
    /** Идентификатор цепочки для вкладки-редактора; отсутствует у новой. */
    flowId: z.string().optional(),
    /** Открытый тип для вкладки-браузера схемы. */
    schemaType: z.string().optional(),
    /**
     * Устаревшие поля: окружение и эндпоинт выбираются на весь workspace
     * (`SessionSchema.selections`). Читаются только при миграции старой сессии.
     */
    endpointId: z.string().optional(),
    environmentId: z.string().optional(),
    /** Черновик отличается от сохранённой операции — показывается точкой на вкладке. */
    dirty: z.boolean().default(false),
    pinned: z.boolean().default(false),
    queryCursor: TabCursorSchema.default({ anchor: 0, head: 0, scrollTop: 0 }),
    variablesCursor: TabCursorSchema.default({ anchor: 0, head: 0, scrollTop: 0 }),
    bottomTab: z.enum(['variables', 'headers', 'captures']).default('variables'),
    responseTab: z.enum(['response', 'raw', 'headers', 'trace']).default('response'),
})

/** Окружение и эндпоинт, выбранные в workspace; без значения — умолчания workspace. */
export const WorkspaceSelectionSchema = z.object({
    environmentId: z.string().optional(),
    endpointId: z.string().optional(),
})

export const SessionSchema = z.object({
    version: z.literal(1).default(1),
    workspaceId: z.string().optional(),
    activeTabId: z.string().optional(),
    tabs: z.array(TabStateSchema).default([]),
    /** Активная вкладка каждого workspace — восстанавливается при переключении. */
    activeTabs: z.record(z.string(), z.string()).default({}),
    /** Раскладка панелей по workspace: личное, не попадает в общие файлы. */
    layouts: z.record(z.string(), LayoutStateSchema).default({}),
    /**
     * Выбранные окружение и эндпоинт по workspace. Выбор общий для всех
     * вкладок: две вкладки не должны незаметно ходить в разные окружения.
     */
    selections: z.record(z.string(), WorkspaceSelectionSchema).default({}),
    updatedAt: z.string().default(() => new Date().toISOString()),
})

/** Содержимое черновика вкладки, не привязанного к сохранённой операции. */
export const DraftDataSchema = z.object({
    variables: z.string().default('{}'),
    headers: HeadersSchema.default({}),
})

/** Материал нативного размытия окна; `none` отключает эффект полностью. */
export const WindowMaterialSchema = z.enum([
    'hud',
    'sidebar',
    'under-window',
    'popover',
    'window',
    'none',
])

export const SecretStorageSchema = z.enum(['file', 'keychain'])
export type ISecretStorage = z.infer<typeof SecretStorageSchema>

export const LanguageSchema = z.enum(['system', 'en', 'ru'])
export type ILanguage = z.infer<typeof LanguageSchema>

export const SettingsSchema = z.object({
    version: z.literal(1).default(1),
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    /** Язык интерфейса; `system` — по языку системы, иначе английский. */
    language: LanguageSchema.default('system'),
    lastWorkspaceId: z.string().optional(),
    appearance: z
        .object({
            material: WindowMaterialSchema.default('hud'),
            /**
             * Плотность фона поверх размытия, в процентах: 0 — только нативный
             * материал, 100 — полностью непрозрачное окно. По умолчанию окно
             * плотное: прозрачность — осознанный выбор, а не сюрприз при
             * первом запуске. Действует только на macOS.
             */
            opacity: z.number().int().min(0).max(100).default(100),
        })
        .default({ material: 'hud', opacity: 100 }),
    editor: z
        .object({
            fontSize: z.number().int().min(9).max(24).default(13),
            tabSize: z.number().int().min(2).max(8).default(2),
            /** Глубина обхода схемы при автозаполнении selection set. */
            autofillDepth: z.number().int().min(1).max(6).default(3),
            lineNumbers: z.boolean().default(true),
            /** Переносить длинные строки вместо горизонтальной прокрутки. */
            lineWrapping: z.boolean().default(true),
        })
        .default({
            fontSize: 13,
            tabSize: 2,
            autofillDepth: 3,
            lineNumbers: true,
            lineWrapping: true,
        }),
    response: z
        .object({
            /** На сколько уровней разворачивать дерево ответа сразу. */
            expandDepth: z.number().int().min(1).max(8).default(3),
        })
        .default({ expandDepth: 3 }),
    request: z
        .object({
            timeoutMs: z.number().int().min(1000).max(600_000).default(30_000),
        })
        .default({ timeoutMs: 30_000 }),
    history: z
        .object({
            /** Сколько дней хранить файлы истории. */
            retentionDays: z.number().int().min(1).max(365).default(30),
        })
        .default({ retentionDays: 30 }),
    secrets: z
        .object({
            /**
             * Где лежат токены и прочие секреты.
             *
             * `file` — в `.secrets/` библиотеки, доступ только владельцу, без
             * запросов пароля; `keychain` — в macOS Keychain, где каждая
             * пересборка приложения с ad-hoc подписью заново требует пароль.
             */
            storage: SecretStorageSchema.default('file'),
        })
        .default({ storage: 'file' }),
})

/** Снимок схемы GraphQL с метаданными кэша. */
export const SchemaCacheSchema = z.object({
    version: z.literal(1).default(1),
    endpointId: z.string(),
    fetchedAt: z.string(),
    /** SHA-256 от SDL — быстрый способ понять, менялась ли схема. */
    hash: z.string(),
    sdl: z.string(),
})

export type IEndpoint = z.infer<typeof EndpointSchema>
export type IAuthProfile = z.infer<typeof AuthProfileSchema>
export type IEnvironment = z.infer<typeof EnvironmentSchema>
export type IRecoveryRule = z.infer<typeof RecoveryRuleSchema>
export type ILayoutPreset = z.infer<typeof LayoutPresetSchema>
export type ILayoutState = z.infer<typeof LayoutStateSchema>
export type IWorkspace = z.infer<typeof WorkspaceSchema>
export type ICollection = z.infer<typeof CollectionSchema>
export type IOperationKind = z.infer<typeof OperationKindSchema>
export type IOperationMeta = z.infer<typeof OperationMetaSchema>
export type IEnvironmentCapture = z.infer<typeof EnvironmentCaptureSchema>
export type IFlowAssert = z.infer<typeof FlowAssertSchema>
export type IFlowStep = z.infer<typeof FlowStepSchema>
export type IFlowStepExpect = z.infer<typeof FlowStepExpectSchema>
export type IFlow = z.infer<typeof FlowSchema>
export type IHistoryEntry = z.infer<typeof HistoryEntrySchema>
export type ITabKind = z.infer<typeof TabKindSchema>
export type ITabCursor = z.infer<typeof TabCursorSchema>
export type ITabState = z.infer<typeof TabStateSchema>
export type ISession = z.infer<typeof SessionSchema>
export type IWorkspaceSelection = z.infer<typeof WorkspaceSelectionSchema>
export type IDraftData = z.infer<typeof DraftDataSchema>
export type ISettings = z.infer<typeof SettingsSchema>
export type IWindowMaterial = z.infer<typeof WindowMaterialSchema>
export type ISchemaCache = z.infer<typeof SchemaCacheSchema>

/** Операция целиком: метаданные из `.meta.json` плюс текст запроса из `.graphql`. */
export interface IOperation extends IOperationMeta {
    collectionId: string
    query: string
    kind: IOperationKind
}
