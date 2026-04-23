#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const bundleRoot = process.env.TTS_BUNDLED_DIR || path.join(projectRoot, 'vendor', 'tts');
const piperRoot = path.join(bundleRoot, 'piper');
const modelRoot = path.join(bundleRoot, 'models');
const piperReleaseTag = process.env.TTS_BUNDLED_PIPER_RELEASE || '2023.11.14-2';
const piperReleaseBase = `https://github.com/rhasspy/piper/releases/download/${piperReleaseTag}`;

const modelName = process.env.TTS_BUNDLED_MODEL_NAME || 'es_MX-claude-high.onnx';
const modelUrl = process.env.TTS_BUNDLED_MODEL_URL || `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/claude/high/${modelName}`;
const modelConfigUrl = process.env.TTS_BUNDLED_MODEL_CONFIG_URL || `${modelUrl}.json`;
const modelPath = path.join(modelRoot, modelName);
const modelConfigPath = path.join(modelRoot, `${modelName}.json`);

function log(msg) {
  process.stdout.write(`[setup-bundled-tts] ${msg}\n`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function requestWithRedirect(url, outPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const redirectedUrl = new URL(res.headers.location, url).toString();
        res.resume();
        requestWithRedirect(redirectedUrl, outPath).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Descarga fallida (${status}) para ${url}`));
        return;
      }

      const ws = fs.createWriteStream(outPath);
      res.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve()));
      ws.on('error', reject);
    });

    req.on('error', reject);
  });
}

function getArchiveSpec() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux' && arch === 'x64') {
    return {
      url: `${piperReleaseBase}/piper_linux_x86_64.tar.gz`,
      ext: '.tar.gz',
    };
  }

  if (platform === 'linux' && arch === 'arm64') {
    return {
      url: `${piperReleaseBase}/piper_linux_aarch64.tar.gz`,
      ext: '.tar.gz',
    };
  }

  if (platform === 'darwin' && arch === 'x64') {
    return {
      url: `${piperReleaseBase}/piper_macos_x64.tar.gz`,
      ext: '.tar.gz',
    };
  }

  if (platform === 'darwin' && arch === 'arm64') {
    return {
      url: `${piperReleaseBase}/piper_macos_aarch64.tar.gz`,
      ext: '.tar.gz',
    };
  }

  if (platform === 'win32' && arch === 'x64') {
    return {
      url: `${piperReleaseBase}/piper_windows_amd64.zip`,
      ext: '.zip',
    };
  }

  return null;
}

function extractArchive(archivePath, destinationDir) {
  if (archivePath.endsWith('.tar.gz')) {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destinationDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('No se pudo extraer el archivo tar.gz de Piper.');
    }
    return;
  }

  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const ps = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
      ];
      const result = spawnSync('powershell', ps, { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error('No se pudo extraer el zip de Piper en Windows.');
      }
      return;
    }

    const result = spawnSync('unzip', ['-o', archivePath, '-d', destinationDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('No se pudo extraer el zip de Piper.');
    }
    return;
  }

  throw new Error('Formato de archivo no soportado.');
}

function findPiperExecutable(startDir) {
  const target = process.platform === 'win32' ? 'piper.exe' : 'piper';
  const stack = [startDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === target) {
        return fullPath;
      }
    }
  }

  return null;
}

function ensureExecutable(binPath) {
  if (process.platform !== 'win32') {
    fs.chmodSync(binPath, 0o755);
  }
}

async function main() {
  ensureDir(bundleRoot);
  ensureDir(piperRoot);
  ensureDir(modelRoot);

  const spec = getArchiveSpec();
  if (!spec) {
    log(`Plataforma no soportada para auto-bundle (${process.platform}/${process.arch}).`);
    process.exit(0);
  }

  const existingPiper = findPiperExecutable(piperRoot);
  if (!existingPiper) {
    const archivePath = path.join(bundleRoot, `piper${spec.ext}`);
    log(`Descargando Piper (${process.platform}/${process.arch})...`);
    await requestWithRedirect(spec.url, archivePath);

    log('Extrayendo Piper...');
    extractArchive(archivePath, piperRoot);
    fs.unlinkSync(archivePath);
  } else {
    log(`Piper ya disponible: ${existingPiper}`);
  }

  const resolvedPiper = findPiperExecutable(piperRoot);
  if (!resolvedPiper) {
    throw new Error('No se encontro el ejecutable de Piper tras extraer el bundle.');
  }

  ensureExecutable(resolvedPiper);

  if (!fileExists(modelPath)) {
    log(`Descargando modelo de voz base (${modelName})...`);
    await requestWithRedirect(modelUrl, modelPath);
  } else {
    log(`Modelo ya disponible: ${modelPath}`);
  }

  if (!fileExists(modelConfigPath)) {
    log('Descargando configuracion del modelo...');
    await requestWithRedirect(modelConfigUrl, modelConfigPath);
  }

  log('Bundle TTS listo.');
  log(`Piper: ${resolvedPiper}`);
  log(`Modelo: ${modelPath}`);
}

main().catch((error) => {
  process.stderr.write(`[setup-bundled-tts] ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
