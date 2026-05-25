'use strict';

let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  let payload;
  try {
    payload = input.trim() ? JSON.parse(input) : {};
  } catch (err) {
    process.stderr.write(`invalid stdin JSON: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const toolInput = payload.input ?? {};

  if (toolInput.mode === 'invalid-json') {
    process.stdout.write('{ invalid json');
    return;
  }

  if (toolInput.mode === 'fail') {
    process.stdout.write(JSON.stringify({ ok: false, error: 'fixture failure' }));
    process.exit(2);
    return;
  }

  const writeSuccess = () => {
    process.stdout.write(JSON.stringify({
      ok: true,
      result: {
        echo: toolInput,
        schemaReceived: payload.schema != null,
        version: payload.version
      }
    }));
  };

  if (toolInput.mode === 'sleep') {
    setTimeout(writeSuccess, 10_000);
    return;
  }

  writeSuccess();
});
