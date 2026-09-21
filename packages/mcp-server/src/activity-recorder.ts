import {
    ActivityPlanRecordSchema,
    ActivityStore,
    buildCallRecord,
    buildNoteRecord,
    isResolvrError,
    toErrorMessage,
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

    public async recordPlan(goal: string, steps: string[]): Promise<void> {
        await this._store.append(
            ActivityPlanRecordSchema.parse({
                kind: 'plan',
                sessionId: this._sessionId,
                seq: this._nextSeq(),
                ts: new Date().toISOString(),
                goal,
                steps,
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
        summarize: (result: T) => string,
    ): Promise<T> {
        const startedAt = performance.now()
        const seq = this._nextSeq()

        try {
            const result = await execute()

            await this._store.append(
                buildCallRecord({
                    sessionId: this._sessionId,
                    seq,
                    tool,
                    intent: narration.intent,
                    expectation: narration.expectation,
                    step: narration.step,
                    args,
                    ok: true,
                    durationMs: performance.now() - startedAt,
                    summary: summarize(result),
                    result,
                    workspaceId: typeof args.workspaceId === 'string' ? args.workspaceId : undefined,
                }),
            )

            return result
        } catch (error) {
            const code = isResolvrError(error) ? error.code : 'UNEXPECTED'

            await this._store.append(
                buildCallRecord({
                    sessionId: this._sessionId,
                    seq,
                    tool,
                    intent: narration.intent,
                    expectation: narration.expectation,
                    step: narration.step,
                    args,
                    ok: false,
                    durationMs: performance.now() - startedAt,
                    summary: `ошибка: ${code}`,
                    error: toErrorMessage(error),
                    workspaceId: typeof args.workspaceId === 'string' ? args.workspaceId : undefined,
                }),
            )

            throw error
        }
    }

    private _nextSeq(): number {
        this._seq += 1

        return this._seq
    }
}

/** Отделяет поля повествования от аргументов самого инструмента. */
export function splitNarration<T extends Record<string, unknown>>(
    args: T,
): { narration: INarration; rest: Omit<T, 'intent' | 'expectation' | 'step'> } {
    const { intent, expectation, step, ...rest } = args as T & INarration

    return { narration: { intent: intent ?? '', expectation, step }, rest }
}
