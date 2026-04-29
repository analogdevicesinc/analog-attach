/// <reference types="vite/client" />

declare module '*.scss' {
  const content: { readonly [className: string]: string };
  export default content;
}

declare module '*.module.scss' {
  const content: { readonly [className: string]: string };
  export default content;
}
