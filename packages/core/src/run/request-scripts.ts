import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import { z } from 'zod'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import type { IRequestScripts } from '../model/schemas.js'
import { maskSecrets } from '../secrets/secret-resolver.js'
import {
    installSigningModule,
    REQUEST_SCRIPT_CRYPTO_MODULE,
    splitScriptImports,
    type IRequestScriptSigningKeys,
} from './request-script-modules.js'

const SCRIPT_TIMEOUT_MS = 150
const SCRIPT_MEMORY_BYTES = 16 * 1024 * 1024
const SCRIPT_DATA_LIMIT = 2 * 1024 * 1024
const MAX_ERROR_LENGTH = 500

const RequestDataSchema = z.object({
    variables: z.record(z.string(), z.unknown()),
    headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~\w-]+$/), z.string().regex(/^[^\r\n\0]*$/)),
})

type IRequestData = z.infer<typeof RequestDataSchema>
type IScriptPhase = keyof IRequestScripts

let modulePromise: Promise<QuickJSWASMModule> | undefined

function scriptModule(): Promise<QuickJSWASMModule> {
    modulePromise ??= import('#request-script-variant')
        .then(({ default: variant }) => newQuickJSWASMModuleFromVariant(variant))
        .catch((error: unknown) => {
            modulePromise = undefined
            throw error
        })

    return modulePromise
}

/** Применяет скрипты окружения и запроса к переменным и заголовкам до подстановки секретов. */
export async function applyPreRequestScripts(
    scopes: readonly (IRequestScripts | undefined)[],
    request: IRequestData,
    loadSigningKeys: () => Promise<IRequestScriptSigningKeys>,
): Promise<IRequestData> {
    let next = request
    for (const script of scopes) {
        if (!script?.preRequest?.trim()) continue

        const result = await evaluate('preRequest', script.preRequest, { request: next }, { loadSigningKeys })
        const parsed = RequestDataSchema.safeParse(result)
        if (!parsed.success) {
            throw scriptError('preRequest', 'request.variables и request.headers должны быть объектами')
        }

        next = parsed.data
    }

    return next
}

/** Проверяет полученный ответ скриптами запроса и окружения. */
export async function applyPostRequestScripts(
    scopes: readonly (IRequestScripts | undefined)[],
    response: unknown,
    secrets: readonly string[],
): Promise<void> {
    for (const script of scopes) {
        if (!script?.postRequest?.trim()) continue
        await evaluate('postRequest', script.postRequest, { response }, { secrets })
    }
}

async function evaluate(
    phase: IScriptPhase,
    code: string,
    input: { request: IRequestData } | { response: unknown },
    options: {
        secrets?: readonly string[]
        loadSigningKeys?: () => Promise<IRequestScriptSigningKeys>
    },
): Promise<unknown> {
    const data = JSON.stringify(input)
    if (data.length > SCRIPT_DATA_LIMIT) throw scriptError(phase, 'превышен лимит входных данных')

    const { imports, body, modules } = splitScriptImports(code)
    if (modules.some((name) => name !== REQUEST_SCRIPT_CRYPTO_MODULE.name)) {
        throw scriptError(phase, 'доступны только встроенные модули Resolvr')
    }
    if (imports.length > 0 && !options.loadSigningKeys) {
        throw scriptError(phase, `${REQUEST_SCRIPT_CRYPTO_MODULE.name} доступен в Pre-request`)
    }
    const signing = imports.length > 0 ? await options.loadSigningKeys?.() : undefined

    const module = await scriptModule().catch(() => {
        throw scriptError(phase, 'не удалось загрузить JavaScript')
    })
    const runtime = module.newRuntime()
    try {
        runtime.setMemoryLimit(SCRIPT_MEMORY_BYTES)
        runtime.setMaxStackSize(256 * 1024)
        const context = runtime.newContext()
        try {
            const deadline = performance.now() + SCRIPT_TIMEOUT_MS
            runtime.setInterruptHandler(() => performance.now() >= deadline)
            if (signing) installSigningModule(context, signing.keys, SCRIPT_DATA_LIMIT, deadline)
            const result = context.evalCode(
                `${signing ? `${imports.join('\n')}\nexport default ` : ''}(() => {
                    "use strict";
                    const { request, response } = JSON.parse(${JSON.stringify(data)});
                    const serialize = JSON.stringify;
                    const assert = (condition, message = "Проверка не прошла") => {
                        if (!condition) throw new Error(message);
                    };
                    try {
                        (() => {
                            ${body}
                        })();
                        return serialize({ value: request });
                    } catch (error) {
                        return serialize({
                            error: typeof error === "string" ? error
                                : typeof error?.message === "string" ? error.message : "Ошибка JavaScript",
                        });
                    }
                })()`,
                `${phase}.js`,
                { type: signing ? 'module' : 'global' },
            )
            const handle = result.error ?? result.value
            try {
                if (performance.now() >= deadline) throw scriptError(phase, 'превышен лимит времени')
                if (result.error) {
                    throw scriptError(phase, 'не удалось выполнить JavaScript')
                }
                if (runtime.hasPendingJob()) throw scriptError(phase, 'ожидается синхронный скрипт')
                const value = signing && context.typeof(handle) === 'object'
                    ? context.getProp(handle, 'default') : handle
                let output: string
                try {
                    if (context.typeof(value) !== 'string') {
                        throw scriptError(phase, 'не удалось выполнить JavaScript')
                    }
                    output = context.getString(value)
                } finally {
                    if (value !== handle) value.dispose()
                }
                if (output.length > SCRIPT_DATA_LIMIT) {
                    throw scriptError(phase, 'превышен лимит выходных данных')
                }
                const parsed: unknown = JSON.parse(output)
                if (!parsed || typeof parsed !== 'object') throw scriptError(phase, 'некорректный результат')
                if ('error' in parsed && typeof parsed.error === 'string') {
                    const secrets = signing?.secretValues ?? options.secrets ?? []
                    throw scriptError(phase, maskSecrets(parsed.error, secrets).slice(0, MAX_ERROR_LENGTH))
                }

                return 'value' in parsed ? parsed.value : undefined
            } finally {
                handle.dispose()
            }
        } finally {
            context.dispose()
        }
    } catch (error) {
        if (error instanceof ResolvrError) throw error
        throw scriptError(phase, 'не удалось выполнить JavaScript')
    } finally {
        runtime.dispose()
    }
}

function scriptError(phase: IScriptPhase, message: string): ResolvrError {
    return new ResolvrError(
        ErrorCodeEnum.REQUEST_SCRIPT_FAILED,
        `${phase === 'preRequest' ? 'Pre-request' : 'Post-request'}: ${message}`,
        { phase },
    )
}
