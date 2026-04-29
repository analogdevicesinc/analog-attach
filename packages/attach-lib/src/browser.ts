// Browser-safe entry point for attach-lib.
// Only exports modules that have no Node.js dependencies (fs, os, path, etc.).
// Use this from browser/webview contexts instead of the main entry point.

export * from './BigIntSerializer.js';
