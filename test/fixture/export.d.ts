// Type declarations for your export worker.
// Update the URL to match your deployed worker or local dev server.
//
// Usage in your client code:
//   import client, { myFunction } from "https://my-worker.workers.dev";
//   const result = await client.d1.MY_DB`SELECT * FROM users`;

declare module "http://localhost:8787" {
  export * from "./.export-client";
  export { default } from "./.export-client";
}

// Add more module declarations for your deployed URLs:
// declare module "https://my-worker.workers.dev" {
//   export * from "./.export-client";
//   export { default } from "./.export-client";
// }
