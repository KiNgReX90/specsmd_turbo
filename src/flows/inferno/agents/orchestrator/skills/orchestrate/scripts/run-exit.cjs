'use strict';

/**
 * How a command-line entry of the flow ends once it has printed its answer.
 *
 * On a pipe Node writes without waiting: what the pipe does not take at once (64 KiB on Linux)
 * waits in the process, and `process.exit` drops it. A reader that pipes the answer, to `tail`
 * or to a JSON reader, then loses its end, and the end is where the next step is printed.
 *
 * So the entry exits from the callback of one last, empty write to the stream it printed on:
 * the callback runs once every write before it has left the process, or failed because the
 * reader went away. It does not set `process.exitCode` and wait for the process to end by
 * itself: the entries always ended on `process.exit`, so no step was ever held to closing what
 * it opened (a child it spawned and did not unref, a timer, a socket), and one such handle
 * would keep the process alive with its answer printed and its exit code never returned.
 */
function exitAfter(stream, code) {
  stream.write('', () => process.exit(code));
}

module.exports = { exitAfter };
