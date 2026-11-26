// Crea o cambia la contraseña de administración: npm run contrasena
// Se guarda solo su hash (scrypt) en data/admin.json; la contraseña en sí no queda escrita en ningún sitio.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ADMIN_FILE = path.join(__dirname, '..', 'data', 'admin.json');
const MIN_LENGTH = 10;

// Pregunta sin mostrar lo que se escribe en la terminal.
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const password = await ask('Nueva contraseña de administración: ');
  if (password.length < MIN_LENGTH) {
    console.error(`Debe tener al menos ${MIN_LENGTH} caracteres. No se ha cambiado nada.`);
    process.exit(1);
  }
  if (password !== await ask('Repítela: ')) {
    console.error('Las dos contraseñas no coinciden. No se ha cambiado nada.');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ salt, hash }, null, 2) + '\n', { mode: 0o600 });
  console.log('Contraseña guardada. Las sesiones abiertas siguen activas hasta que se reinicie el servidor.');
}

main();
