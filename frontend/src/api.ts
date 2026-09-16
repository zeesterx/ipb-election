import { devAdmin, supabase } from './supabase';

const baseUrl = import.meta.env.VITE_API_URL || '/api';
let redirectingToLogin = false;

function redirectToLogin() {
  if (devAdmin || redirectingToLogin || typeof window === 'undefined') return;
  redirectingToLogin = true;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath.startsWith('/admin') && currentPath !== '/admin/login') {
    window.sessionStorage.setItem('ipb-admin-return-to', currentPath);
  }
  void supabase.auth.signOut({ scope: 'local' }).finally(() => window.location.replace('/admin/login'));
}

async function adminHeaders() {
  if (devAdmin) return { 'x-dev-admin': 'true' };
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    redirectToLogin();
    throw new Error('Faça login para continuar.');
  }
  return { authorization: `Bearer ${data.session.access_token}` };
}

async function decodeError(response: Response) {
  try {
    const body = await response.json();
    return Array.isArray(body.message) ? body.message.join(' ') : body.message || 'Não foi possível concluir.';
  } catch {
    return 'Não foi possível concluir.';
  }
}

export async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (admin) {
    const auth = await adminHeaders();
    Object.entries(auth).forEach(([name, value]) => headers.set(name, value));
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (admin && (response.status === 401 || response.status === 403)) redirectToLogin();
  if (!response.ok) throw new Error(await decodeError(response));
  return response.json() as Promise<T>;
}

export async function downloadCodes(electionId: string, quantity: number) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const auth = await adminHeaders();
  Object.entries(auth).forEach(([name, value]) => headers.set(name, value));
  const response = await fetch(`${baseUrl}/admin/elections/${electionId}/codes`, {
    method: 'POST', headers, body: JSON.stringify({ quantity })
  });
  await savePdfResponse(response);
}

export async function downloadBatchCodes(electionId: string, batchId: string) {
  const headers = new Headers();
  const auth = await adminHeaders();
  Object.entries(auth).forEach(([name, value]) => headers.set(name, value));
  const response = await fetch(`${baseUrl}/admin/elections/${electionId}/codes/batches/${batchId}/pdf`, { headers });
  await savePdfResponse(response);
}

export async function downloadMinutesReport(electionId: string) {
  const headers = new Headers();
  const auth = await adminHeaders();
  Object.entries(auth).forEach(([name, value]) => headers.set(name, value));
  const response = await fetch(`${baseUrl}/admin/elections/${electionId}/minutes-report.pdf`, { headers });
  await savePdfResponse(response, 'resultado-eleicao-oficiais.pdf');
}

async function savePdfResponse(response: Response, fallbackFilename = 'senhas.pdf') {
  if (response.status === 401 || response.status === 403) redirectToLogin();
  if (!response.ok) throw new Error(await decodeError(response));
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackFilename;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
