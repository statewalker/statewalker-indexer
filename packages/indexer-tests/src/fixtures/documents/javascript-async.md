# JavaScript Async Patterns

## Promises

A Promise represents an eventual result of an asynchronous operation.
It can be pending, fulfilled, or rejected. Chain `.then()` for
sequential operations and `.catch()` for error handling.
`Promise.all()` runs multiple promises in parallel.

## Async/Await

The `async` keyword declares a function that returns a Promise.
`await` pauses execution until the Promise resolves. This makes
asynchronous code read like synchronous code. Always wrap `await`
calls in try/catch blocks for proper error handling.

## Error Handling Patterns

Use try/catch for individual operations. For parallel work, note that
`Promise.all()` fails fast — if any promise rejects, all results are
lost. Use `Promise.allSettled()` when you need all results regardless
of individual failures. Consider retry wrappers for transient errors.

## Event Loop

JavaScript runs on a single thread with an event loop. Microtasks
(Promise callbacks) execute before macrotasks (setTimeout, I/O).
Understanding this ordering prevents subtle bugs. Long-running
synchronous code blocks the event loop — offload to Web Workers.
