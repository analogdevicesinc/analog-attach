declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApi;
  }
}

export interface VsCodeApi {
  postMessage(message: any): void;
  setState(state: any): void;
  getState(): any;
}


