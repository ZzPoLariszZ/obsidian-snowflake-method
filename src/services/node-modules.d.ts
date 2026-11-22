/**
 * The two Node modules the plugin reaches, named so the compiler lets the
 * guarded imports in `desktop-process.ts` through. Node's own typings stay
 * out of the program on purpose: they would bring Node's globals into code
 * that also runs on a phone. What each module is taken to hold is spelled
 * out where it is used.
 */
declare module 'child_process';
declare module 'http';
