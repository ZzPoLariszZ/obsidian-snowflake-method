/**
 * The one Node module the plugin reaches, named so the compiler lets the
 * guarded import in `desktop-process.ts` through. Node's own typings stay
 * out of the program on purpose: they would bring Node's globals into code
 * that also runs on a phone. What the module is taken to hold is spelled out
 * where it is used.
 */
declare module 'child_process';
