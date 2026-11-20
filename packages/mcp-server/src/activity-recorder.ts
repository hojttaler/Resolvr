import {
    ActivityPlanRecordSchema,
    ActivityStore,
    buildCallRecord,
    buildNoteRecord,
    HeadersSchema,
    isResolvrError,
    maskHeaders,
    SECRET_MASK,
    toErrorMessage,
    type IActivityRecord,
} from '@resolvr/core'
import type { INodeContext } from '@resolvr/core/node'
import { z } from 'zod'

/** Поля, которые агент обязан заполнять при каждом вызове. */
export const NARRATION_SHAPE = {
    intent: z
        .string()
        .min(3)
        .describe(
            'Обязательно. Одной фразой: что делает этот вызов и зачем — например «проверяю, что логин выдаёт токен». Текст показывается пользователю в журнале действий.',
        ),
    expectation: z
        .string()
        .optional()
        .describe('Что ожидается в результате: так видно, совпал ли итог с гипотезой.'),
    step: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Номер шага из плана (plan), к которому относится вызов.'),
}

export interface INarration {
    intent: string
    expectation?: string
    step?: number
}

/**
 * Запись цепочки действий агента.
 *
 * Каждый вызов инструмента попадает в журнал вместе с намерением, аргументами,
 * результатом и длительностью, а вызовы одного запуска сервера объединяются в
 * сессию. Пользователь видит не только итог тестирования, но и ход рассуждения:
 * что агент собирался проверить, что получил и что делал дальше.
 */
export class ActivityRecorder {
    private readonly _store: ActivityStore
    private readonly _sessionId: string
    private _seq = 0

    constructor(context: INodeContext, sessionId: string) {
        this._store = new ActivityStore(context.fs, context.paths)
        this._sessionId = sessionId
    }

    public get sessionId(): string {
        return this._sessionId
    }

    public async startSession(client: { name: string; version: string }, libraryRoot: string): Promise<void> {
        await this._store.append({
            kind: 'session',
            sessionId: this._sessionId,
            startedAt: new Date().toISOString(),
            client,
            libraryRoot,
        })
    }

    /** Объявляет новую задачу в журнале текущего подключения. */
    public async recordPlan(goal: string, steps: string[], title?: string): Promise<void> {
        await this._store.append(
            ActivityPlanRecordSchema.parse({
                kind: 'plan',
                sessionId: this._sessionId,
                seq: this._nextSeq(),
                ts: new Date().toISOString(),
                goal,
                steps,
                title,
            }),
        )
    }

    public async recordNote(text: string, step?: number): Promise<void> {
        await this._store.append(
            buildNoteRecord({ sessionId: this._sessionId, seq: this._nextSeq(), text, step }),
        )
    }

    /**
     * Выполняет вызов инструмента и записывает его в журнал.
     *
     * Ошибка записывается так же, как успех, и пробрасывается дальше: неудачные
     * попытки — часть цепочки рассуждения и без них картина неполна.
     */
    public async record<T>(
        tool: string,
        narration: INarration,
        args: Record<string, unknown>,
        execute: () => Promise<T>,
        outcome: (result: T) => { ok: boolean; summary: string },
    ): Promise<T> {
        const call = {
            sessionId: this._sessionId,
            seq: this._nextSeq(),
            tool,
            ...narration,
            workspaceId: typeof args.workspaceId === 'string' ? args.workspaceId : undefined,
        }
        const loggedArgs = redactCallArgs(tool, args)
        await this._appendCall({ kind: 'call_started', ...call, ts: new Date().toISOString() })
        const startedAt = performance.now()

        try {
            const result = await execute()

            await this._appendCall(
                buildCallRecord({
                    ...call,
                    ...outcome(result),
                    args: loggedArgs,
                    durationMs: performance.now() - startedAt,
                    result: redactCallPayload(tool, result),
                }),
            )

            return result
        } catch (error) {
            const code = isResolvrError(error) ? error.code : 'UNEXPECTED'

            await this._appendCall(
                buildCallRecord({
                    ...call,
                    args: loggedArgs,
                    ok: false,
                    durationMs: performance.now() - startedAt,
                    summary: `ошибка: ${code}`,
                    error: toErrorMessage(error),
                }),
            )

            throw error
        }
    }

    private async _appendCall(record: IActivityRecord): Promise<void> {
        try {
            await this._store.append(record)
        } catch {
            process.stderr.write('Resolvr MCP: не удалось записать вызов в журнал действий.\n')
        }
    }

    private _nextSeq(): number {
        this._seq += 1

        return this._seq
    }
}

function redactCallArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
    return redactCallPayload(tool, args.secret === true && typeof args.value === 'string'
        ? { ...args, value: SECRET_MASK }
        : args)
}

function redactCallPayload<T>(tool: string, value: T): T {
    if (typeof value !== 'object' || value === null) return value

    const headers = 'headers' in value ? HeadersSchema.safeParse(value.headers) : undefined
    const scripts = 'scripts' in value && value.scripts && typeof value.scripts === 'object'
        ? value.scripts : undefined
    const hasScriptPage = tool === 'scripts_get' && 'script' in value && typeof value.script === 'string'
    if (!headers?.success && !scripts && !hasScriptPage) return value

    return {
        ...value,
        ...(headers?.success && { headers: maskHeaders(headers.data, []) }),
        ...(scripts && {
            scripts: Object.fromEntries(Object.entries(scripts).map(([phase, code]) => [
                phase, typeof code === 'string' ? SECRET_MASK : code,
            ])),
        }),
        ...(hasScriptPage && { script: SECRET_MASK }),
    }
}

/** Отделяет поля повествования от аргументов самого инструмента. */
export function splitNarration<T extends Record<string, unknown>>(
    args: T,
): { narration: INarration; rest: Omit<T, 'intent' | 'expectation' | 'step'> } {
    const { intent, expectation, step, ...rest } = args as T & INarration

    return { narration: { intent: intent ?? '', expectation, step }, rest }
}
