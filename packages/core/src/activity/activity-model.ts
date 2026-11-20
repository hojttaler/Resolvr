import { z } from 'zod'

/**
 * Журнал действий агента.
 *
 * Записи ведутся построчно (JSONL) и связываются по сессии MCP-сервера.
 * Каждый объявленный план начинает отдельную задачу внутри сессии. Такой
 * формат позволяет читать хвост журнала без разбора всего файла и не терять
 * ранее записанное при обрыве процесса.
 */

/** Начало сессии: кто подключился и что собирается делать. */
export const ActivitySessionRecordSchema = z.object({
    kind: z.literal('session'),
    sessionId: z.string(),
    startedAt: z.string(),
    client: z
        .object({
            name: z.string().default('unknown'),
            version: z.string().default(''),
        })
        .default({ name: 'unknown', version: '' }),
    libraryRoot: z.string().default(''),
})

/** План работы, объявленный агентом до начала действий. */
export const ActivityPlanRecordSchema = z.object({
    kind: z.literal('plan'),
    sessionId: z.string(),
    seq: z.number().int().nonnegative(),
    ts: z.string(),
    title: z.string().optional(),
    /** Что агент собирается проверить и зачем. */
    goal: z.string(),
    steps: z.array(z.string()).default([]),
})

/** Свободная заметка агента: вывод, наблюдение, итог этапа. */
export const ActivityNoteRecordSchema = z.object({
    kind: z.literal('note'),
    sessionId: z.string(),
    seq: z.number().int().nonnegative(),
    ts: z.string(),
    text: z.string(),
    /** Ссылка на шаг плана, к которому относится заметка. */
    step: z.number().int().nonnegative().optional(),
})

/** Начало вызова. Записывается до исполнения без аргументов и результатов. */
export const ActivityCallStartRecordSchema = z.object({
    kind: z.literal('call_started'),
    sessionId: z.string(),
    seq: z.number().int().nonnegative(),
    ts: z.string(),
    tool: z.string(),
    /** Зачем сделан вызов — заполняется агентом обязательно. */
    intent: z.string().default(''),
    /** Что агент ожидает получить; помогает понять, совпал ли результат. */
    expectation: z.string().optional(),
    /** Номер шага плана, к которому относится вызов. */
    step: z.number().int().nonnegative().optional(),
    workspaceId: z.string().optional(),
})

/** Один завершённый вызов инструмента с аргументами и результатом. */
export const ActivityCallRecordSchema = ActivityCallStartRecordSchema.extend({
    kind: z.literal('call'),
    /** Аргументы вызова с замаскированными секретами. */
    args: z.record(z.string(), z.unknown()).default({}),
    ok: z.boolean(),
    durationMs: z.number().nonnegative(),
    /** Короткая сводка для списка: статус, число записей, код ошибки. */
    summary: z.string().default(''),
    /** Полный результат вызова; при большом объёме усечён. */
    result: z.unknown().optional(),
    truncated: z.boolean().default(false),
    error: z.string().optional(),
})

export const ActivityRecordSchema = z.discriminatedUnion('kind', [
    ActivitySessionRecordSchema,
    ActivityPlanRecordSchema,
    ActivityNoteRecordSchema,
    ActivityCallStartRecordSchema,
    ActivityCallRecordSchema,
])

export type IActivitySessionRecord = z.infer<typeof ActivitySessionRecordSchema>
export type IActivityPlanRecord = z.infer<typeof ActivityPlanRecordSchema>
export type IActivityNoteRecord = z.infer<typeof ActivityNoteRecordSchema>
export type IActivityCallRecord = z.infer<typeof ActivityCallRecordSchema>
export type IActivityCallStartRecord = z.infer<typeof ActivityCallStartRecordSchema>
export type IActivityRecord = z.infer<typeof ActivityRecordSchema>
export type IActivityEntry = IActivityCallRecord | IActivityCallStartRecord | IActivityNoteRecord

/** Задача сессии и связанные с ней вызовы и заметки. */
export interface IActivityTask {
    id: string
    sessionId: string
    startedAt: string
    client: IActivitySessionRecord['client']
    plan?: IActivityPlanRecord
    /** Хронология задачи — вызовы и заметки в порядке начала. */
    entries: IActivityEntry[]
    /** Итоги для заголовка списка. */
    stats: IActivityTaskStats
}

export interface IActivityTaskStats {
    totalCalls: number
    failedCalls: number
    /** Суммарное время всех вызовов задачи. */
    durationMs: number
    lastActivityAt: string
}
