import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Конфигурация линтера.
 *
 * Проверяются только правила, которые не дублируют компилятор: типовые ошибки
 * ловит `tsc`, поэтому здесь остаются запреты, за которыми TypeScript не следит
 * сам — прежде всего `any` и незакрытые промисы.
 */
export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/target/**',
            '**/node_modules/**',
            'apps/desktop/src-tauri/**',
            // Вспомогательные скрипты на чистом JS вне tsconfig проектов.
            '**/scripts/**/*.mjs',
            'eslint.config.js',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            /*
             * Порты объявлены методами (`readText(path): Promise<…>`), а не полями
             * с функциональным типом: так интерфейс читается как контракт класса.
             * Методы всегда вызываются на экземпляре и никогда не передаются
             * отдельно, поэтому предупреждение о потере `this` здесь ложное.
             */
            '@typescript-eslint/unbound-method': 'off',

            /*
             * Реализация асинхронного интерфейса обязана оставаться `async`, даже
             * когда конкретная реализация синхронна — например, файловая система
             * в памяти в тестах.
             */
            '@typescript-eslint/require-await': 'off',

            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/explicit-function-return-type': [
                'warn',
                { allowExpressions: true, allowTypedFunctionExpressions: true },
            ],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
        },
    },
    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            // В тестах возвращаемые типы выводятся из фикстур и только шумят.
            '@typescript-eslint/explicit-function-return-type': 'off',
        },
    },
)
