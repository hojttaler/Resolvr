import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { validateVariables } from './validate-variables.js'

const schema = buildSchema(`
    enum Device { EMAIL SMS }

    input Captcha { clientToken: String! }

    input ProductFilter {
        service: String!
        identity: String!
        device: Device!
        captcha: Captcha
        attempts: Int
    }

    type Result { sessionId: ID! }

    type Query {
        signIn(input: ProductFilter!, tags: [String!]): Result!
    }
`)

const QUERY = 'query Send($input: ProductFilter!, $tags: [String!]) { signIn(input: $input, tags: $tags) { sessionId } }'

describe('validateVariables', () => {
    it('не находит проблем в корректных переменных', () => {
        const problems = validateVariables(
            QUERY,
            { input: { service: 'EXAMPLE', identity: 'a@b.c', device: 'EMAIL' } },
            schema,
        )

        expect(problems).toEqual([])
    })

    it('сообщает о незаполненной обязательной переменной', () => {
        const problems = validateVariables(QUERY, {}, schema)

        expect(problems).toEqual([
            {
                path: 'input',
                message: 'обязательная переменная не заполнена (ProductFilter!)',
                severity: 'error',
            },
        ])
    })

    it('находит незаполненное обязательное поле внутри объекта', () => {
        const problems = validateVariables(
            QUERY,
            { input: { service: 'EXAMPLE', device: 'EMAIL' } },
            schema,
        )

        expect(problems[0]).toMatchObject({ path: 'input.identity', severity: 'error' })
    })

    it('ловит неверное значение enum', () => {
        const problems = validateVariables(
            QUERY,
            { input: { service: 'X', identity: 'a@b.c', device: 'PIGEON' } },
            schema,
        )

        expect(problems[0]?.message).toContain('недопустимое значение enum Device')
    })

    it('ловит неверный тип скаляра', () => {
        const problems = validateVariables(
            QUERY,
            { input: { service: 'X', identity: 'a@b.c', device: 'SMS', attempts: 'три' } },
            schema,
        )

        expect(problems[0]).toMatchObject({ path: 'input.attempts', severity: 'error' })
        expect(problems[0]?.message).toContain('целое число')
    })

    it('проверяет элементы списка', () => {
        const problems = validateVariables(
            QUERY,
            { input: { service: 'X', identity: 'a@b.c', device: 'SMS' }, tags: ['ok', 7] },
            schema,
        )

        expect(problems[0]).toMatchObject({ path: 'tags.1', severity: 'error' })
    })

    it('предупреждает о лишних полях и переменных, но не считает их ошибкой', () => {
        const problems = validateVariables(
            QUERY,
            {
                input: { service: 'X', identity: 'a@b.c', device: 'SMS', unknown: 1 },
                extra: 'value',
            },
            schema,
        )

        expect(problems.every((problem) => problem.severity === 'warning')).toBe(true)
        expect(problems.map((problem) => problem.path).sort()).toEqual(['extra', 'input.unknown'])
    })

    it('молчит на незавершённом запросе — его проверяет редактор', () => {
        expect(validateVariables('query Send($input: ', {}, schema)).toEqual([])
    })

    it('без схемы проверяет только обязательность верхнего уровня', () => {
        const problems = validateVariables(QUERY, {}, undefined)

        expect(problems).toHaveLength(1)
        expect(problems[0]?.path).toBe('input')
    })
})
