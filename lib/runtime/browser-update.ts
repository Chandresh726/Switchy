const UPDATE_REQUESTED = "switchy-update-requested";
export const UPDATE_REQUESTED_EVENT = "switchy:update-requested";

export function updateWasRequested(): boolean {
  return window.sessionStorage.getItem(UPDATE_REQUESTED) === "true";
}

export function requestBrowserReconnect(): void {
  window.sessionStorage.setItem(UPDATE_REQUESTED, "true");
  window.dispatchEvent(new Event(UPDATE_REQUESTED_EVENT));
}

export function clearBrowserReconnect(): void {
  window.sessionStorage.removeItem(UPDATE_REQUESTED);
}
