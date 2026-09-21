import { createServer } from 'node:http'

import { createPubSub, createSchema, createYoga } from 'graphql-yoga'

/**
 * Тестовый GraphQL-сервер.
 *
 * Нужен для проверки приложения без внешних зависимостей: содержит запросы,
 * мутации, подписку, вложенные и рекурсивные типы, обязательные аргументы и
 * операцию логина — то есть всё, на чём проверяются автозаполнение выборки,
 * auth-профили, флоу и подписки.
 */
const PORT = Number(process.env.PORT ?? 4000)
const VALID_PASSWORD = 'secret'

interface IUser {
    id: string
    email: string
    role: 'ADMIN' | 'USER'
    createdAt: string
    address: { city: string; street: string }
    friendIds: string[]
}

const users: IUser[] = [
    {
        id: 'u1',
        email: 'ada@example.com',
        role: 'ADMIN',
        createdAt: '2026-01-15T10:00:00.000Z',
        address: { city: 'Санкт-Петербург', street: 'Невский проспект, 1' },
        friendIds: ['u2'],
    },
    {
        id: 'u2',
        email: 'grace@example.com',
        role: 'USER',
        createdAt: '2026-02-20T12:30:00.000Z',
        address: { city: 'Москва', street: 'Тверская, 7' },
        friendIds: ['u1'],
    },
]

const posts = [
    { id: 'p1', title: 'Первый пост', authorId: 'u1', likes: 12 },
    { id: 'p2', title: 'Второй пост', authorId: 'u2', likes: 3 },
]

const typeDefs = /* GraphQL */ `
    scalar DateTime

    enum Role {
        ADMIN
        USER
    }

    type Address {
        city: String!
        street: String!
    }

    type User {
        id: ID!
        email: String!
        role: Role!
        createdAt: DateTime
        address: Address!
        friends: [User!]!
        posts(first: Int!): [Post!]!
    }

    type Post {
        id: ID!
        title: String!
        likes: Int!
        author: User!
    }

    input UserFilter {
        role: Role!
        search: String
        limit: Int!
    }

    type AuthPayload {
        accessToken: String!
        expiresIn: Int!
        user: User!
    }

    type Query {
        me: User
        user(id: ID!): User
        users(filter: UserFilter!, offset: Int): [User!]!
        posts: [Post!]!
    }

    type Mutation {
        login(email: String!, password: String!): AuthPayload!
        likePost(id: ID!): Post!
    }

    type Subscription {
        postLiked: Post!
    }
`

const resolvers = {
    DateTime: {
        // Скаляр объявлен, но сериализация тривиальна: значения уже строки ISO.
        __serialize: (value: unknown) => value,
    },
    User: {
        friends: (parent: IUser) => users.filter((user) => parent.friendIds.includes(user.id)),
        posts: (parent: IUser, args: { first: number }) =>
            posts.filter((post) => post.authorId === parent.id).slice(0, args.first),
    },
    Post: {
        author: (parent: { authorId: string }) =>
            users.find((user) => user.id === parent.authorId),
    },
    Query: {
        me: (_parent: unknown, _args: unknown, context: { userId: string | undefined }) =>
            users.find((user) => user.id === (context.userId ?? 'u1')),
        user: (_parent: unknown, args: { id: string }) =>
            users.find((user) => user.id === args.id),
        users: (_parent: unknown, args: { filter: { role: string; limit: number } }) =>
            users.filter((user) => user.role === args.filter.role).slice(0, args.filter.limit),
        posts: () => posts,
    },
    Mutation: {
        login: (_parent: unknown, args: { email: string; password: string }) => {
            if (args.password !== VALID_PASSWORD) {
                throw new Error('Неверный пароль')
            }

            const user = users.find((item) => item.email === args.email) ?? users[0]

            return {
                accessToken: `token-${user?.id}-${Date.now().toString(36)}`,
                expiresIn: 3600,
                user,
            }
        },
        likePost: (_parent: unknown, args: { id: string }) => {
            const post = posts.find((item) => item.id === args.id)
            if (!post) throw new Error(`Пост "${args.id}" не найден`)

            post.likes += 1
            void pubSub.publish('postLiked', post)

            return post
        },
    },
    Subscription: {
        postLiked: {
            subscribe: () => pubSub.subscribe('postLiked'),
            resolve: (payload: unknown) => payload,
        },
    },
}

const pubSub = createPubSub<{ postLiked: [{ id: string; title: string; likes: number }] }>()

const yoga = createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    context: ({ request }): { userId: string | undefined } => {
        const authorization = request.headers.get('authorization') ?? ''
        const match = /^Bearer token-(u\d+)/.exec(authorization)

        return { userId: match?.[1] }
    },
    graphiql: false,
})

// Yoga возвращает промис из обработчика, а `createServer` ожидает void —
// оборачиваем, чтобы не терять необработанные отклонения.
createServer((request, response) => {
    void yoga(request, response)
}).listen(PORT, () => {
    console.log(`Mock GraphQL: http://localhost:${PORT}/graphql`)
})

// Регулярная публикация события: подписку можно проверить, не выполняя мутацию.
setInterval(() => {
    const post = posts[Math.floor(Math.random() * posts.length)]
    if (post) void pubSub.publish('postLiked', post)
}, 5000)
