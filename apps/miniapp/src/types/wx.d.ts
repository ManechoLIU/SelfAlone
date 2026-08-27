type MiniappEvent<TDetail = Record<string, unknown>> = {
  detail: TDetail;
  currentTarget: { dataset: Record<string, unknown> };
  touches?: Array<{ clientY: number }>;
  changedTouches?: Array<{ clientY: number }>;
};

declare function App(options: Record<string, unknown> & ThisType<any>): void;
declare function Page<TData>(options: { data: TData } & Record<string, unknown> & ThisType<any>): void;
declare function Component(options: Record<string, unknown> & ThisType<any>): void;
declare function getApp<T>(): T;
declare function setTimeout(callback: () => void, delay?: number): number;
declare function clearTimeout(handle: number): void;

declare module "*.wxml?raw" {
  const content: string;
  export default content;
}

declare module "*.wxss?raw" {
  const content: string;
  export default content;
}

type MiniappClientRect = { top: number; height: number };
type MiniappWindowInfo = {
  windowHeight: number;
  windowWidth: number;
  statusBarHeight?: number;
  safeArea?: { top: number; bottom: number };
};
type MiniappWindowResizeEvent = { size: MiniappWindowInfo };
type MiniappKeyboardHeightEvent = { height: number; duration?: number };
type MiniappRequestResponse = { statusCode: number; data: unknown };
type MiniappRequestOptions = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  header?: Record<string, string>;
  data?: unknown;
  success?: (response: MiniappRequestResponse) => void;
  fail?: () => void;
};
type MiniappLoginResponse = { code: string };
type MiniappLoginOptions = {
  success?: (response: MiniappLoginResponse) => void;
  fail?: () => void;
};
type MiniappSelectorQuery = {
  select(selector: string): {
    boundingClientRect(callback: (rect: MiniappClientRect | null) => void): MiniappSelectorQuery;
  };
  selectAll(selector: string): {
    boundingClientRect(callback: (rects: MiniappClientRect[] | null) => void): MiniappSelectorQuery;
  };
  exec(): void;
};

declare const wx: {
  login(options: MiniappLoginOptions): void;
  request(options: MiniappRequestOptions): void;
  createSelectorQuery(): MiniappSelectorQuery;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): unknown;
  getAccountInfoSync(): { miniProgram: { envVersion: string } };
  getWindowInfo?: () => MiniappWindowInfo;
  getSystemInfoSync(): MiniappWindowInfo;
  onWindowResize?: (listener: (event: MiniappWindowResizeEvent) => void) => void;
  offWindowResize?: (listener: (event: MiniappWindowResizeEvent) => void) => void;
  onKeyboardHeightChange?: (listener: (event: MiniappKeyboardHeightEvent) => void) => void;
  offKeyboardHeightChange?: (listener: (event: MiniappKeyboardHeightEvent) => void) => void;
  reLaunch(options: { url: string }): void;
  navigateTo(options: { url: string }): void;
  redirectTo(options: { url: string }): void;
  navigateBack(options?: { delta?: number }): void;
  stopPullDownRefresh(): void;
  showToast(options: { title: string; icon?: "none" | "success"; duration?: number }): void;
  showModal(options: { title: string; content: string; showCancel?: boolean; confirmText?: string; success?: (result: { confirm: boolean }) => void }): void;
};
