// Centralized event delegation — eliminates inline onclick handlers
// Actions are dispatched via data-action attributes on DOM elements

const clickHandlers = {};
const inputHandlers = {};

export function on(action, handler) {
    clickHandlers[action] = handler;
}

export function onInput(action, handler) {
    inputHandlers[action] = handler;
}

export function initEvents() {
    document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const handler = clickHandlers[el.dataset.action];
        if (handler) handler(el, e);
    });

    // Keyboard support for actionable elements (buttons, drop zones)
    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest('[data-action]');
        if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const handler = clickHandlers[el.dataset.action];
        if (handler) handler(el, e);
    });

    document.addEventListener('input', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const handler = inputHandlers[el.dataset.action];
        if (handler) handler(el, e);
    });

    document.addEventListener('change', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const handler = inputHandlers[el.dataset.action];
        if (handler) handler(el, e);
    });
}
