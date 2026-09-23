import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import {
    createEnvCompletion,
    findUnknownPlaceholders,
    type IEnvVariablesContext,
} from './env-completion.js'

const CONTEXT: IEnvVariablesContext = {
    environmentName: 'staging',
    variables: [
        { name: 'userId', secret: false, value: 'u-42', source: 'environment' },
        { name: 'token', secret: true, source: 'environment' },
    ],
}

/** Подсказки в позиции `|` документа. */
function complete(doc: string) {
    const pos = doc.indexOf('|')
    const state = EditorState.create({ doc: doc.replace('|', '') })

    return createEnvCompletion(() => CONTEXT)(new CompletionContext(state, pos, false))
}

describe('createEnvCompletion', () => {
    it('предлагает переменные окружения после {{ и дописывает закрывающие скобки', () => {
        const result = complete('{ "id": "{{us|" }')

        expect(result?.options.map((option) => option.label)).toEqual(['userId', 'token'])
        expect(result?.options[0]?.apply).toBe('userId}}')
        expect(result?.options[0]?.detail).toBe('u-42')
        expect(result?.options[1]?.detail).toBe('••••')
        expect(result?.from).toBe('{ "id": "{{'.length)
    })

    it('не дублирует закрывающие скобки, если они уже есть', () => {
        const result = complete('{ "id": "{{|}}" }')

        expect(result?.options[0]?.apply).toBe('userId')
    })

    it('молчит вне {{', () => {
        expect(complete('{ "id": "us|" }')).toBeNull()
    })
})

describe('findUnknownPlaceholders', () => {
    it('находит имена, которых нет в окружении', () => {
        expect(
            findUnknownPlaceholders('Bearer {{token}} {{ missing }} {{missing}}', CONTEXT.variables),
        ).toEqual(['missing'])
    })
})
