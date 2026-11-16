type WidgetOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
};

type Turnstile = { render: (container: HTMLElement, options: WidgetOptions) => string; remove: (id: string) => void };
type TurnstileWindow = Window & { turnstile?: Turnstile };
let loading: Promise<Turnstile> | undefined;

function loadWidget() {
  const installed = (window as TurnstileWindow).turnstile;
  if (installed) return Promise.resolve(installed);
  if (!loading) {
    loading = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error('The human check could not load. Try again.'));
      };
      const timer = window.setTimeout(fail, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timer);
        const widget = (window as TurnstileWindow).turnstile;
        if (widget) resolve(widget);
        else fail();
      };
      document.head.append(script);
    }).catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

export async function requestTurnstile(siteKey: string, action: string, signal?: AbortSignal) {
  const widget = await loadWidget();
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const dialog = document.createElement('dialog');
    const label = document.createElement('p');
    label.textContent = 'Complete the human check to continue.';
    const container = document.createElement('section');
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    dialog.setAttribute('aria-label', 'Human check');
    dialog.append(label, container, cancel);
    document.body.append(dialog);
    let widgetId: string | undefined;
    let closed = false;
    const complete = (token?: string) => {
      if (closed) return;
      closed = true;
      if (widgetId !== undefined) widget.remove(widgetId);
      signal?.removeEventListener('abort', abort);
      dialog.close();
      dialog.remove();
      if (token) resolve(token);
      else reject(new Error('The human check did not finish. Try again.'));
    };
    const abort = () => complete();
    signal?.addEventListener('abort', abort, { once: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); complete(); });
    cancel.addEventListener('click', abort);
    try {
      dialog.showModal();
      widgetId = widget.render(container, {
        sitekey: siteKey, action, callback: complete, 'error-callback': abort, 'expired-callback': abort,
      });
    } catch {
      complete();
    }
  });
}
