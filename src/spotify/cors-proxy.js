// CORS Proxy Layer
// Rotates through multiple proxy services for reliability

const corsProxies = [
    { fn: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, json: false },
    { fn: url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, json: false },
    { fn: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, json: true },
];
let workingProxyIndex = 0;

export async function fetchViaCorsProxy(url, signal, timeoutMs = 12000) {
    const errors = [];

    // Try working proxy first, then others
    const indices = [workingProxyIndex];
    for (let i = 0; i < corsProxies.length; i++) {
        if (i !== workingProxyIndex) indices.push(i);
    }

    for (const idx of indices) {
        if (idx >= corsProxies.length) continue;
        const proxy = corsProxies[idx];
        const proxyUrl = proxy.fn(url);

        // Per-request timeout via AbortController
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        // Forward parent abort signal
        let onParentAbort;
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timeout);
                throw new DOMException('Aborted', 'AbortError');
            }
            onParentAbort = () => controller.abort();
            signal.addEventListener('abort', onParentAbort, { once: true });
        }

        try {
            const response = await fetch(proxyUrl, { signal: controller.signal });

            if (!response.ok) {
                errors.push(`P${idx}:${response.status}`);
                continue;
            }

            let html;
            if (proxy.json) {
                const wrapper = await response.json();
                html = wrapper.contents;
            } else {
                html = await response.text();
            }

            if (!html || html.length < 100) {
                errors.push(`P${idx}:empty`);
                continue;
            }

            workingProxyIndex = idx;
            return html;
        } catch (e) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            errors.push(`P${idx}:${e.name === 'AbortError' ? 'timeout' : e.message}`);
            continue;
        } finally {
            clearTimeout(timeout);
            if (signal && onParentAbort) {
                signal.removeEventListener('abort', onParentAbort);
            }
        }
    }

    throw new Error(`Proxy feilet (${errors.join(', ')})`);
}
