/* eslint-disable unicorn/prevent-abbreviations -- vite-env.d.ts is a required Vite convention */
/// <reference types="vite/client" />

// Type declarations for CSS/SCSS modules
declare module '*.module.css' {
    const classes: { readonly [key: string]: string };
    export default classes;
}

declare module '*.module.scss' {
    const classes: { readonly [key: string]: string };
    export default classes;
}

declare module '*.module.sass' {
    const classes: { readonly [key: string]: string };
    export default classes;
}

// Type declarations for regular CSS/SCSS imports
declare module '*.css' {
    const content: string;
    export default content;
}

declare module '*.scss' {
    const content: string;
    export default content;
}

declare module '*.sass' {
    const content: string;
    export default content;
}