'use strict';

// The subcommands of one shell call: how a call that batches several commands is counted.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { subcommands, subcommandCount, scriptOf } = require('./shell-split.cjs');

test('one command is one subcommand, and a pipeline stays one', () => {
  assert.deepEqual(subcommands('rg -n saveCard src'), ['rg -n saveCard src']);
  assert.deepEqual(subcommands('rg -n saveCard src | head -20'), ['rg -n saveCard src | head -20']);
});

test('&&, ||, ; and newlines each start a subcommand', () => {
  assert.deepEqual(subcommands('cd src && ls; cat a.js || true\nsed -n 1,20p b.js'),
    ['cd src', 'ls', 'cat a.js', 'true', 'sed -n 1,20p b.js']);
});

test('a separator inside quotes or a command substitution splits nothing', () => {
  assert.deepEqual(subcommands(`echo 'a; b && c' "d || e" && grep -c "$(ls; pwd)" x`),
    [`echo 'a; b && c' "d || e"`, 'grep -c "$(ls; pwd)" x']);
  assert.deepEqual(subcommands('echo `date; id`'), ['echo `date; id`']);
  assert.deepEqual(subcommands('echo a\\;b'), ['echo a\\;b']);
});

test('a background & splits, a redirection with & does not', () => {
  assert.deepEqual(subcommands('node a.js > out.log 2>&1 & echo started'), ['node a.js > out.log 2>&1', 'echo started']);
  assert.deepEqual(subcommands('ls &> all.log'), ['ls &> all.log']);
});

test('a heredoc body is part of its command, whatever it holds', () => {
  const script = "cat > notes.md <<'EOF'\nline one; not a command\nrm -rf nothing && echo\nEOF\nls notes.md";
  assert.deepEqual(subcommands(script), ["cat > notes.md <<'EOF'\nline one; not a command\nrm -rf nothing && echo\nEOF", 'ls notes.md']);
  assert.deepEqual(subcommands('cat <<-END\n\tx; y\n\tEND\necho done'), ['cat <<-END\n\tx; y\n\tEND', 'echo done']);
  assert.deepEqual(subcommands('grep x <<< "a; b"'), ['grep x <<< "a; b"']);
});

test('a comment and a line continuation are no subcommand of their own', () => {
  assert.deepEqual(subcommands('# read the store\nsed -n 1,40p src/store.js # the writes\nrg -n \\\n  recordMovement src'),
    ['sed -n 1,40p src/store.js', 'rg -n \\\n  recordMovement src']);
});

test('control words are not commands: a loop counts its body, a group and a subshell count what they hold', () => {
  assert.deepEqual(subcommands('for f in a.js b.js; do wc -l "$f"; done'), ['wc -l "$f"']);
  assert.deepEqual(subcommands('if test -f a; then cat a; else echo none; fi'), ['test -f a', 'cat a', 'echo none']);
  assert.deepEqual(subcommands('while read line; do echo "$line"; done < list'), ['read line', 'echo "$line"']);
  assert.deepEqual(subcommands('(cd src && ls) ; { pwd; date; }'), ['cd src', 'ls', 'pwd', 'date']);
});

test('nothing but separators and blanks is no subcommand', () => {
  assert.deepEqual(subcommands(' ;\n\n&& '), []);
  assert.deepEqual(subcommands(''), []);
});

test('an unclosed quote fails loudly instead of guessing', () => {
  assert.throws(() => subcommands("echo 'open"), /unclosed/);
  assert.throws(() => subcommands('cat <<EOF\nbody'), /heredoc EOF/);
});

test('a call counts one subcommand at least, and a command the shell could not read counts one, unread', () => {
  assert.deepEqual(subcommandCount('ls; pwd'), { count: 2, unread: false });
  assert.deepEqual(subcommandCount(''), { count: 1, unread: false });
  assert.deepEqual(subcommandCount("echo 'open; ls"), { count: 1, unread: true });
});

test('scriptOf reads the script out of an argv that runs a shell, and joins any other argv', () => {
  assert.equal(scriptOf(['bash', '-lc', 'ls && pwd']), 'ls && pwd');
  assert.equal(scriptOf(['/bin/zsh', '-c', 'ls']), 'ls');
  assert.equal(scriptOf(['sh', '-c', 'ls']), 'ls');
  assert.equal(scriptOf(['rg', '-n', 'a b', 'src']), "rg -n 'a b' src");
  assert.equal(scriptOf('ls; pwd'), 'ls; pwd');
  assert.throws(() => scriptOf({ cmd: 'ls' }), /neither a string nor an argv/);
});
