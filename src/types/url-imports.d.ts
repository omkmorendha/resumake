// Bundler `?url` imports (Turbopack/webpack) resolve to a string URL. Declare
// the shape so TypeScript accepts them.
declare module "*?url" {
  const url: string;
  export default url;
}
