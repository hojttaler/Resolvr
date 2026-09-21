/**
 * Коды доменных ошибок ядра. UI и MCP-сервер различают ситуации по коду,
 * а не по тексту сообщения.
 */
export enum ErrorCodeEnum {
    WORKSPACE_NOT_FOUND = 'WORKSPACE_NOT_FOUND',
    WORKSPACE_ALREADY_EXISTS = 'WORKSPACE_ALREADY_EXISTS',
    COLLECTION_NOT_FOUND = 'COLLECTION_NOT_FOUND',
    COLLECTION_ALREADY_EXISTS = 'COLLECTION_ALREADY_EXISTS',
    OPERATION_NOT_FOUND = 'OPERATION_NOT_FOUND',
    OPERATION_ALREADY_EXISTS = 'OPERATION_ALREADY_EXISTS',
    FLOW_NOT_FOUND = 'FLOW_NOT_FOUND',
    ENDPOINT_NOT_FOUND = 'ENDPOINT_NOT_FOUND',
    ENVIRONMENT_NOT_FOUND = 'ENVIRONMENT_NOT_FOUND',
    SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',
    INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
    INVALID_REFERENCE = 'INVALID_REFERENCE',
    INVALID_OPERATION = 'INVALID_OPERATION',
    SCHEMA_UNAVAILABLE = 'SCHEMA_UNAVAILABLE',
    TRANSPORT_FAILED = 'TRANSPORT_FAILED',
    FLOW_STEP_FAILED = 'FLOW_STEP_FAILED',
    AUTH_FAILED = 'AUTH_FAILED',
}

export class ResolvrError extends Error {
    public readonly code: ErrorCodeEnum
    public readonly details: Record<string, unknown>

    constructor(code: ErrorCodeEnum, message: string, details: Record<string, unknown> = {}) {
        super(message)
        this.name = 'ResolvrError'
        this.code = code
        this.details = details
    }
}

export function isResolvrError(error: unknown): error is ResolvrError {
    return error instanceof ResolvrError
}

/** Приводит произвольное значение из `catch` к читаемому сообщению. */
export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error

    return JSON.stringify(error)
}
