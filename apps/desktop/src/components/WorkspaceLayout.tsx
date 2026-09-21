import { Group, Panel, Separator } from 'react-resizable-panels'

import { useAppStore } from '../state/store.js'
import { FlowPage } from './FlowEditor.js'
import { ReportPage } from './ReportPage.js'
import { Inspector } from './Inspector.js'
import { RequestPane } from './RequestPane.js'
import { ResponsePane } from './ResponsePane.js'
import { Sidebar } from './Sidebar.js'

/**
 * Раскладка рабочей области.
 *
 * Три пресета вместо свободного перетаскивания панелей: они покрывают реальные
 * режимы работы (обычный, с инспектором, без отвлечений), переключаются одной
 * клавишей и не дают развалить интерфейс случайным перетаскиванием. Размеры
 * панелей сохраняются на workspace отдельно для каждого пресета.
 */
export function WorkspaceLayout(): React.JSX.Element {
    const preset = useAppStore((state) => state.layoutPreset)
    const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
    const layoutSizes = useAppStore((state) => state.layoutSizes)
    const setLayoutSizes = useAppStore((state) => state.setLayoutSizes)
    const activeTab = useAppStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))

    const rootKey = `${preset}-root`
    const centerKey = `${preset}-center`

    // Вкладка-цепочка и вкладка-отчёт занимают всё место запроса и ответа:
    // у них свои шаги со своими ответами, отдельная панель ответа была бы пустой.
    if (activeTab?.kind === 'flow' || activeTab?.kind === 'report') {
        const page =
            activeTab.kind === 'flow' ? (
                <FlowPage tabId={activeTab.id} />
            ) : (
                <ReportPage tabId={activeTab.id} />
            )
        if (preset === 'focus' || sidebarCollapsed) return page

        // Ширина сайдбара берётся из основной раскладки: при переключении
        // между вкладкой запроса и вкладкой цепочки он не должен прыгать.
        const sidebar = layoutSizes[rootKey]?.sidebar ?? 20

        return (
            <Group
                orientation="horizontal"
                className="layout-group"
                defaultLayout={{ sidebar, center: 100 - sidebar }}
                onLayoutChanged={(layout, meta) => {
                    if (meta.isUserInteraction && layout.sidebar !== undefined) {
                        setLayoutSizes(rootKey, { ...layoutSizes[rootKey], sidebar: layout.sidebar })
                    }
                }}
            >
                <Panel id="sidebar" minSize="12" maxSize="40">
                    <Sidebar />
                </Panel>
                <Separator className="resize-handle" />
                <Panel id="center" minSize="30">
                    {page}
                </Panel>
            </Group>
        )
    }

    if (preset === 'focus') {
        return (
            <Group
                orientation="horizontal"
                className="layout-group"
                defaultLayout={layoutSizes[rootKey] ?? { request: 55, response: 45 }}
                onLayoutChanged={(layout, meta) => {
                    if (meta.isUserInteraction) setLayoutSizes(rootKey, layout)
                }}
            >
                <Panel id="request" minSize="25">
                    <RequestPane />
                </Panel>
                <Separator className="resize-handle" />
                <Panel id="response" minSize="20">
                    <ResponsePane />
                </Panel>
            </Group>
        )
    }

    if (preset === 'inspector') {
        return (
            <Group
                orientation="horizontal"
                className="layout-group"
                defaultLayout={
                    layoutSizes[rootKey] ?? { sidebar: 20, center: 55, inspector: 25 }
                }
                onLayoutChanged={(layout, meta) => {
                    if (meta.isUserInteraction) setLayoutSizes(rootKey, layout)
                }}
            >
                {!sidebarCollapsed && (
                    <>
                        <Panel id="sidebar" minSize="12" maxSize="40">
                            <Sidebar />
                        </Panel>
                        <Separator className="resize-handle" />
                    </>
                )}

                <Panel id="center" minSize="30">
                    <Group
                        orientation="vertical"
                        className="layout-group"
                        defaultLayout={
                            layoutSizes[centerKey] ?? { request: 55, response: 45 }
                        }
                        onLayoutChanged={(layout, meta) => {
                            if (meta.isUserInteraction) setLayoutSizes(centerKey, layout)
                        }}
                    >
                        <Panel id="request" minSize="20">
                            <RequestPane />
                        </Panel>
                        <Separator className="resize-handle" />
                        <Panel id="response" minSize="15">
                            <ResponsePane />
                        </Panel>
                    </Group>
                </Panel>

                <Separator className="resize-handle" />
                <Panel id="inspector" minSize="15" maxSize="45">
                    <Inspector />
                </Panel>
            </Group>
        )
    }

    return (
        <Group
            orientation="horizontal"
            className="layout-group"
            defaultLayout={layoutSizes[rootKey] ?? { sidebar: 21, request: 44, response: 35 }}
            onLayoutChanged={(layout, meta) => {
                if (meta.isUserInteraction) setLayoutSizes(rootKey, layout)
            }}
        >
            {!sidebarCollapsed && (
                <>
                    <Panel id="sidebar" minSize="12" maxSize="40">
                        <Sidebar />
                    </Panel>
                    <Separator className="resize-handle" />
                </>
            )}

            <Panel id="request" minSize="25">
                <RequestPane />
            </Panel>
            <Separator className="resize-handle" />
            <Panel id="response" minSize="20">
                <ResponsePane />
            </Panel>
        </Group>
    )
}
