/**
 * Google Identity Services — the "Sign in with Google" button.
 *
 * Google renders the button and, when someone picks an account, hands us an
 * ID token (a signed JWT naming who signed in). We post it to the API, which
 * verifies it against Google's keys and our client id. No redirect, no client
 * secret, and the token is never stored in the browser.
 *
 * The script is loaded only on the sign-in page, and only once.
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    ux_mode?: 'popup';
    auto_select?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard';
      theme?: 'filled_black' | 'outline';
      size?: 'large';
      text?: 'continue_with';
      shape?: 'rectangular';
      width?: number;
      logo_alignment?: 'left';
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

let loading: Promise<GoogleIdentityApi> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.google) {
      resolve(window.google.accounts.id);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () =>
      window.google
        ? resolve(window.google.accounts.id)
        : reject(new Error('Google sign-in did not load.'));
    script.onerror = () => {
      loading = null;
      reject(new Error('Google sign-in could not be loaded. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Draws Google's button into `container`; `onCredential` gets the ID token. */
export async function renderGoogleButton(
  container: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  const identity = await loadGoogleIdentity();
  identity.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
    ux_mode: 'popup',
    auto_select: false,
  });
  identity.renderButton(container, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: Math.min(container.clientWidth || 380, 400),
  });
}
