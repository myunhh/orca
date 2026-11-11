import type React from 'react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { ChatAccountAction } from './ProviderAccountChatButton'
import { LOCAL_ACCOUNT_OWNER } from '@/lib/wsl-host-account-owner'
import { ClaudeSwitcherForOwner } from './ClaudeSwitcherForOwner'
import { getProviderAccountsOwnerKey } from '@/runtime/runtime-provider-accounts-client'

export type ClaudeSwitcherMenuProps = {
  claude: ProviderRateLimits | null
  compact: boolean
  iconOnly: boolean
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
  chatAction?: ChatAccountAction
}

export function ClaudeSwitcherMenu(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  return props.chatAction ? (
    <ClaudeSwitcherForOwner
      {...props}
      key={getProviderAccountsOwnerKey(props.chatAction.target)}
      owner={{ target: props.chatAction.target, wslHostDistro: null }}
    />
  ) : (
    <FocusedClaudeSwitcher {...props} />
  )
}

// Why: the status bar shows this device's accounts whichever SSH/remote workspace is focused.
function FocusedClaudeSwitcher(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  return <ClaudeSwitcherForOwner {...props} owner={LOCAL_ACCOUNT_OWNER} />
}
