// @mtcute/test 0.32.2 is published with its browser platform hard-wired: it always imports
// @mtcute/web. The tests run on Node, so the Node implementations stand in for the web ones.
export { NodePlatform as WebPlatform } from '@mtcute/node';
export { NodeCryptoProvider as WebCryptoProvider } from '@mtcute/node/utils.js';
