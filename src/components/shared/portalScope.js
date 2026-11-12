import { createContext } from 'react';

/**
 * Optional look for dialogs that portal to <body>: an inline style (theme variables, color scheme, color, font) that Modal
 * spreads on its overlay. Null (the default) leaves the overlay as it is, so an installed app and Studio's own dialogs are unchanged.
 */
/** @type {import('react').Context<{ style: import('react').CSSProperties, mode: string } | null>} */
export const PortalScopeContext = createContext(null);
