import { useLayoutEffect, useRef } from 'react'
import { Group, Panel, Separator, type GroupImperativeHandle } from 'react-resizable-panels'

import { useT } from '../i18n/index.js'
import { kbd } from '../lib/keys.js'
import { useAppStore } from '../state/store.js'
import { FlowPage } from './FlowEditor.js'
import { Inspector } from './Inspector.js'
import { ReportPage } from './ReportPage.js'
import { RequestPane } from './RequestPane.js'
import { ResponsePane } from './ResponsePane.js'
import { SchemaPage } from './SchemaPage.js'
import { ActivityRail, Sidebar } from './Sidebar.js'
import { TabStrip } from './TitleBar.js'

/** Каркас рабочей области с общей полосой вкладок и панелями выбранного раздела. */
export function WorkspaceLayout(): React.JSX.Element {
    const preset = useAppStore((state) => state.layoutPreset)
    const workspaceId = useAppStore((state) => state.workspace?.id)
    const kind = useAppStore(
        (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.kind,
    )
    const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
    const rootKey = `${preset}-root`
    const layout = useAppStore((state) => state.layoutSizes[rootKey])
    const expanded = useAppStore((state) => Boolean(state.layoutSizes[`${rootKey}-restore`]))
    const showSidebar = preset !== 'focus' && !sidebarCollapsed && !expanded
    const showInspector =
        preset === 'inspector' &&
        !expanded &&
        kind !== 'flow' &&
        kind !== 'report' &&
        kind !== 'schema'
    const sidebar = layout?.sidebar ?? 19
    const inspector = layout?.inspector ?? 25

    return (
        <div className="workspace">
            {preset !== 'focus' && <ActivityRail />}
            <Group
                key={`${workspaceId ?? ''}:${preset}`}
                orientation="horizontal"
                className="layout-group workspace__panels"
                defaultLayout={
                    showSidebar && showInspector
                        ? { sidebar, center: 100 - sidebar - inspector, inspector }
                        : showSidebar
                          ? { sidebar, center: 100 - sidebar }
                          : showInspector
                            ? { center: 100 - inspector, inspector }
                            : { center: 100 }
                }
                onLayoutChanged={(sizes, meta) => {
                    if (!meta.isUserInteraction || expanded) return
                    const store = useAppStore.getState()
                    const next = { ...store.layoutSizes[rootKey] }
                    if (sizes.sidebar !== undefined) next.sidebar = sizes.sidebar
                    if (sizes.inspector !== undefined) next.inspector = sizes.inspector
                    if (next.sidebar !== layout?.sidebar || next.inspector !== layout?.inspector) {
                        store.setLayoutSizes(rootKey, next)
                    }
                }}
            >
                {showSidebar && (
                    <Panel id="sidebar" minSize="168px" maxSize="40%">
                        <Sidebar />
                    </Panel>
                )}
                {showSidebar && <Separator id="sidebar-separator" className="resize-handle" />}
                <Panel id="center" minSize="40%">
                    <div className="workbench">
                        <TabStrip />
                        <div className="workbench__content">
                            <WorkspacePage />
                        </div>
                    </div>
                </Panel>
                {showInspector && <Separator id="inspector-separator" className="resize-handle" />}
                {showInspector && (
                    <Panel id="inspector" minSize="15%" maxSize="45%">
                        <Inspector />
                    </Panel>
                )}
            </Group>
        </div>
    )
}

function WorkspacePage(): React.JSX.Element {
    const activeTab = useAppStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
    const t = useT()

    if (!activeTab) {
        return (
            <div className="empty">
                {t('No open tabs.')}
                <br />
                {t('Press {keys} or pick an operation in the collections.', { keys: kbd('T') })}
            </div>
        )
    }
    if (activeTab.kind === 'flow') return <FlowPage key={activeTab.id} tabId={activeTab.id} />
    if (activeTab.kind === 'report') return <ReportPage tabId={activeTab.id} />
    if (activeTab.kind === 'schema') return <SchemaPage tabId={activeTab.id} />

    return <RequestWorkspace />
}

function RequestWorkspace(): React.JSX.Element {
    const preset = useAppStore((state) => state.layoutPreset)
    const rootKey = `${preset}-root`
    const layoutKey = preset === 'inspector' ? `${preset}-center` : rootKey
    const saved = useAppStore((state) => state.layoutSizes[layoutKey])
    const expanded = useAppStore((state) => Boolean(state.layoutSizes[`${rootKey}-restore`]))
    const group = useRef<GroupImperativeHandle | null>(null)
    // Сохранённые до изменения каркаса размеры classic включают ширину сайдбара.
    // Отношение ширин запроса и ответа переносится во вложенную группу.
    const savedTotal = (saved?.request ?? 0) + (saved?.response ?? 0)
    const request = expanded ? 25 : savedTotal ? ((saved?.request ?? 0) / savedTotal) * 100 : 48

    useLayoutEffect(() => {
        group.current?.setLayout({ request, response: 100 - request })
    }, [request])

    return (
        <Group
            groupRef={group}
            orientation={preset === 'inspector' && !expanded ? 'vertical' : 'horizontal'}
            className="layout-group"
            defaultLayout={{ request, response: 100 - request }}
            onLayoutChanged={(sizes, meta) => {
                if (!meta.isUserInteraction || expanded) return
                const store = useAppStore.getState()
                store.setLayoutSizes(layoutKey, { ...store.layoutSizes[layoutKey], ...sizes })
            }}
        >
            <Panel id="request" minSize="20%">
                <RequestPane />
            </Panel>
            <Separator className="resize-handle" />
            <Panel id="response" minSize="20%">
                <ResponsePane />
            </Panel>
        </Group>
    )
}
