"use strict";
// client-entry.tsx
const activate = () => {
    console.log('[growi-plugin-calendar] activated!');
};
const deactivate = () => {
    console.log('[growi-plugin-calendar] deactivated!');
};
if (window.pluginActivators == null) {
    window.pluginActivators = {};
}
window.pluginActivators['growi-plugin-calendar'] = { activate, deactivate };
