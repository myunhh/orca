import { Fragment, type ReactNode } from 'react'
import type { WorkbenchTabView } from '../../../../shared/workbench-window/workbench-window-types'

export type WorkbenchPaneSide = 'primary' | 'secondary'

/** Extra controls for a split-view pane header, e.g. context sharing between the two terminals. */
export type WorkbenchPaneHeaderActionRenderer = (args: {
  tab: WorkbenchTabView
  side: WorkbenchPaneSide
  /** The tab shown in the other half of the split, if any. */
  partner: WorkbenchTabView | null
}) => ReactNode

const renderers: WorkbenchPaneHeaderActionRenderer[] = []

export function registerWorkbenchPaneHeaderActions(
  renderer: WorkbenchPaneHeaderActionRenderer
): () => void {
  renderers.push(renderer)
  return () => {
    const index = renderers.indexOf(renderer)
    if (index !== -1) {
      renderers.splice(index, 1)
    }
  }
}

export function WorkbenchPaneHeaderActions(props: {
  tab: WorkbenchTabView
  side: WorkbenchPaneSide
  partner: WorkbenchTabView | null
}): React.JSX.Element {
  return (
    <>
      {renderers.map((render, index) => (
        <Fragment key={index}>{render(props)}</Fragment>
      ))}
    </>
  )
}
